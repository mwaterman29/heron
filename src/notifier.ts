import { logger } from './utils/logger.js';
import type { SeenItemRow, Verdict } from './db.js';
import type { PriceReference } from './config.js';

/**
 * Resolve a HiFi Shark /goto/ URL to the actual marketplace destination.
 * HiFi Shark uses a JS-based redirect, not an HTTP 301/302, so we fetch
 * the page body and look for the destination URL as an <a href>.
 * Falls back to the original URL on failure.
 */
async function resolveHifiSharkGoto(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'deal-hunter/0.1' },
    });
    const body = await res.text();
    // The goto page contains an <a> linking to the destination marketplace
    const match = body.match(
      /href="(https?:\/\/(?:www\.)?(?:ebay\.com|usaudiomart\.com|canuckaudiomart\.com|audiogon\.com|reverb\.com|hifitorget\.no|kleinanzeigen\.de|2dehands\.be|2ememain\.be|subito\.it|willhaben\.at|olx\.|finn\.no)[^"]*)"/,
    );
    return match?.[1] ?? url;
  } catch {
    return url;
  }
}

/**
 * If the listing URL is a HiFi Shark /goto/ redirect, resolve it to the
 * actual marketplace URL (eBay, Audiogon, USAM, etc.) so the Discord
 * embed links directly to the listing, not the intermediate redirect.
 */
async function resolveListingUrl(listing: SeenItemRow): Promise<string> {
  if (listing.site === 'hifishark' && listing.url.includes('/goto/')) {
    const resolved = await resolveHifiSharkGoto(listing.url);
    if (resolved !== listing.url) {
      logger.info(
        { from: listing.url.slice(0, 80), to: resolved.slice(0, 80) },
        'resolved hifishark goto → destination',
      );
    }
    return resolved;
  }
  return listing.url;
}

export interface DealPayload {
  listing: SeenItemRow;
  verdict: Verdict;
  reference: PriceReference;
}

const TIER_META: Record<string, { color: number; emoji: string; label: string }> = {
  steal: { color: 0xff0000, emoji: '🚨', label: 'Steal' },
  deal: { color: 0xff8c00, emoji: '🔥', label: 'Deal' },
  fair: { color: 0xffd700, emoji: '👀', label: 'Fair' },
  grail: { color: 0x9b59b6, emoji: '💎', label: 'GRAIL' },
};

export interface Notifier {
  notify(payload: DealPayload): Promise<void>;
  /** Send a batch of deals as a single digest message. Falls back to
   *  individual notify() calls if not implemented by the subclass. */
  notifyDigest?(payloads: DealPayload[], resolvedUrls?: Map<string, string>): Promise<void>;
}

function formatPrice(listing: DealPayload['listing'], verdict: DealPayload['verdict']): string {
  const native =
    listing.price != null
      ? `${listing.currency ?? '$'}${listing.price}`
      : null;
  const usd = verdict.extracted_price != null ? `~$${Math.round(verdict.extracted_price)} USD` : null;
  if (native && usd && listing.currency && listing.currency !== 'USD' && listing.currency !== '$') {
    return `${native} (${usd})`;
  }
  return usd ?? native ?? 'N/A';
}

function buildEmbed(payload: DealPayload, resolvedUrl?: string) {
  const { listing, verdict, reference } = payload;
  const tierKey = verdict.grail_match ? 'grail' : verdict.deal_tier;
  const meta = TIER_META[tierKey] ?? TIER_META.fair;
  const priceStr = formatPrice(listing, verdict);

  const fields = [
    { name: 'Source', value: listing.site, inline: true },
    { name: 'Price', value: priceStr, inline: true },
    { name: 'Deal Tier', value: `${meta.emoji} ${meta.label}`, inline: true },
    { name: 'Location', value: listing.location || 'Unknown', inline: true },
    { name: 'Analysis', value: verdict.reasoning.slice(0, 1000) || '(none)' },
  ];
  if (verdict.red_flags.length) {
    fields.push({ name: 'Red Flags', value: verdict.red_flags.join('; ').slice(0, 1000) });
  }
  if (verdict.positive_signals.length) {
    fields.push({ name: 'Positive Signals', value: verdict.positive_signals.join('; ').slice(0, 1000) });
  }
  if (verdict.grail_match && reference.grail) {
    fields.push({ name: 'Grail Criteria', value: reference.grail.slice(0, 1000) });
  }

  return {
    title: `${meta.emoji} ${meta.label.toUpperCase()}: ${reference.name} — ${priceStr}`,
    url: resolvedUrl ?? listing.url,
    color: meta.color,
    fields,
    thumbnail: undefined as undefined | { url: string },
    timestamp: new Date().toISOString(),
  };
}

