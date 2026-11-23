import type {
  MatchScenarioId,
  NormalizedOrderbook,
  OrderbookRung,
  OrderbookSource,
} from './types';

export interface MarketPreset {
  scenarioId: MatchScenarioId;
  sportTag: string;
  gammaTagSlug: 'league-of-legends' | 'esports' | 'nba' | 'nfl';
  liveClobEnabled: boolean;
  marketSlug: string;
  question: string;
  outcomeLabel: string;
  tokenId: string;
  defaultScoreLabel: string;
  defaultClockLabel: string;
  fallbackBids: Array<{ price: string; size: string }>;
  fallbackAsks: Array<{ price: string; size: string }>;
}

/**
 * Curated presets anchored to authentic Polymarket Gamma/CLOB markets:
 * - `nba-clutch` & `nfl-redzone`: Active live Gamma/CLOB game markets queried on wire first.
 * - `lol-baron`: Self-consistent LoL Finals Map 5 historical L2 replay (anchored to T1/Faker
 *   LoL CTF tokenId) for offseason objective-swing replay without misbinding unrelated sports.
 * Live active Esports/NBA/NFL markets are also dynamically discovered via `discoverTopSportsMarkets()`.
 */
export const MARKET_PRESETS: Record<MatchScenarioId, MarketPreset> = {
  'lol-baron': {
    scenarioId: 'lol-baron',
    sportTag: 'LoL REPLAY',
    gammaTagSlug: 'league-of-legends',
    liveClobEnabled: false,
    marketSlug: 'lol-t1-blg-map5-baron-replay',
    question: 'LoL Finals Replay: T1 vs BLG (Map 5 Objective L2 Tape)',
    outcomeLabel: 'T1 YES',
    tokenId:
      '65131434781075699159750304213596128158566891009633289934940087908108401883130',
    defaultScoreLabel: 'T1 2 - 2 BLG · KILLS 11-11',
    defaultClockLabel: '28:14',
    fallbackBids: [
      { price: '0.49', size: '620.0' },
      { price: '0.50', size: '480.0' },
      { price: '0.51', size: '310.0' },
    ],
    fallbackAsks: [
      { price: '0.55', size: '710.0' },
      { price: '0.54', size: '520.0' },
      { price: '0.53', size: '390.0' },
    ],
  },
  'nba-clutch': {
    scenarioId: 'nba-clutch',
    sportTag: 'NBA LIVE',
    gammaTagSlug: 'nba',
    liveClobEnabled: true,
    marketSlug: 'nba-okc-ind-2026-11-23',
    question: 'Thunder vs. Pacers',
    outcomeLabel: 'THUNDER YES',
    tokenId:
      '77551272674430722636416238628877679117713364235606789128145179422306075144624',
    defaultScoreLabel: 'OKC 104 - 103 IND',
    defaultClockLabel: 'Q4 02:18',
    fallbackBids: [
      { price: '0.61', size: '1840.0' },
      { price: '0.62', size: '2410.0' },
      { price: '0.63', size: '5588.57' },
    ],
    fallbackAsks: [
      { price: '0.66', size: '4120.0' },
      { price: '0.65', size: '6310.0' },
      { price: '0.64', size: '13735.40' },
    ],
  },
  'nfl-redzone': {
    scenarioId: 'nfl-redzone',
    sportTag: 'NFL LIVE',
    gammaTagSlug: 'nfl',
    liveClobEnabled: true,
    marketSlug: 'nfl-cin-was-2026-11-24',
    question: 'Bengals vs. Commanders',
    outcomeLabel: 'BENGALS YES',
    tokenId:
      '105222002690282917354150695789925352255782887451522472191947758740756816058494',
    defaultScoreLabel: 'CIN 24 - 20 WAS',
    defaultClockLabel: 'Q4 03:42',
    fallbackBids: [
      { price: '0.70', size: '12500.0' },
      { price: '0.71', size: '28400.0' },
      { price: '0.72', size: '89804.1' },
    ],
    fallbackAsks: [
      { price: '0.75', size: '19200.0' },
      { price: '0.74', size: '31500.0' },
      { price: '0.73', size: '47259.6' },
    ],
  },
};

