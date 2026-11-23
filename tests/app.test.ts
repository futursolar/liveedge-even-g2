import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveEdgeStudioApp } from '../src/ui/app';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LiveEdgeStudioApp Gamma Top-Bar Market Switching & Telemetry Alignment', () => {
  it('synchronizes panel question, scoreboard, orderbook outcome, and pulse HUD to activeBook after Gamma switch', async () => {
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events') && url.includes('tag_slug=esports')) {
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
                  clobTokenIds: '["tok-cs2-nip", "tok-cs2-m80"]',
                  volume24hr: 74450,
                },
              ],
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/events')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/markets?slug=nba-okc-ind-2026-11-23')) {
        return new Response(
          JSON.stringify([
            {
              slug: 'nba-okc-ind-2026-11-23',
              question: 'Thunder vs. Pacers',
              outcomes: '["Thunder", "Pacers"]',
              clobTokenIds: '["tok-nba-okc", "tok-nba-ind"]',
              volume24hr: 131500,
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('token_id=tok-nba-okc')) {
        return new Response(
          JSON.stringify({
            bids: [
              { price: '0.62', size: '1200' },
              { price: '0.63', size: '2400' },
            ],
            asks: [
              { price: '0.65', size: '1800' },
              { price: '0.64', size: '3100' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('token_id=tok-cs2-nip')) {
        return new Response(
          JSON.stringify({
            bids: [
              { price: '0.54', size: '950' },
              { price: '0.55', size: '1400' },
            ],
            asks: [
              { price: '0.58', size: '1100' },
              { price: '0.57', size: '2200' },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([]), { status: 404 });
    });

    vi.stubGlobal('fetch', fakeFetch);

    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root') as HTMLElement;
    const app = new LiveEdgeStudioApp(root);
    await app.mount();

    // Initial state: NBA Thunder vs Pacers
    expect(root.querySelector('.panel-meta')?.textContent).toBe(
      'Thunder vs. Pacers'
    );
    expect(root.textContent).toContain(
      'Polymarket CLOB L2 Orderbook (THUNDER YES)'
    );

    // Click Gamma Live Discovery chip for NIP vs M80
    const gammaChip = root.querySelector<HTMLButtonElement>('[data-gamma-idx="0"]');
    expect(gammaChip).not.toBeNull();
    await app.selectDiscoveredMarket({
      question: 'Counter-Strike: NIP vs M80 (BO1) - PGL Major',
      slug: 'cs2-nip-m80-2026-11-24',
      outcomeLabel: 'NIP YES',
      tokenId: 'tok-cs2-nip',
      sportCategory: 'ESPORTS',
      volume24hr: 74450,
    });

    // Verify left panel telemetry, scoreboard, orderbook direction, and G2 HUD bar match activeBook (zero T1/BLG bleed)
    expect(root.querySelector('.panel-meta')?.textContent).toBe(
      'Counter-Strike: NIP vs M80 (BO1) - PGL Major'
    );
    expect(root.querySelector('.score-main')?.textContent).toBe('NIP vs M80');
    expect(root.querySelector('.score-clock')?.textContent).toContain(
      'ESPORTS LIVE · 24H $74K'
    );
    expect(root.textContent).toContain(
      'Polymarket CLOB L2 Orderbook (NIP YES)'
    );
    expect(root.textContent).not.toContain('T1 YES');
    expect(root.textContent).not.toContain('T1 2 - 2 BLG');
    expect(root.querySelector('#g2-waveguide')?.textContent).toContain(
      'NIP YES 57.0c'
    );

    // Trigger blocked wide-spread pulse (idx 0): ambient HUD & scoreboard keep NIP vs M80 / NIP YES
    const pulse0 = root.querySelector<HTMLButtonElement>('[data-pulse-idx="0"]');
    pulse0?.click();
    await new Promise((r) => setTimeout(r, 25));
    expect(root.querySelector('.score-main')?.textContent).toBe(
      'NIP vs M80 · NIP YES'
    );
    expect(root.querySelector('#g2-waveguide')?.textContent).toContain(
      'NIP YES'
    );
    expect(root.querySelector('#g2-waveguide')?.textContent).not.toContain(
      'T1 YES'
    );

    // Trigger passing decisive objective pulse (idx 3): HUD Edge card shows BUY NIP YES
    const pulse3 = root.querySelector<HTMLButtonElement>('[data-pulse-idx="3"]');
    pulse3?.click();
    await new Promise((r) => setTimeout(r, 25));
    expect(root.querySelector('#g2-waveguide')?.textContent).toContain(
      'BUY NIP YES'
    );

    // Switching back to curated NBA scenario cleanly restores Thunder vs. Pacers
    await app.selectScenario('nba-clutch');
    expect(root.querySelector('.panel-meta')?.textContent).toBe(
      'Thunder vs. Pacers'
    );
    expect(root.textContent).toContain(
      'Polymarket CLOB L2 Orderbook (THUNDER YES)'
    );
  });
});
