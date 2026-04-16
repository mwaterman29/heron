import { logger } from './utils/logger.js';
import type { SeenItemRow, Verdict } from './db.js';
import type { PriceReference } from './config.js';

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

function buildEmbed(payload: DealPayload) {
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
    url: listing.url,
    color: meta.color,
    fields,
    thumbnail: undefined as undefined | { url: string },
    timestamp: new Date().toISOString(),
  };
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
