import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPulseMicrostructureOverlay,
  discoverTopSportsMarkets,
  fetchOrderbookForScenario,
  MARKET_PRESETS,
  normalizeOrderbook,
  simulateVwapBuy,
} from '../src/engine/polymarketClient';
import {
  computeImpliedFairProb,
  materializePulseEvent,
  SCENARIO_PULSES,
} from '../src/engine/pulseEngine';
import {
  DEFAULT_RISK_GATE_CONFIG,
  evaluateRiskGate,
} from '../src/engine/riskGate';
import {
  buildPolymarketEip712OrderTypedData,
  computeDeterministicDigestHex,
  executeRiskGatedSandboxOrder,
  POLYMARKET_ORDER_SIDE,
  SANDBOX_DEMO_MAKER_ADDRESS,
} from '../src/engine/sandboxSigner';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Polymarket Gamma Discovery, CLOB Orderbook & VWAP Math', () => {
  it('verifies preset sport/slug alignment with zero cross-sport misbinding', () => {
    expect(MARKET_PRESETS['lol-baron'].marketSlug).toMatch(/^lol-/);
    expect(MARKET_PRESETS['lol-baron'].gammaTagSlug).toBe('league-of-legends');
    expect(MARKET_PRESETS['nba-clutch'].marketSlug).toMatch(/^nba-/);
    expect(MARKET_PRESETS['nfl-redzone'].marketSlug).toMatch(/^nfl-/);
  });

  it('discovers and ranks active NBA, NFL, and Esports markets from Gamma /events', async () => {
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('tag_slug=nba')) {
        return new Response(
          JSON.stringify([
            {
              markets: [
                {
                  active: true,
                  closed: false,
                  slug: 'nba-okc-ind-2026-11-23',
                  question: 'Thunder vs. Pacers',
                  outcomes: '["Thunder", "Pacers"]',
                  outcomePrices: '["0.635", "0.365"]',
                  clobTokenIds: '["tok-nba-1", "tok-nba-2"]',
                  volume24hr: 131500,
                },
              ],
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('tag_slug=esports')) {
        return new Response(
          JSON.stringify([
            {
              markets: [
                {
                  active: true,
                  closed: false,
                  slug: 'cs2-nip-m80-2026-11-24',
                  question: 'Counter-Strike: NIP vs M80 (BO1) - PGL Major',
                  outcomes: '["NIP", "M80"]',
                  outcomePrices: '["0.565", "0.435"]',
                  clobTokenIds: '["tok-cs2-1", "tok-cs2-2"]',
                  volume24hr: 74450,
                },
                {
                  // Extreme 99.8c settled-like market must be filtered out
                  active: true,
                  closed: false,
                  slug: 'cs2-blowout',
                  question: 'Settled Blowout',
                  outcomes: '["A", "B"]',
                  outcomePrices: '["0.998", "0.002"]',
                  clobTokenIds: '["tok-dead"]',
                  volume24hr: 999999,
                },
              ],
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const markets = await discoverTopSportsMarkets(5, 1000, fakeFetch);
    expect(markets.length).toBe(2);
    expect(markets[0].slug).toBe('nba-okc-ind-2026-11-23');
    expect(markets[0].sportCategory).toBe('NBA');
    expect(markets[1].slug).toBe('cs2-nip-m80-2026-11-24');
    expect(markets[1].sportCategory).toBe('ESPORTS');

    // Replay preset resolves cleanly as HISTORICAL_L2_REPLAY without spurious network dependency
    const replayBook = await fetchOrderbookForScenario(
      'lol-baron',
      500,
      fakeFetch
    );
    expect(replayBook.source).toBe('HISTORICAL_L2_REPLAY');
    expect(replayBook.marketSlug).toBe('lol-t1-blg-map5-baron-replay');
  });

  it('sorts ascending wire bids to highest-first and descending wire asks to lowest-first', () => {
    const book = normalizeOrderbook(
      {
        bids: [
          { price: '0.01', size: '5000' },
          { price: '0.62', size: '300' },
          { price: '0.63', size: '800' },
        ],
        asks: [
          { price: '0.99', size: '4000' },
          { price: '0.65', size: '500' },
          { price: '0.64', size: '900' },
        ],
      },
      {
        marketSlug: 'nba-okc-ind-2026-11-23',
        question: 'Thunder vs. Pacers',
        outcomeLabel: 'THUNDER YES',
        tokenId: '12345',
        source: 'LIVE_POLYMARKET_CLOB',
      }
    );

    expect(book.bestBid).toBe(0.63);
    expect(book.bestAsk).toBe(0.64);
    expect(book.spread).toBe(0.01);
    expect(book.midPrice).toBe(0.635);
    expect(book.asks[0].price).toBe(0.64);
    expect(book.bids[0].price).toBe(0.63);
  });

  it('computes multi-rung VWAP buy fill respecting limitPrice and USDC cap', () => {
    const book = normalizeOrderbook(
      {
        bids: [{ price: '0.49', size: '200' }],
        asks: [
          { price: '0.50', size: '10' }, // $5.00 notional
          { price: '0.51', size: '20' }, // $10.20 notional
          { price: '0.55', size: '100' }, // above limit 0.52
        ],
      },
      {
        marketSlug: 'test-market',
        question: 'Test',
        outcomeLabel: 'YES',
        tokenId: '999',
        source: 'SNAPSHOT_FALLBACK',
      }
    );

    const fill = simulateVwapBuy(book.asks, 10.0, 0.52);
    expect(fill.filledUsdc).toBe(10.0);
    expect(fill.filledShares).toBeCloseTo(19.8, 1);
    expect(fill.vwapPrice).toBeGreaterThan(0.5);
    expect(fill.vwapPrice).toBeLessThan(0.51);
  });
});

describe('Match Pulse Engine, Fail-Closed Risk Gate & Official EIP-712 Signer', () => {
  const preset = MARKET_PRESETS['lol-baron'];
  const baseBook = normalizeOrderbook(
    { bids: preset.fallbackBids, asks: preset.fallbackAsks },
    {
      marketSlug: preset.marketSlug,
      question: preset.question,
      outcomeLabel: preset.outcomeLabel,
      tokenId: preset.tokenId,
      source: 'HISTORICAL_L2_REPLAY',
    }
  );

  it('decays implied fair probability smoothly toward prior over time', () => {
    const t0 = computeImpliedFairProb(0.5, 0.72, 0, 15000);
    const tHalf = computeImpliedFairProb(0.5, 0.72, 15000, 15000);
    expect(t0).toBeGreaterThan(0.66);
    expect(tHalf).toBeLessThan(t0);
    expect(tHalf).toBeGreaterThan(0.5);
  });

  it('fails closed on NaN, Infinity, zero, or negative requestedStakeUsdc without NaN leakage', () => {
    const tpl = SCENARIO_PULSES['lol-baron'][3];
    const book = applyPulseMicrostructureOverlay(baseBook, tpl);
    const pulse = materializePulseEvent('lol-baron', 'LoL', tpl, book.bestAsk);

    for (const badStake of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -10,
    ]) {
      const decision = evaluateRiskGate(
        pulse,
        book,
        badStake,
        DEFAULT_RISK_GATE_CONFIG
      );
      expect(decision.passed).toBe(false);
      expect(decision.rejectionCode).toBe('RISK_CAP_VIOLATION');
      expect(decision.checks.riskCapLocked).toBe(false);
      expect(Number.isFinite(decision.stakeUsdc)).toBe(true);
      expect(Number.isFinite(decision.estimatedShares)).toBe(true);
      expect(Number.isFinite(decision.expectedValueUsdc)).toBe(true);
    }
  });

  it('silently blocks wide-spread market-maker quote pull (> 4.0c)', () => {
    const tpl = SCENARIO_PULSES['lol-baron'][0];
    const book = applyPulseMicrostructureOverlay(baseBook, tpl);
    const pulse = materializePulseEvent('lol-baron', 'LoL', tpl, book.bestAsk);
    const decision = evaluateRiskGate(pulse, book);

    expect(decision.passed).toBe(false);
    expect(decision.rejectionCode).toBe('SPREAD_TOO_WIDE');
  });

  it('silently blocks adverse whale sweep / Cui Bono invalidation', () => {
    const tpl = SCENARIO_PULSES['lol-baron'][1];
    const book = applyPulseMicrostructureOverlay(baseBook, tpl);
    const pulse = materializePulseEvent('lol-baron', 'LoL', tpl, book.bestAsk);
    const decision = evaluateRiskGate(pulse, book);

    expect(decision.passed).toBe(false);
    expect(['CUI_BONO_THESIS_INVALIDATED', 'WHALE_TOXICITY_ALERT']).toContain(
      decision.rejectionCode
    );
  });

  it('silently blocks thin ask orderbook depth (< $25)', () => {
    const nflPreset = MARKET_PRESETS['nfl-redzone'];
    const nflBase = normalizeOrderbook(
      { bids: nflPreset.fallbackBids, asks: nflPreset.fallbackAsks },
      {
        marketSlug: nflPreset.marketSlug,
        question: nflPreset.question,
        outcomeLabel: nflPreset.outcomeLabel,
        tokenId: nflPreset.tokenId,
        source: 'SNAPSHOT_FALLBACK',
      }
    );
    const tpl = SCENARIO_PULSES['nfl-redzone'][0];
    const thinBook = applyPulseMicrostructureOverlay(nflBase, tpl);
    const pulse = materializePulseEvent(
      'nfl-redzone',
      'NFL',
      tpl,
      thinBook.bestAsk
    );
    const decision = evaluateRiskGate(pulse, thinBook);

    expect(decision.passed).toBe(false);
    expect(decision.rejectionCode).toBe('INSUFFICIENT_DEPTH');
  });

  it('enforces uint8 Order.side=0 and computes WEB3_EIP712 digest AFTER maker/signer update', async () => {
    const tpl = SCENARIO_PULSES['lol-baron'][3];
    const book = applyPulseMicrostructureOverlay(baseBook, tpl);
    const pulse = materializePulseEvent('lol-baron', 'LoL', tpl, book.bestAsk);
    const decision = evaluateRiskGate(
      pulse,
      book,
      250.0,
      DEFAULT_RISK_GATE_CONFIG
    );

    expect(decision.passed).toBe(true);
    expect(decision.stakeUsdc).toBe(10.0);

    const typed = buildPolymarketEip712OrderTypedData({
      tokenId: book.tokenId,
      stakeUsdc: decision.stakeUsdc,
      limitPrice: decision.limitPrice,
    });
    expect(typed.message.maker).toBe(SANDBOX_DEMO_MAKER_ADDRESS);
    expect(typed.message.side).toBe(POLYMARKET_ORDER_SIDE.BUY);
    expect(typed.message.side).toBe(0);
    const sideField = typed.types.Order.find((f) => f.name === 'side');
    expect(sideField).toEqual({ name: 'side', type: 'uint8' });

    // Verify WEB3_EIP712 updates maker & signer BEFORE computing eip712Digest
    const connectedWallet = '0x1111111111111111111111111111111111111111';
    let signedPayloadRaw = '';
    const win = window as unknown as {
      ethereum?: {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
    };
    const prevEth = win.ethereum;
    win.ethereum = {
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') return [connectedWallet];
        if (method === 'eth_signTypedData_v4') {
          signedPayloadRaw = String(params?.[1] ?? '');
          return '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901b';
        }
        return null;
      },
    };

    try {
      const web3Receipt = await executeRiskGatedSandboxOrder({
        book,
        decision,
        fairProb: pulse.impliedFairProb,
        mode: 'FAK',
        signerMode: 'WEB3_EIP712',
      });
      const signedParsed = JSON.parse(signedPayloadRaw) as {
        message: { maker: string; signer: string; side: number };
      };
      expect(signedParsed.message.maker).toBe(connectedWallet);
      expect(signedParsed.message.signer).toBe(connectedWallet);
      expect(signedParsed.message.side).toBe(0);
      expect(web3Receipt.eip712Digest).toBe(
        computeDeterministicDigestHex(signedParsed)
      );
    } finally {
      win.ethereum = prevEth;
    }
  });
});