/** Prepare payloads for digest: resolve redirects, sort by tier, cap count. */
export async function prepareDigest(
  payloads: DealPayload[],
  maxItems: number = 12,
): Promise<{ payloads: DealPayload[]; resolvedUrls: Map<string, string> }> {
  const tierOrder: Record<string, number> = {
    grail: 0,
    steal: 1,
    deal: 2,
    fair: 3,
    overpriced: 4,
    irrelevant: 5,
  };

  // Sort: grails first, then steals, then deals
  const sorted = [...payloads].sort((a, b) => {
    const aKey = a.verdict.grail_match ? 'grail' : a.verdict.deal_tier;
    const bKey = b.verdict.grail_match ? 'grail' : b.verdict.deal_tier;
    return (tierOrder[aKey] ?? 5) - (tierOrder[bKey] ?? 5);
  });

  const capped = sorted.slice(0, maxItems);

  // Resolve HiFi Shark goto redirects in parallel
  const resolvedUrls = new Map<string, string>();
  await Promise.all(
    capped.map(async (p) => {
      const resolved = await resolveListingUrl(p.listing);
      if (resolved !== p.listing.url) {
        resolvedUrls.set(p.listing.id, resolved);
      }
    }),
  );

  return { payloads: capped, resolvedUrls };
}

export class ConsoleNotifier implements Notifier {
  async notify(payload: DealPayload): Promise<void> {
    const embed = buildEmbed(payload);
    logger.info(
      {
        event: 'deal.console',
        title: embed.title,
        url: embed.url,
        tier: payload.verdict.deal_tier,
        grail: payload.verdict.grail_match,
        price: payload.listing.price,
        reasoning: payload.verdict.reasoning,
        red_flags: payload.verdict.red_flags,
        positive_signals: payload.verdict.positive_signals,
      },
      '🔔 DEAL (console)',
    );
  }
}

export class DiscordNotifier implements Notifier {
  constructor(private webhookUrl: string) {}

  async notify(payload: DealPayload): Promise<void> {
    const embed = buildEmbed(payload);
    const content = payload.verdict.grail_match ? '@here GRAIL MATCH' : undefined;
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: [embed] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Discord webhook ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

/**
 * Sends deal notifications as Discord DMs via a bot. Requires:
 *   DISCORD_BOT_TOKEN — the bot token from Developer Portal
 *   DISCORD_USER_ID   — your personal Discord user snowflake ID
 *
 * The bot must share at least one server with the user or Discord
 * blocks the DM (error 50278).
 */
export class DiscordDMNotifier implements Notifier {
  private dmChannelId: string | null = null;

  constructor(
    private botToken: string,
    private userId: string,
  ) {}

  private async ensureDMChannel(): Promise<string> {
    if (this.dmChannelId) return this.dmChannelId;

    const res = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: this.userId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Discord DM channel creation ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { id: string };
    this.dmChannelId = data.id;
    return this.dmChannelId;
  }

  async notify(payload: DealPayload): Promise<void> {
    const channelId = await this.ensureDMChannel();
    const embed = buildEmbed(payload);
    const content = payload.verdict.grail_match ? '💎 **GRAIL MATCH** — check this immediately' : undefined;

    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, embeds: [embed] }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Discord DM send ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Send a daily digest: one or two DMs containing all deal embeds.
   * Discord allows up to 10 embeds per message. Payloads should already
   * be sorted by tier and capped by the caller.
   */
  async notifyDigest(payloads: DealPayload[], resolvedUrls?: Map<string, string>): Promise<void> {
    if (payloads.length === 0) return;
    const channelId = await this.ensureDMChannel();
    const embeds = payloads.map((p) =>
      buildEmbed(p, resolvedUrls?.get(p.listing.id)),
    );

    const hasGrail = payloads.some((p) => p.verdict.grail_match);
    const header = hasGrail
      ? `💎 **GRAIL MATCH** + ${payloads.length - 1} other find${payloads.length > 2 ? 's' : ''}`
      : `📊 **Deal Hunter Digest** — ${payloads.length} find${payloads.length > 1 ? 's' : ''} today`;

    // Discord: max 10 embeds per message
    for (let i = 0; i < embeds.length; i += 10) {
      const batch = embeds.slice(i, i + 10);
      const content = i === 0 ? header : '*(continued)*';
      const res = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content, embeds: batch }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Discord DM digest ${res.status}: ${body.slice(0, 200)}`);
      }
      // Small delay between messages to avoid rate limiting
      if (i + 10 < embeds.length) await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * Pick the best available notifier:
 *   1. DiscordDMNotifier  — if DISCORD_BOT_TOKEN + DISCORD_USER_ID set
 *   2. DiscordNotifier    — if DISCORD_WEBHOOK_URL set
 *   3. ConsoleNotifier    — fallback
 */
export function pickNotifier(forceConsole: boolean): Notifier {
  if (forceConsole) return new ConsoleNotifier();

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const userId = process.env.DISCORD_USER_ID;
  if (botToken && userId) {
    logger.info('using Discord DM notifier');
    return new DiscordDMNotifier(botToken, userId);
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (webhook) {
    logger.info('using Discord webhook notifier');
    return new DiscordNotifier(webhook);
  }

  return new ConsoleNotifier();
}
