import 'dotenv/config';
import { logger } from './utils/logger.js';
import { loadConfig, type ResolvedSearch, type PriceReference } from './config.js';
import {
  markEvaluated,
  markNotified,
  upsertListing,
  type SeenItemRow,
  type Verdict,
} from './db.js';
import { getScraper, listRegisteredSites } from './scrapers/index.js';
import { defaultScraperConfig } from './scrapers/base.js';
import { chunk, evaluateBatch } from './evaluator.js';
import { pickNotifier, type DealPayload } from './notifier.js';

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
    for (const listings of chunk(items.map((i) => i.listing), 10)) {
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

    for (const { job, verdicts, err } of results) {
      if (err || !verdicts) {
        logger.error({ err, refId: job.refId }, 'evaluator failed — leaving items unevaluated');
        continue;
      }
      for (const [itemId, verdict] of verdicts) {
        markEvaluated(itemId, verdict);

        const isDeal =
          verdict.grail_match ||
          verdict.deal_tier === 'steal' ||
          verdict.deal_tier === 'deal';
        if (!isDeal) continue;

        const listing = job.listings.find((b) => b.id === itemId);
        if (!listing) continue;
        const payload: DealPayload = { listing, verdict, reference: job.reference };
        try {
          await notifier.notify(payload);
          markNotified(itemId);
        } catch (notifyErr) {
          logger.error({ err: notifyErr, itemId }, 'notification failed — will retry next run');
        }
      }
    }
  }

  logger.info('deal-hunter run complete');
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