export interface RawClobBookResponse {
  bids?: Array<{ price: string | number; size: string | number }>;
  asks?: Array<{ price: string | number; size: string | number }>;
  timestamp?: string | number;
}

function parseRungs(
  raw: Array<{ price: string | number; size: string | number }> | undefined,
  direction: 'bids' | 'asks'
): OrderbookRung[] {
  if (!Array.isArray(raw)) return [];
  const parsed: OrderbookRung[] = [];
  for (const item of raw) {
    const price = Number(item.price);
    const size = Number(item.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (price <= 0 || price >= 1 || size <= 0) continue;
    parsed.push({
      price: Number(price.toFixed(4)),
      size: Number(size.toFixed(2)),
      notionalUsdc: Number((price * size).toFixed(2)),
    });
  }
  // Polymarket CLOB `/book` returns bids ascending and asks descending on wire.
  // Always sort best-first: highest bid at index 0, lowest ask at index 0.
  parsed.sort((a, b) =>
    direction === 'bids' ? b.price - a.price : a.price - b.price
  );
  return parsed;
}

export function normalizeOrderbook(
  raw: RawClobBookResponse,
  meta: {
    marketSlug: string;
    question: string;
    outcomeLabel: string;
    tokenId: string;
    source: OrderbookSource;
    adverseWhaleFlowUsdc?: number;
    volume24hrUsdc?: number;
    fetchedAtMs?: number;
  }
): NormalizedOrderbook {
  const bids = parseRungs(raw.bids, 'bids');
  const asks = parseRungs(raw.asks, 'asks');

  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const bestAsk = asks.length > 0 ? asks[0].price : 1;
  const spread =
    bids.length > 0 && asks.length > 0
      ? Number(Math.max(0, bestAsk - bestBid).toFixed(4))
      : 1;
  const midPrice =
    bids.length > 0 && asks.length > 0
      ? Number(((bestBid + bestAsk) / 2).toFixed(4))
      : bestAsk < 1
        ? bestAsk
        : 0.5;

  const askDepthTop3Usdc = Number(
    asks
      .slice(0, 3)
      .reduce((acc, r) => acc + r.notionalUsdc, 0)
      .toFixed(2)
  );
  const bidDepthTop3Usdc = Number(
    bids
      .slice(0, 3)
      .reduce((acc, r) => acc + r.notionalUsdc, 0)
      .toFixed(2)
  );

  return {
    marketSlug: meta.marketSlug,
    question: meta.question,
    outcomeLabel: meta.outcomeLabel,
    tokenId: meta.tokenId,
    bids: bids.slice(0, 8),
    asks: asks.slice(0, 8),
    bestBid,
    bestAsk,
    spread,
    midPrice,
    askDepthTop3Usdc,
    bidDepthTop3Usdc,
    adverseWhaleFlowUsdc: meta.adverseWhaleFlowUsdc ?? 0,
    volume24hrUsdc: meta.volume24hrUsdc,
    source: meta.source,
    fetchedAtMs: meta.fetchedAtMs ?? Date.now(),
  };
}

export function computeExecutableAskDepthUsdc(
  asks: OrderbookRung[],
  limitPrice: number
): number {
  let total = 0;
  for (const rung of asks) {
    if (rung.price <= limitPrice + 1e-9) {
      total += rung.notionalUsdc;
    }
  }
  return Number(total.toFixed(2));
}

export interface VwapFillSimulation {
  filledUsdc: number;
  filledShares: number;
  vwapPrice: number;
  slippageFromBestAsk: number;
}

export function simulateVwapBuy(
  asks: OrderbookRung[],
  maxBudgetUsdc: number,
  limitPrice: number
): VwapFillSimulation {
  if (asks.length === 0 || maxBudgetUsdc <= 0) {
    return {
      filledUsdc: 0,
      filledShares: 0,
      vwapPrice: 0,
      slippageFromBestAsk: 0,
    };
  }
  const bestAsk = asks[0].price;
  let remainingUsdc = maxBudgetUsdc;
  let spentUsdc = 0;
  let acquiredShares = 0;

  for (const rung of asks) {
    if (rung.price > limitPrice + 1e-9 || remainingUsdc <= 1e-6) break;
    const rungMaxUsdc = rung.price * rung.size;
    const takeUsdc = Math.min(remainingUsdc, rungMaxUsdc);
    const takeShares = takeUsdc / rung.price;
    spentUsdc += takeUsdc;
    acquiredShares += takeShares;
    remainingUsdc -= takeUsdc;
  }

  if (acquiredShares <= 0) {
    return {
      filledUsdc: 0,
      filledShares: 0,
      vwapPrice: 0,
      slippageFromBestAsk: 0,
    };
  }

  const vwapPrice = spentUsdc / acquiredShares;
  return {
    filledUsdc: Number(spentUsdc.toFixed(2)),
    filledShares: Number(acquiredShares.toFixed(2)),
    vwapPrice: Number(vwapPrice.toFixed(4)),
    slippageFromBestAsk: Number(Math.max(0, vwapPrice - bestAsk).toFixed(4)),
  };
}

function resolveClobBaseUrls(): string[] {
  if (
    typeof window !== 'undefined' &&
    window.location?.protocol?.startsWith('http')
  ) {
    return ['/api/clob', 'https://clob.polymarket.com'];
  }
  return ['https://clob.polymarket.com'];
}

function resolveGammaBaseUrls(): string[] {
  if (
    typeof window !== 'undefined' &&
    window.location?.protocol?.startsWith('http')
  ) {
    return ['/api/gamma', 'https://gamma-api.polymarket.com'];
  }
  return ['https://gamma-api.polymarket.com'];
}

function parseJsonStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface LiveSportsMarketSummary {
  question: string;
  slug: string;
  outcomeLabel: string;
  tokenId: string;
  sportCategory: 'NBA' | 'NFL' | 'ESPORTS' | 'SPORTS';
  volume24hr: number;
}

export async function fetchGammaMarketBySlug(
  marketSlug: string,
  timeoutMs = 2500,
  fetchImpl: typeof fetch = fetch
): Promise<LiveSportsMarketSummary | null> {
  for (const base of resolveGammaBaseUrls()) {
    const url = `${base}/markets?slug=${encodeURIComponent(marketSlug)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const rows = (await resp.json()) as Array<Record<string, unknown>>;
      const m = Array.isArray(rows) ? rows[0] : null;
      if (!m) continue;
      const tokens = parseJsonStringArray(m.clobTokenIds);
      const outcomes = parseJsonStringArray(m.outcomes);
      if (tokens.length === 0) continue;
      const slug = String(m.slug ?? marketSlug);
      const q = String(m.question ?? '');
      return {
        question: q,
        slug,
        outcomeLabel: outcomes[0] ? `${outcomes[0].toUpperCase()} YES` : 'YES',
        tokenId: tokens[0],
        sportCategory: classifySportCategory(slug, q),
        volume24hr: Number(m.volume24hr ?? 0),
      };
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

function classifySportCategory(
  slug: string,
  question: string
): 'NBA' | 'NFL' | 'ESPORTS' | 'SPORTS' {
  const hay = `${slug} ${question}`.toLowerCase();
  if (hay.startsWith('nba-') || hay.includes('nba')) return 'NBA';
  if (hay.startsWith('nfl-') || hay.includes('nfl')) return 'NFL';
  if (
    hay.startsWith('cs2-') ||
    hay.startsWith('lol-') ||
    hay.startsWith('dota2-') ||
    hay.includes('counter-strike') ||
    hay.includes('dota') ||
    hay.includes('league of legends') ||
    hay.includes('pgl major') ||
    hay.includes('esports')
  ) {
    return 'ESPORTS';
  }
  return 'SPORTS';
}

/**
 * Discovers top active sports & esports markets from Polymarket Gamma `/events`
 * across NBA, NFL, and Esports tags (with `/markets` fallback), deduplicated and
 * ranked by 24h USDC volume. Actively invoked by LiveEdgeStudioApp on mount.
 */
export async function discoverTopSportsMarkets(
  limit = 6,
  timeoutMs = 3000,
  fetchImpl: typeof fetch = fetch
): Promise<LiveSportsMarketSummary[]> {
  const tagSlugs = ['nba', 'nfl', 'esports'] as const;
  const seenSlugs = new Set<string>();
  const collected: LiveSportsMarketSummary[] = [];

  const ingestMarketRecord = (
    item: Record<string, unknown>,
    defaultCategory?: 'NBA' | 'NFL' | 'ESPORTS'
  ) => {
    if (item.closed === true || item.active === false) return;
    const slug = String(item.slug ?? '').trim();
    const question = String(item.question ?? '').trim();
    if (!slug || !question || seenSlugs.has(slug)) return;

    const tokens = parseJsonStringArray(item.clobTokenIds);
    if (tokens.length === 0) return;

    const outcomes = parseJsonStringArray(item.outcomes);
    const prices = parseJsonStringArray(item.outcomePrices).map(Number);
    // Prefer active two-sided markets where primary outcome trades between 5c and 95c
    if (
      prices.length > 0 &&
      Number.isFinite(prices[0]) &&
      (prices[0] < 0.05 || prices[0] > 0.95)
    ) {
      return;
    }

    seenSlugs.add(slug);
    collected.push({
      question,
      slug,
      outcomeLabel: outcomes[0] ? `${outcomes[0].toUpperCase()} YES` : 'YES',
      tokenId: tokens[0],
      sportCategory: defaultCategory ?? classifySportCategory(slug, question),
      volume24hr: Number(item.volume24hr ?? 0),
    });
  };

  for (const base of resolveGammaBaseUrls()) {
    let anyTagSucceeded = false;
    for (const tag of tagSlugs) {
      const cat =
        tag === 'nba' ? 'NBA' : tag === 'nfl' ? 'NFL' : ('ESPORTS' as const);
      const url = `${base}/events?active=true&closed=false&tag_slug=${tag}&limit=10&order=volume24hr&ascending=false`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetchImpl(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) continue;
        anyTagSucceeded = true;
        const payload = (await resp.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(payload)) continue;
        for (const entry of payload) {
          if (Array.isArray(entry.markets)) {
            for (const m of entry.markets as Array<Record<string, unknown>>) {
              ingestMarketRecord(m, cat);
            }
          } else {
            ingestMarketRecord(entry, cat);
          }
        }
      } catch {
        clearTimeout(timer);
      }
    }
    if (anyTagSucceeded && collected.length > 0) break;
  }

  collected.sort((a, b) => b.volume24hr - a.volume24hr);
  return collected.slice(0, limit);
}

export async function fetchOrderbookByMarketSummary(
  market: LiveSportsMarketSummary,
  timeoutMs = 3500,
  fetchImpl: typeof fetch = fetch
): Promise<NormalizedOrderbook | null> {
  for (const base of resolveClobBaseUrls()) {
    const url = `${base}/book?token_id=${encodeURIComponent(market.tokenId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const raw = (await resp.json()) as RawClobBookResponse;
      const normalized = normalizeOrderbook(raw, {
        marketSlug: market.slug,
        question: market.question,
        outcomeLabel: market.outcomeLabel,
        tokenId: market.tokenId,
        volume24hrUsdc: market.volume24hr,
        source: 'LIVE_POLYMARKET_CLOB',
      });
      if (normalized.bids.length > 0 && normalized.asks.length > 0) {
        return normalized;
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function fetchOrderbookForScenario(
  scenarioId: MatchScenarioId,
  timeoutMs = 3500,
  fetchImpl: typeof fetch = fetch
): Promise<NormalizedOrderbook> {
  const preset = MARKET_PRESETS[scenarioId];

  if (!preset.liveClobEnabled) {
    return normalizeOrderbook(
      { bids: preset.fallbackBids, asks: preset.fallbackAsks },
      {
        marketSlug: preset.marketSlug,
        question: preset.question,
        outcomeLabel: preset.outcomeLabel,
        tokenId: preset.tokenId,
        source: 'HISTORICAL_L2_REPLAY',
      }
    );
  }

  const gammaMeta = await fetchGammaMarketBySlug(
    preset.marketSlug,
    Math.min(2000, timeoutMs),
    fetchImpl
  );
  const resolvedTokenId = gammaMeta?.tokenId ?? preset.tokenId;
  const resolvedQuestion = gammaMeta?.question ?? preset.question;
  const resolvedOutcomeLabel = gammaMeta?.outcomeLabel ?? preset.outcomeLabel;

  const liveBook = await fetchOrderbookByMarketSummary(
    {
      question: resolvedQuestion,
      slug: preset.marketSlug,
      outcomeLabel: resolvedOutcomeLabel,
      tokenId: resolvedTokenId,
      sportCategory:
        preset.gammaTagSlug === 'nba'
          ? 'NBA'
          : preset.gammaTagSlug === 'nfl'
            ? 'NFL'
            : 'ESPORTS',
      volume24hr: gammaMeta?.volume24hr ?? 0,
    },
    timeoutMs,
    fetchImpl
  );

  if (liveBook) {
    return liveBook;
  }

  return normalizeOrderbook(
    { bids: preset.fallbackBids, asks: preset.fallbackAsks },
    {
      marketSlug: preset.marketSlug,
      question: resolvedQuestion,
      outcomeLabel: resolvedOutcomeLabel,
      tokenId: resolvedTokenId,
      volume24hrUsdc: gammaMeta?.volume24hr,
      source: 'SNAPSHOT_FALLBACK',
    }
  );
}

export function applyPulseMicrostructureOverlay(
  book: NormalizedOrderbook,
  pulse: {
    adverseWhaleFlowUsdc: number;
    syntheticSpreadOverride?: number;
    syntheticDepthScale?: number;
  }
): NormalizedOrderbook {
  const depthScale = pulse.syntheticDepthScale ?? 1;
  const targetSpread = pulse.syntheticSpreadOverride;

  let bids = book.bids.map((r) => ({
    ...r,
    size: Number((r.size * depthScale).toFixed(2)),
    notionalUsdc: Number((r.notionalUsdc * depthScale).toFixed(2)),
  }));
  let asks = book.asks.map((r) => ({
    ...r,
    size: Number((r.size * depthScale).toFixed(2)),
    notionalUsdc: Number((r.notionalUsdc * depthScale).toFixed(2)),
  }));

  if (
    targetSpread !== undefined &&
    bids.length > 0 &&
    asks.length > 0 &&
    targetSpread > 0
  ) {
    const mid = book.midPrice;
    const newBestBid = Number(Math.max(0.01, mid - targetSpread / 2).toFixed(4));
    const newBestAsk = Number(Math.min(0.99, mid + targetSpread / 2).toFixed(4));
    const bidShift = newBestBid - bids[0].price;
    const askShift = newBestAsk - asks[0].price;

    bids = bids.map((r) => {
      const p = Number(Math.max(0.01, Math.min(0.98, r.price + bidShift)).toFixed(4));
      return {
        price: p,
        size: r.size,
        notionalUsdc: Number((p * r.size).toFixed(2)),
      };
    });
    asks = asks.map((r) => {
      const p = Number(Math.max(0.02, Math.min(0.99, r.price + askShift)).toFixed(4));
      return {
        price: p,
        size: r.size,
        notionalUsdc: Number((p * r.size).toFixed(2)),
      };
    });
  }

  return normalizeOrderbook(
    {
      bids: bids.map((b) => ({ price: b.price, size: b.size })),
      asks: asks.map((a) => ({ price: a.price, size: a.size })),
    },
    {
      marketSlug: book.marketSlug,
      question: book.question,
      outcomeLabel: book.outcomeLabel,
      tokenId: book.tokenId,
      source: book.source,
      adverseWhaleFlowUsdc: pulse.adverseWhaleFlowUsdc,
      volume24hrUsdc: book.volume24hrUsdc,
      fetchedAtMs: Date.now(),
    }
  );
}
