import 'dotenv/config';
import { logger } from './utils/logger.js';
import { loadConfig, type ResolvedSearch, type PriceReference } from './config.js';
import {
  markNotified,
  markPass1,
  markPass2,
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
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRunLLM: false,
    consoleNotify: false,
    scraperOnly: false,
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
    }
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
  logger.info({ flags, registered: listRegisteredSites() }, 'deal-hunter starting');

  const { searches } = loadConfig();
  const scraperConfig = defaultScraperConfig();

  const selected = searches.filter((s) => {
    if (flags.search && s.id !== flags.search) return false;
    if (flags.site && s.site !== flags.site) return false;
    return true;
  });

  if (selected.length === 0) {
    logger.warn('no searches matched filters — exiting');
    return;
  }

  // Queue grouped by reference_id (so we batch evaluate per reference)
  const queueByRef = new Map<string, QueueItem[]>();

  for (const search of selected) {
    const scraper = getScraper(search.site);
    if (!scraper) {
      logger.warn({ searchId: search.id, site: search.site }, 'no scraper registered for site — skipping');
      continue;
    }

    let listings;
    try {
      listings = await scraper.scrape(search, scraperConfig);
    } catch (err) {
      logger.error({ err, searchId: search.id, site: search.site }, 'scraper failed');
      continue;
    }

    for (const raw of listings) {
      const result = upsertListing(search.id, raw);
      if (result.status === 'new') {
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

    for (const cand of candidates) {
      const scraper = getScraper(cand.scraperId);
      if (!scraper || !scraper.fetchDetail) {
        logger.info(
          { itemId: cand.listing.id, site: cand.scraperId },
          'no fetchDetail for scraper — notifying on pass-1 verdict',
        );
        collectDeal(cand.listing, cand.pass1, cand.reference, digest);
        continue;
      }

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
  if (digest.length > 0) {
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
      logger.info({ sent: payloads.length }, 'digest sent');
    } catch (err) {
      logger.error({ err }, 'digest notification failed');
    }
  } else {
    logger.info('no deals found this run');
  }

  logger.info('deal-hunter run complete');
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
