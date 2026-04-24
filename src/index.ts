import 'dotenv/config';
import { resolve } from 'node:path';
import { logger } from './utils/logger.js';
import { loadConfig, type ResolvedSearch, type PriceReference } from './config.js';
import {
  initDb,
  markNotified,
  markPass1,
  markPass2,
  updateThumbnail,
  upsertListing,
  type SeenItemRow,
  type Verdict,
} from './db.js';
import { getScraper, listRegisteredSites } from './scrapers/index.js';
import { defaultScraperConfig, type DetailPage } from './scrapers/base.js';
import { chunk, evaluateBatch, evaluateDetail } from './evaluator.js';
import { pickNotifier, prepareDigest, type DealPayload } from './notifier.js';

interface CliFlags {
  dryRunLLM: boolean;
  consoleNotify: boolean;
  search?: string;
  site?: string;
  scraperOnly: boolean;
  configDir: string;
  runMode: 'full' | 'dry';
  verbose: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRunLLM: false,
    consoleNotify: false,
    scraperOnly: false,
    configDir: process.cwd(),
    runMode: 'full',
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':
      case '--dry-run-llm':
        flags.dryRunLLM = true;
        break;
      case '--console-notify':
        flags.consoleNotify = true;
        break;
      case '--scraper-only':
        flags.scraperOnly = true;
        break;
      case '--search':
        flags.search = argv[++i];
        break;
      case '--site':
        flags.site = argv[++i];
        break;
      case '--config-dir':
        flags.configDir = resolve(argv[++i]);
        break;
      case '--run-mode':
        flags.runMode = argv[++i] as 'full' | 'dry';
        break;
      case '--verbose':
        flags.verbose = true;
        break;
    }
  }
  // --run-mode dry is syntactic sugar for --dry-run-llm + --console-notify
  if (flags.runMode === 'dry') {
    flags.dryRunLLM = true;
    flags.consoleNotify = true;
  }
  return flags;
}

interface QueueItem {
  listing: SeenItemRow;
  reference: PriceReference;
}

/** Collect a deal for the end-of-run digest instead of notifying inline. */
function collectDeal(
  listing: SeenItemRow,
  verdict: Verdict,
  reference: PriceReference,
  digest: DealPayload[],
): void {
  digest.push({ listing, verdict, reference });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  // If custom config dir, reload .env from there (overrides CWD .env values)
  if (flags.configDir !== process.cwd()) {
    const dotenv = await import('dotenv');
    dotenv.config({ path: resolve(flags.configDir, '.env'), override: true });
  }

  if (flags.verbose) logger.level = 'debug';

  initDb(flags.configDir);

  // --- Run counters for JSON summary ---
  const runStart = Date.now();
  let searchesRun = 0;
  let listingsScraped = 0;
  let newListings = 0;
  let dealsFound = 0;
  let notificationsSent = 0;
  const errors: string[] = [];

  logger.info({ flags, registered: listRegisteredSites() }, 'deal-hunter starting');

  const { searches } = loadConfig(flags.configDir);
  const scraperConfig = defaultScraperConfig();

  const selected = searches.filter((s) => {
    if (flags.search && s.id !== flags.search) return false;
    if (flags.site && s.site !== flags.site) return false;
    return true;
  });

  if (selected.length === 0) {
    logger.warn('no searches matched filters — exiting');
    emitSummary({ runStart, searchesRun, listingsScraped, newListings, dealsFound, notificationsSent, errors });
    return;
  }

  // Queue grouped by reference_id (so we batch evaluate per reference)
  const queueByRef = new Map<string, QueueItem[]>();

  let searchIdx = 0;
  for (const search of selected) {
    const scraper = getScraper(search.site);
    if (!scraper) {
      logger.warn({ searchId: search.id, site: search.site }, 'no scraper registered for site — skipping');
      continue;
    }

    searchIdx++;
    emitActivity(`Scraping ${search.site} (${searchIdx}/${selected.length})`);
    searchesRun++;
    let listings;
    try {
      listings = await scraper.scrape(search, scraperConfig);
    } catch (err) {
      logger.error({ err, searchId: search.id, site: search.site }, 'scraper failed');
      errors.push(`scraper ${search.site}/${search.id}: ${err}`);
      continue;
    }

    listingsScraped += listings.length;
    for (const raw of listings) {
      const result = upsertListing(search.id, raw);
      if (result.status === 'new') {
        newListings++;
        const list = queueByRef.get(search.reference_id) ?? [];
        list.push({ listing: result.row, reference: search.reference });
        queueByRef.set(search.reference_id, list);
      } else if (result.status === 'reseen' && result.priceDropPct >= 0.15) {
        // Re-evaluate on significant price drop (>=15%)
        logger.info(
          { itemId: result.row.id, priceDropPct: result.priceDropPct },
          'significant price drop — re-queueing for evaluation',
        );
        const list = queueByRef.get(search.reference_id) ?? [];
        list.push({ listing: result.row, reference: search.reference });
        queueByRef.set(search.reference_id, list);
      }
    }
  }

  if (flags.scraperOnly) {
    let total = 0;
    for (const items of queueByRef.values()) total += items.length;
    logger.info({ total }, 'scraper-only mode — skipping evaluation');
    emitSummary({ runStart, searchesRun, listingsScraped, newListings, dealsFound, notificationsSent, errors });
    return;
  }

  const notifier = pickNotifier(flags.consoleNotify);
  const digest: DealPayload[] = [];

  // Build a flat list of all batches across all references, then fire them
  // at OpenRouter concurrently. Batches are independent so there's no ordering
  // constraint — wall time becomes max(batch latency) instead of sum.
  interface BatchJob {
    refId: string;
    reference: PriceReference;
    listings: SeenItemRow[];
  }
  const jobs: BatchJob[] = [];
  for (const [refId, items] of queueByRef) {
    if (items.length === 0) continue;
    const reference = items[0].reference;
    // Chunk size = 25. Safely within DeepSeek 3.1's 128K context window
    // (roughly 15K input tokens per batch) while avoiding the degradation
    // risk of much larger batches. A 147-listing run drops from 14 batches
    // to 6, with ~proportional wall-time improvement.
    for (const listings of chunk(items.map((i) => i.listing), 25)) {
      jobs.push({ refId, reference, listings });
    }
  }

  if (jobs.length > 0) {
    const totalListings = jobs.reduce((a, j) => a + j.listings.length, 0);
    emitActivity(`Evaluating ${totalListings} listings (${jobs.length} batches) with LLM`);
    logger.info({ jobs: jobs.length }, 'evaluating batches in parallel');
    const results = await Promise.all(
      jobs.map((job) =>
        evaluateBatch(job.reference, job.listings, { dryRun: flags.dryRunLLM })
          .then((verdicts) => ({ job, verdicts, err: null as unknown }))
          .catch((err) => ({ job, verdicts: null as Map<string, Verdict> | null, err })),
      ),
    );

    // --- Pass 1 complete: collect deal candidates for drill-down ------------
    interface DealCandidate {
      listing: SeenItemRow;
      reference: PriceReference;
      pass1: Verdict;
      scraperId: string;
    }
    const candidates: DealCandidate[] = [];

    for (const { job, verdicts, err } of results) {
      if (err || !verdicts) {
        logger.error({ err, refId: job.refId }, 'evaluator failed — leaving items unevaluated');
        continue;
      }
      for (const [itemId, verdict] of verdicts) {
        markPass1(itemId, verdict);

        const isDeal =
          verdict.grail_match ||
          verdict.deal_tier === 'steal' ||
          verdict.deal_tier === 'deal';
        if (!isDeal) continue;

        const listing = job.listings.find((b) => b.id === itemId);
        if (!listing) continue;
        candidates.push({
          listing,
          reference: job.reference,
          pass1: verdict,
          scraperId: listing.site,
        });
      }
    }

    // --- Pass 2: fetch detail + revise verdict + notify ---------------------
    // Sequential (not parallel) — we expect 0-5 candidates per run and we
    // don't want to hammer any single site. Each candidate is independently
    // wrapped in try/catch: detail-fetch failures and LLM failures both fall
    // back to the pass-1 verdict so the notification still fires.
    if (candidates.length > 0) {
      logger.info({ count: candidates.length }, 'pass-1 flagged deal candidates — running pass-2 drill-down');
    }

    let candIdx = 0;
    for (const cand of candidates) {
      candIdx++;
      const scraper = getScraper(cand.scraperId);
      if (!scraper || !scraper.fetchDetail) {
        logger.info(
          { itemId: cand.listing.id, site: cand.scraperId },
          'no fetchDetail for scraper — notifying on pass-1 verdict',
        );
        collectDeal(cand.listing, cand.pass1, cand.reference, digest);
        continue;
      }

      const titleShort = (cand.listing.title ?? cand.listing.id).slice(0, 50);
      emitActivity(`Drilling into deal ${candIdx}/${candidates.length}: ${titleShort}`);

      let detail: DetailPage | null = null;
      try {
        logger.info({ itemId: cand.listing.id, url: cand.listing.url }, 'pass-2 fetching detail');
        detail = await scraper.fetchDetail(cand.listing.url, scraperConfig);
      } catch (fetchErr) {
        logger.warn(
          { err: fetchErr, itemId: cand.listing.id },
          'pass-2 detail fetch failed — notifying on pass-1 verdict',
        );
        collectDeal(cand.listing, cand.pass1, cand.reference, digest);
        continue;
      }

      // Backfill thumbnail from the detail page when the search-page card
      // didn't have one (notably USAM, whose SRP is a table with no images).
      // No-op in db layer if the row already has a thumbnail.
      if (detail?.thumbnailUrl && !cand.listing.thumbnail_url) {
        try {
          updateThumbnail(cand.listing.id, detail.thumbnailUrl);
        } catch (err) {
          logger.warn(
            { err, itemId: cand.listing.id },
            'failed to update thumbnail — continuing',
          );
        }
      }

      // If the detail page is too thin to be useful (Cloudflare stub,
      // challenge page, empty), fall back to the pass-1 verdict rather
      // than feeding garbage to the LLM.
      if (!detail || detail.rawText.length < 500) {
        logger.warn(
          { itemId: cand.listing.id, rawTextLen: detail?.rawText.length ?? 0 },
          'pass-2 detail content too thin — notifying on pass-1 verdict',
        );
        collectDeal(cand.listing, cand.pass1, cand.reference, digest);
        continue;
      }

      let pass2: Verdict;
      try {
        pass2 = await evaluateDetail(cand.reference, cand.listing, cand.pass1, detail, {
          dryRun: flags.dryRunLLM,
        });
      } catch (evalErr) {
        logger.error(
          { err: evalErr, itemId: cand.listing.id },
          'pass-2 evaluator failed — notifying on pass-1 verdict',
        );
        collectDeal(cand.listing, cand.pass1, cand.reference, digest);
        continue;
      }

      markPass2(cand.listing.id, pass2);

      const pass2IsDeal =
        pass2.grail_match || pass2.deal_tier === 'steal' || pass2.deal_tier === 'deal';

      if (pass2IsDeal) {
        logger.info(
          {
            itemId: cand.listing.id,
            pass1: cand.pass1.deal_tier,
            pass2: pass2.deal_tier,
            grail: pass2.grail_match,
          },
          'pass-2 confirmed deal',
        );
        collectDeal(cand.listing, pass2, cand.reference, digest);
      } else {
        logger.info(
          {
            itemId: cand.listing.id,
            title: cand.listing.title,
            pass1: cand.pass1.deal_tier,
            pass2: pass2.deal_tier,
            pass2Reasoning: pass2.reasoning,
          },
          'pass-2 downgraded — NOT notifying',
        );
      }
    }
  }

  // --- End-of-run digest: sort by tier, cap at 12, resolve redirects, send ---
  dealsFound = digest.length;
  if (digest.length > 0) {
    emitActivity(`Sending digest (${digest.length} deals)`);
    logger.info({ total: digest.length }, 'preparing digest notification');
    const { payloads, resolvedUrls } = await prepareDigest(digest, 12);
    try {
      if (notifier.notifyDigest) {
        await notifier.notifyDigest(payloads, resolvedUrls);
      } else {
        // Fallback for notifiers without digest support (e.g. ConsoleNotifier)
        for (const p of payloads) {
          await notifier.notify(p);
        }
      }
      for (const p of payloads) markNotified(p.listing.id);
      notificationsSent = payloads.length;
      logger.info({ sent: payloads.length }, 'digest sent');
    } catch (err) {
      logger.error({ err }, 'digest notification failed');
      errors.push(`digest notification: ${err}`);
    }
  } else {
    logger.info('no deals found this run');
  }

  logger.info('deal-hunter run complete');
  emitSummary({ runStart, searchesRun, listingsScraped, newListings, dealsFound, notificationsSent, errors });
}

interface SummaryCounters {
  runStart: number;
  searchesRun: number;
  listingsScraped: number;
  newListings: number;
  dealsFound: number;
  notificationsSent: number;
  errors: string[];
}

/**
 * Emit a human-readable activity beacon. The Tauri shell parses lines
 * starting with __HERON_ACTIVITY__ in its sidecar stdout handler and
 * surfaces the rest as the "currently doing X" string in the sidebar +
 * dashboard status strip. Single-line, plain text (not JSON).
 */
function emitActivity(text: string): void {
  process.stdout.write(`__HERON_ACTIVITY__${text}\n`);
}

function emitSummary(c: SummaryCounters): void {
  const summary = {
    status: c.errors.length === 0 ? 'success' : 'partial',
    timestamp: new Date().toISOString(),
    searches_run: c.searchesRun,
    listings_scraped: c.listingsScraped,
    new_listings: c.newListings,
    deals_found: c.dealsFound,
    notifications_sent: c.notificationsSent,
    errors: c.errors,
    duration_ms: Date.now() - c.runStart,
  };
  process.stdout.write(`\n__DEAL_HUNTER_SUMMARY__${JSON.stringify(summary)}\n`);
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
