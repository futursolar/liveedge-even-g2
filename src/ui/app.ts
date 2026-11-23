import { EventSourceType, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import {
  applyPulseMicrostructureOverlay,
  discoverTopSportsMarkets,
  fetchOrderbookByMarketSummary,
  fetchOrderbookForScenario,
  type LiveSportsMarketSummary,
  MARKET_PRESETS,
} from '../engine/polymarketClient';
import {
  materializePulseEvent,
  type PulseTemplate,
  SCENARIO_PULSES,
} from '../engine/pulseEngine';
import {
  DEFAULT_RISK_GATE_CONFIG,
  evaluateRiskGate,
} from '../engine/riskGate';
import { executeRiskGatedSandboxOrder } from '../engine/sandboxSigner';
import type {
  ExecutionMode,
  ExecutionReceipt,
  MatchPulseEvent,
  MatchScenarioId,
  NormalizedOrderbook,
  RiskGateDecision,
} from '../engine/types';
import {
  formatIdleScoreBar,
  G2_DISPLAY_HEIGHT,
  G2_DISPLAY_WIDTH,
  LiveEdgeHudController,
} from '../hud/evenBridgeController';
import {
  type SimulatorHostState,
  simulatorHost,
} from '../hud/mockFlutterHost';

export interface DemoAutomationState {
  running: boolean;
  completed: boolean;
  actIndex: number;
  actTag: string;
  subtitle: string;
  hudMode: string;
  receiptCount: number;
}

declare global {
  interface Window {
    __demoState?: DemoAutomationState;
    __stepDemoAtTimeMs?: (tMs: number) => Promise<void>;
  }
}

export class LiveEdgeStudioApp {
  private scenarioId: MatchScenarioId = 'nba-clutch';
  private baseBook: NormalizedOrderbook | null = null;
  private activeBook: NormalizedOrderbook | null = null;
  private activePulse: MatchPulseEvent | null = null;
  private lastDecision: RiskGateDecision | null = null;
  private receipts: ExecutionReceipt[] = [];
  private discoveredMarkets: LiveSportsMarketSummary[] = [];
  private executionMode: ExecutionMode = 'FAK';
  private hudController: LiveEdgeHudController;
  private hostState: SimulatorHostState = simulatorHost.snapshot();
  private activePulseIdx = -1;
  private subtitleTag = '';
  private subtitleText = '';
  private highlightedBtnId = '';
  private steppedKeyframesFired = new Set<string>();
  private lastTickBucket = -1;
  private demoTimers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(private readonly root: HTMLElement) {
    this.hudController = new LiveEdgeHudController({
      onConfirmOrder: async (mode) => {
        if (!this.activeBook || !this.lastDecision || !this.activePulse) {
          return null;
        }
        const receipt = await executeRiskGatedSandboxOrder({
          book: this.activeBook,
          decision: this.lastDecision,
          fairProb: this.activePulse.impliedFairProb,
          mode,
          signerMode: 'SANDBOX_SIM',
          riskCapUsdc: DEFAULT_RISK_GATE_CONFIG.fixedRiskCapUsdc,
        });
        this.receipts = [receipt, ...this.receipts].slice(0, 8);
        this.syncDemoGlobalState();
        this.render();
        return receipt;
      },
      onDismissAlert: () => {
        this.syncDemoGlobalState();
        this.render();
      },
      onToggleExecutionMode: (nextMode) => {
        this.executionMode = nextMode;
        this.render();
      },
      onMenuReplayRequested: () => {
        const templates = SCENARIO_PULSES[this.scenarioId];
        void this.triggerPulseTemplate(templates[templates.length - 1], templates.length - 1);
      },
      onStateChanged: () => {
        this.syncDemoGlobalState();
        this.render();
      },
    });
  }

  public async mount(): Promise<void> {
    simulatorHost.subscribe((st) => {
      this.hostState = st;
      this.render();
    });

    const preset = MARKET_PRESETS[this.scenarioId];
    const [initialBook, discovered] = await Promise.all([
      fetchOrderbookForScenario(this.scenarioId),
      discoverTopSportsMarkets(5),
    ]);
    this.baseBook = initialBook;
    this.activeBook = this.baseBook;
    this.discoveredMarkets = discovered;

    const initialLine = formatIdleScoreBar({
      sportTag: preset.sportTag,
      scoreLabel: preset.defaultScoreLabel,
      clockLabel: preset.defaultClockLabel,
      outcomeLabel: preset.outcomeLabel,
      bestAsk: this.activeBook.bestAsk,
    });

    await this.hudController.initialize(initialLine);
    this.syncDemoGlobalState();
    this.render();

    window.__stepDemoAtTimeMs = async (tMs: number) => {
      await this.stepDeterministicReel(tMs);
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1' && params.get('manualStep') !== '1') {
      void this.startChoreographedDemoReel();
    }
  }

  private applyMicroBookBreathing(tMs: number): void {
    if (!this.activeBook) return;
    const bucket = Math.floor(tMs / 350);
    if (bucket === this.lastTickBucket) return;
    this.lastTickBucket = bucket;

    const wave = 1 + 0.045 * Math.sin(bucket * 0.9);
    const wave2 = 1 + 0.04 * Math.cos(bucket * 1.15);
    this.activeBook = {
      ...this.activeBook,
      bids: this.activeBook.bids.map((r, idx) => {
        const factor = idx % 2 === 0 ? wave : wave2;
        const size = Number((r.size * factor).toFixed(2));
        return { ...r, size, notionalUsdc: Number((r.price * size).toFixed(2)) };
      }),
      asks: this.activeBook.asks.map((r, idx) => {
        const factor = idx % 2 === 0 ? wave2 : wave;
        const size = Number((r.size * factor).toFixed(2));
        return { ...r, size, notionalUsdc: Number((r.price * size).toFixed(2)) };
      }),
    };
  }

  public async stepDeterministicReel(tMs: number): Promise<void> {
    const fireOnce = async (key: string, fn: () => Promise<void> | void) => {
      if (this.steppedKeyframesFired.has(key)) return;
      this.steppedKeyframesFired.add(key);
      await fn();
    };

    await fireOnce('act1', async () => {
      window.__demoState = {
        running: true,
        completed: false,
        actIndex: 1,
        actTag: 'ACT 1/5 · ZERO-OCCLUSION HUD',
        subtitle: '',
        hudMode: this.hudController.getMode(),
        receiptCount: this.receipts.length,
      };
      await this.selectScenario('nba-clutch');
      this.setSubtitle(
        1,
        'ACT 1/5 · ZERO-OCCLUSION HUD',
        'Watching NBA Live (Thunder vs Pacers) on Even G2: 576x288 ambient bar keeps center vision 100% clear while streaming live Polymarket CLOB depth.'
      );
    });

    if (tMs >= 5500) {
      await fireOnce('act2', async () => {
        this.setSubtitle(
          2,
          'ACT 2/5 · FAIL-CLOSED RISK GATE',
          'Coach review widens CLOB spread to 6.4c (> 4.0c cap). Risk Gate silently blocks the noisy spike — zero HUD popup distraction.'
        );
        await this.triggerPulseTemplate(SCENARIO_PULSES['nba-clutch'][0], 0);
      });
    }

    if (tMs >= 11500) {
      await fireOnce('act3_pop', async () => {
        this.setSubtitle(
          3,
          'ACT 3/5 · TEMPLE SWIPE DISMISS',
          'Transition tie-game layup (+5.8c lag) pops a 3-line green HUD card. Viewer swipes the G2 temple touchpad to dismiss without looking down.'
        );
        await this.triggerPulseTemplate(SCENARIO_PULSES['nba-clutch'][1], 1);
      });
    }

    if (tMs >= 15800) {
      await fireOnce('act3_swipe', async () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.SCROLL_BOTTOM_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
        );
        await new Promise((r) => setTimeout(r, 15));
      });
    }

    if (tMs >= 19000) {
      await fireOnce('act4_pop', async () => {
        this.setSubtitle(
          4,
          'ACT 4/5 · DOUBLE-TAP 10U EXECUTION',
          'Clutch 8-0 Run! Fair win prob jumps to 78.4c vs 64.0c CLOB ask (+14.4c Edge, 1.0c Spread). Double-tap right temple to execute 10 USDC capped order!'
        );
        await this.triggerPulseTemplate(SCENARIO_PULSES['nba-clutch'][2], 2);
      });
    }

    if (tMs >= 23800) {
      await fireOnce('act4_doubletap', async () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.DOUBLE_CLICK_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
        );
        await new Promise((r) => setTimeout(r, 25));
      });
    }

    if (tMs >= 29500) {
      await fireOnce('act5_whale', async () => {
        await this.selectScenario('lol-baron');
        this.setSubtitle(
          5,
          'ACT 5/5 · ESPORTS BARON + WHALE GUARD',
          'Esports Mode (LoL Game 5): Pre-Headline Sentinel blocks $1,640 whale trap first, then captures +16c Baron Steal via Even R1 Ring Double-Tap!'
        );
        await this.triggerPulseTemplate(SCENARIO_PULSES['lol-baron'][1], 1);
      });
    }

    if (tMs >= 34000) {
      await fireOnce('act5_baron', async () => {
        await this.triggerPulseTemplate(SCENARIO_PULSES['lol-baron'][3], 3);
      });
    }

    if (tMs >= 38000) {
      await fireOnce('act5_ring', async () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.DOUBLE_CLICK_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_RING
        );
        await new Promise((r) => setTimeout(r, 25));
      });
    }

    if (tMs >= 42800) {
      await fireOnce('act5_outro', async () => {
        await this.hudController.returnToIdle();
        this.setSubtitle(
          5,
          'READY FOR EVEN G2 & SIMULATOR',
          'LiveEdge HUD · Official @evenrealities/even_hub_sdk v0.0.16 · Read-Only CLOB + Zero-Key EIP-712 Sandbox · Packaged as liveedge-hud.ehpk'
        );
        if (window.__demoState) {
          window.__demoState.running = false;
          window.__demoState.completed = true;
        }
      });
    }

    if (tMs >= 15800 && tMs <= 16750) {
      this.highlightedBtnId = 'btn-swipe-dismiss';
    } else if (tMs >= 23800 && tMs <= 24850) {
      this.highlightedBtnId = 'btn-double-tap';
    } else if (tMs >= 38000 && tMs <= 39050) {
      this.highlightedBtnId = 'btn-ring-confirm';
    } else {
      this.highlightedBtnId = '';
    }

    this.applyMicroBookBreathing(tMs);
    this.render();
  }

  public async selectScenario(nextId: MatchScenarioId): Promise<void> {
    this.scenarioId = nextId;
    this.activePulse = null;
    this.lastDecision = null;
    this.activePulseIdx = -1;

    const preset = MARKET_PRESETS[nextId];
    this.baseBook = await fetchOrderbookForScenario(nextId);
    this.activeBook = this.baseBook;

    const scoreLine = formatIdleScoreBar({
      sportTag: preset.sportTag,
      scoreLabel: preset.defaultScoreLabel,
      clockLabel: preset.defaultClockLabel,
      outcomeLabel: preset.outcomeLabel,
      bestAsk: this.activeBook.bestAsk,
    });

    await this.hudController.returnToIdle();
    await this.hudController.updateAmbientScoreBar(scoreLine);
    this.render();
  }

  public async selectDiscoveredMarket(
    market: LiveSportsMarketSummary
  ): Promise<void> {
    const liveBook = await fetchOrderbookByMarketSummary(market);
    if (!liveBook) return;
    this.scenarioId =
      market.sportCategory === 'NFL'
        ? 'nfl-redzone'
        : market.sportCategory === 'ESPORTS'
          ? 'lol-baron'
          : 'nba-clutch';
    this.baseBook = liveBook;
    this.activeBook = liveBook;
    this.activePulse = null;
    this.lastDecision = null;
    this.activePulseIdx = -1;

    const scoreLine = formatIdleScoreBar({
      sportTag: `${market.sportCategory} LIVE`,
      scoreLabel: market.question.slice(0, 26),
      clockLabel: `24H $${Math.round(market.volume24hr / 1000)}K`,
      outcomeLabel: market.outcomeLabel,
      bestAsk: liveBook.bestAsk,
    });
    await this.hudController.returnToIdle();
    await this.hudController.updateAmbientScoreBar(scoreLine);
    this.render();
  }

  public async triggerPulseTemplate(
    template: PulseTemplate,
    idx: number
  ): Promise<void> {
    if (!this.baseBook) return;
    this.activePulseIdx = idx;
    const preset = MARKET_PRESETS[this.scenarioId];

    const overlayBook = applyPulseMicrostructureOverlay(this.baseBook, {
      adverseWhaleFlowUsdc: template.adverseWhaleFlowUsdc,
      syntheticSpreadOverride: template.syntheticSpreadOverride,
      syntheticDepthScale: template.syntheticDepthScale,
    });
    const pulse = materializePulseEvent(
      this.scenarioId,
      preset.sportTag,
      template,
      overlayBook.bestAsk
    );
    const decision = evaluateRiskGate(pulse, overlayBook);

    this.activeBook = overlayBook;
    this.activePulse = pulse;
    this.lastDecision = decision;

    const updatedAmbient = formatIdleScoreBar({
      sportTag: preset.sportTag,
      scoreLabel: pulse.scoreLabel,
      clockLabel: pulse.clockLabel,
      outcomeLabel: preset.outcomeLabel,
      bestAsk: overlayBook.bestAsk,
    });

    if (decision.passed) {
      await this.hudController.presentEdgeAlert({
        pulse,
        book: overlayBook,
        decision,
      });
    } else {
      await this.hudController.returnToIdle();
      await this.hudController.updateAmbientScoreBar(updatedAmbient);
    }

    this.syncDemoGlobalState();
    this.render();
  }

  private setSubtitle(actIndex: number, tag: string, text: string): void {
    this.subtitleTag = tag;
    this.subtitleText = text;
    if (window.__demoState) {
      window.__demoState.actIndex = actIndex;
      window.__demoState.actTag = tag;
      window.__demoState.subtitle = text;
    }
    this.render();
  }

  private syncDemoGlobalState(): void {
    const prev = window.__demoState ?? {
      running: false,
      completed: false,
      actIndex: 0,
      actTag: '',
      subtitle: '',
      hudMode: 'IDLE_SCOREBAR',
      receiptCount: 0,
    };
    window.__demoState = {
      ...prev,
      hudMode: this.hudController.getMode(),
      receiptCount: this.receipts.length,
    };
  }

  public async startChoreographedDemoReel(): Promise<void> {
    for (const t of this.demoTimers) clearTimeout(t);
    this.demoTimers = [];

    window.__demoState = {
      running: true,
      completed: false,
      actIndex: 1,
      actTag: 'ACT 1/5 · ZERO-OCCLUSION VIEWING',
      subtitle:
        'Watching NBA Live (Thunder vs Pacers) on Even G2: 576x288 top bar keeps center FOV 100% unobstructed while streaming live Polymarket CLOB depth.',
      hudMode: this.hudController.getMode(),
      receiptCount: this.receipts.length,
    };

    await this.selectScenario('nba-clutch');
    this.setSubtitle(
      1,
      'ACT 1/5 · ZERO-OCCLUSION HUD',
      'Watching NBA Live (Thunder vs Pacers) on Even G2: 576x288 ambient bar keeps center vision 100% clear while streaming live Polymarket CLOB depth.'
    );

    const schedule = (ms: number, fn: () => void) => {
      this.demoTimers.push(setTimeout(fn, ms));
    };

    // Act 2 (5.5s): Wide-spread noise -> Fail-Closed Silent Block
    schedule(5500, () => {
      this.setSubtitle(
        2,
        'ACT 2/5 · FAIL-CLOSED RISK GATE',
        'Coach review widens CLOB spread to 6.4c (> 4.0c cap). Risk Gate silently blocks the noisy spike — zero HUD popup distraction.'
      );
      void this.triggerPulseTemplate(SCENARIO_PULSES['nba-clutch'][0], 0);
    });

    // Act 3 (11.5s): Moderate swing -> Swipe Temple to Dismiss
    schedule(11500, () => {
      this.setSubtitle(
        3,
        'ACT 3/5 · TEMPLE SWIPE DISMISS',
        'Transition tie-game layup (+5.8c lag) pops a 3-line green HUD card. Viewer swipes the G2 temple touchpad to dismiss without looking down.'
      );
      void this.triggerPulseTemplate(SCENARIO_PULSES['nba-clutch'][1], 1);
    });

    schedule(15800, () => {
      simulatorHost.dispatchHardwareGesture(
        OsEventTypeList.SCROLL_BOTTOM_EVENT,
        EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
      );
    });

    // Act 4 (19.0s): NBA Clutch 8-0 Run -> Double-Tap Temple -> 10 USDC Risk-Capped Fill!
    schedule(19000, () => {
      this.setSubtitle(
        4,
        'ACT 4/5 · DOUBLE-TAP 10U EXECUTION',
        'Clutch 8-0 Run! Fair win prob jumps to 78.4c vs 64.0c CLOB ask (+14.4c Edge, 1.0c Spread). Double-tap right temple to execute 10 USDC capped order!'
      );
      void this.triggerPulseTemplate(SCENARIO_PULSES['nba-clutch'][2], 2);
    });

    schedule(23800, () => {
      simulatorHost.dispatchHardwareGesture(
        OsEventTypeList.DOUBLE_CLICK_EVENT,
        EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
      );
    });

    // Act 5 (29.5s): Switch to LoL Esports Baron Steal + Pre-Headline Whale Sentinel + R1 Ring Confirm!
    schedule(29500, () => {
      void (async () => {
        await this.selectScenario('lol-baron');
        this.setSubtitle(
          5,
          'ACT 5/5 · ESPORTS BARON + WHALE GUARD',
          'Esports Mode (LoL Game 5): Pre-Headline Sentinel blocks $1,640 whale trap first, then captures +16c Baron Steal via Even R1 Ring Double-Tap!'
        );
        await this.triggerPulseTemplate(SCENARIO_PULSES['lol-baron'][1], 1);
      })();
    });

    schedule(34000, () => {
      void this.triggerPulseTemplate(SCENARIO_PULSES['lol-baron'][3], 3);
    });

    schedule(38000, () => {
      simulatorHost.dispatchHardwareGesture(
        OsEventTypeList.DOUBLE_CLICK_EVENT,
        EventSourceType.TOUCH_EVENT_FROM_RING
      );
    });

    schedule(43500, () => {
      this.setSubtitle(
        5,
        'READY FOR EVEN G2 & SIMULATOR',
        'LiveEdge HUD · Built on official @evenrealities/even_hub_sdk v0.0.16 · Read-Only CLOB + Zero-Key EIP-712 Sandbox · Packaged as .ehpk'
      );
      if (window.__demoState) {
        window.__demoState.running = false;
        window.__demoState.completed = true;
      }
    });
  }

  private renderWaveguideContainers(): string {
    const scaleX = 100 / G2_DISPLAY_WIDTH;
    const scaleY = 100 / G2_DISPLAY_HEIGHT;

    return this.hostState.containers
      .map((c) => {
        const leftPct = (c.xPosition * scaleX).toFixed(2);
        const topPct = (c.yPosition * scaleY).toFixed(2);
        const widthPct = (c.width * scaleX).toFixed(2);
        const heightPct = (c.height * scaleY).toFixed(2);
        const brightnessClass = `g2-brightness-${Math.min(4, Math.max(0, c.textColor))}`;
        const hasBorder = c.borderWidth > 0;
        const borderStyle = hasBorder
          ? `border: ${c.borderWidth}px solid #00ff66; border-radius: ${c.borderRadius}px;`
          : '';
        const padPx = Math.max(4, c.paddingLength);

        return `<div
          class="g2-sdk-container ${brightnessClass} ${hasBorder ? 'g2-card-box' : ''}"
          style="left:${leftPct}%; top:${topPct}%; width:${widthPct}%; min-height:${heightPct}%; padding:${padPx}px; z-index:${c.zOrderIndex}; ${borderStyle}"
          data-container-name="${this.escapeHtml(c.containerName)}"
        >${this.escapeHtml(c.content)}</div>`;
      })
      .join('');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public render(): void {
    const preset = MARKET_PRESETS[this.scenarioId];
    const book = this.activeBook;
    const pulse = this.activePulse;
    const decision = this.lastDecision;
    const templates = SCENARIO_PULSES[this.scenarioId];

    const fairPct = pulse
      ? `${(pulse.impliedFairProb * 100).toFixed(1)}c`
      : book
        ? `${(book.midPrice * 100).toFixed(1)}c`
        : '--';
    const askPct = book ? `${(book.bestAsk * 100).toFixed(1)}c` : '--';
    const edgeVal = decision ? decision.rawEdge * 100 : 0;
    const edgeStr = decision
      ? `${edgeVal >= 0 ? '+' : ''}${edgeVal.toFixed(1)}c`
      : '0.0c';

    const maxNotional = Math.max(
      100,
      ...(book?.bids.slice(0, 5).map((r) => r.notionalUsdc) ?? [100]),
      ...(book?.asks.slice(0, 5).map((r) => r.notionalUsdc) ?? [100])
    );

    const latestReceipt = this.receipts[0];

    this.root.innerHTML = `
      <div class="studio-shell">
        <header class="top-header">
          <div class="brand-cluster">
            <span class="brand-dot"></span>
            <span class="brand-title">LIVEEDGE HUD</span>
            <span class="brand-sub">EVEN G2 576×288 × POLYMARKET CLOB</span>
          </div>

          <div class="scenario-tabs">
            <button class="scenario-btn ${this.scenarioId === 'nba-clutch' ? 'active' : ''}" data-scenario="nba-clutch">
              🏀 NBA Live · Thunder vs Pacers
            </button>
            <button class="scenario-btn ${this.scenarioId === 'lol-baron' ? 'active' : ''}" data-scenario="lol-baron">
              ⚔️ Esports · LoL Game 5 Baron
            </button>
            <button class="scenario-btn ${this.scenarioId === 'nfl-redzone' ? 'active' : ''}" data-scenario="nfl-redzone">
              🏈 NFL Live · Bengals vs Commanders
            </button>
          </div>

          <div class="header-badges">
            <span class="pill-badge live">● ${
              book?.source === 'LIVE_POLYMARKET_CLOB'
                ? 'LIVE GAMMA+CLOB'
                : book?.source === 'HISTORICAL_L2_REPLAY'
                  ? 'HISTORICAL L2 REPLAY'
                  : 'CLOB SNAPSHOT'
            }</span>
            <span class="pill-badge">CAP: 10.00 USDC</span>
            <button class="demo-reel-btn" id="btn-run-demo">▶ AUTO DEMO REEL</button>
          </div>
        </header>

        ${
          this.discoveredMarkets.length > 0
            ? `<div class="gamma-discovery-bar">
                <span class="gamma-discovery-label">GAMMA LIVE DISCOVERY:</span>
                ${this.discoveredMarkets
                  .slice(0, 4)
                  .map(
                    (m, idx) =>
                      `<button class="gamma-chip" data-gamma-idx="${idx}" title="Load live CLOB orderbook for ${this.escapeHtml(m.question)}">[${m.sportCategory}] ${this.escapeHtml(m.question.slice(0, 34))} · $${Math.round(m.volume24hr / 1000)}k</button>`
                  )
                  .join('')}
              </div>`
            : ''
        }

        <main class="workspace-grid">
          <!-- LEFT PANE: TELEMETRY + CLOB + RISK GATE -->
          <section class="column-stack">
            <div class="panel-card">
              <div class="panel-header">
                <span class="panel-title">① Live Match Pulse Engine</span>
                <span class="panel-meta">${this.escapeHtml(preset.question)}</span>
              </div>

              <div class="scoreboard-banner">
                <div>
                  <div class="score-main">${this.escapeHtml(pulse?.scoreLabel ?? preset.defaultScoreLabel)}</div>
                  <div class="score-clock">${this.escapeHtml(preset.sportTag)} · ${this.escapeHtml(pulse?.clockLabel ?? preset.defaultClockLabel)} · ${this.escapeHtml(pulse?.headline ?? 'Monitoring live match state...')}</div>
                </div>
                <div class="edge-kpi-cluster">
                  <div class="kpi-box">
                    <div class="kpi-label">Match Fair</div>
                    <div class="kpi-val fair">${fairPct}</div>
                  </div>
                  <div class="kpi-box">
                    <div class="kpi-label">PM Best Ask</div>
                    <div class="kpi-val ask">${askPct}</div>
                  </div>
                  <div class="kpi-box">
                    <div class="kpi-label">Lag Edge</div>
                    <div class="kpi-val ${edgeVal >= 4.5 ? 'edge-pos' : 'edge-neutral'}">${edgeStr}</div>
                  </div>
                </div>
              </div>

              <div class="pulse-trigger-grid">
                ${templates
                  .map(
                    (tpl, i) => `
                  <button class="pulse-btn ${this.activePulseIdx === i ? 'active-pulse' : ''}" data-pulse-idx="${i}">
                    <span class="p-tag">${this.escapeHtml(tpl.clockLabel)} · ΔLogOdds +${tpl.deltaLogOdds.toFixed(2)}</span>
                    <span class="p-title">${this.escapeHtml(tpl.headline)}</span>
                  </button>`
                  )
                  .join('')}
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-header">
                <span class="panel-title">② Polymarket CLOB L2 Orderbook (${this.escapeHtml(preset.outcomeLabel)})</span>
                <span class="panel-meta">Spread: ${book ? (book.spread * 100).toFixed(1) : '--'}c · Top-3 Ask Depth: $${book ? book.askDepthTop3Usdc.toLocaleString() : '--'}</span>
              </div>

              <div class="clob-grid">
                <div>
                  <div class="book-side-title"><span>BIDS (BUYERS)</span><span>USDC DEPTH</span></div>
                  ${(book?.bids.slice(0, 5) ?? [])
                    .map((r) => {
                      const pct = Math.min(100, (r.notionalUsdc / maxNotional) * 100).toFixed(1);
                      return `<div class="rung-row">
                        <div class="rung-bar bid" style="width:${pct}%"></div>
                        <span class="bid-price">${(r.price * 100).toFixed(1)}c</span>
                        <span>$${r.notionalUsdc.toLocaleString()}</span>
                      </div>`;
                    })
                    .join('')}
                </div>
                <div>
                  <div class="book-side-title"><span>ASKS (SELLERS)</span><span>USDC DEPTH</span></div>
                  ${(book?.asks.slice(0, 5) ?? [])
                    .map((r) => {
                      const pct = Math.min(100, (r.notionalUsdc / maxNotional) * 100).toFixed(1);
                      return `<div class="rung-row">
                        <div class="rung-bar ask" style="width:${pct}%"></div>
                        <span class="ask-price">${(r.price * 100).toFixed(1)}c</span>
                        <span>$${r.notionalUsdc.toLocaleString()}</span>
                      </div>`;
                    })
                    .join('')}
                </div>
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-header">
                <span class="panel-title">③ Fail-Closed Microstructure & Pre-Headline Risk Gate</span>
                <span class="panel-meta">Silent Block When Any Check Fails</span>
              </div>

              <div class="gate-pills">
                <div class="gate-pill ${!decision || decision.checks.spreadOk ? 'ok' : 'fail'}">
                  SPREAD &lt;= 4.0c<br/><strong>${book ? (book.spread * 100).toFixed(1) : '--'}c</strong>
                </div>
                <div class="gate-pill ${!decision || decision.checks.depthOk ? 'ok' : 'fail'}">
                  DEPTH &gt;= $25<br/><strong>$${decision ? decision.availableDepthUsdc.toFixed(0) : book ? book.askDepthTop3Usdc.toFixed(0) : '--'}</strong>
                </div>
                <div class="gate-pill ${decision ? (decision.checks.edgeOk ? 'ok' : 'fail') : 'ok'}">
                  EDGE &gt;= +4.5c<br/><strong>${edgeStr}</strong>
                </div>
                <div class="gate-pill ${!decision || decision.checks.whaleSafeOk ? 'ok' : 'fail'}">
                  WHALE GUARD<br/><strong>${!decision || decision.checks.whaleSafeOk ? 'SAFE' : 'TRIPPED'}</strong>
                </div>
                <div class="gate-pill ${!decision || decision.checks.riskCapLocked ? 'ok' : 'fail'}">
                  RISK CAP<br/><strong>${!decision || decision.checks.riskCapLocked ? '10.00 USDC' : 'BLOCKED'}</strong>
                </div>
              </div>

              <div class="gate-verdict-banner ${decision ? (decision.passed ? 'pass' : 'block') : 'pass'}">
                <span>${this.escapeHtml(decision ? decision.reason : 'Ambient Watch: Waiting for positive match-state edge...')}</span>
                <span>HUD: ${this.hudController.getMode()}</span>
              </div>
            </div>
          </section>

          <!-- RIGHT PANE: EVEN REALITIES G2 576x288 OPTICAL HUD + TEMPLE GESTURE DECK -->
          <section class="column-stack">
            <div class="glasses-stage">
              <div class="panel-header" style="width:100%; margin-bottom:10px;">
                <span class="panel-title" style="color:#00ff66;">Even Realities G2 · Dual 576×288 Micro-LED Optical HUD</span>
                <span class="panel-meta">SDK Containers: ${this.hostState.containers.length}/8 · Mode: ${this.executionMode} · Battery ${this.hostState.batteryLevel}%</span>
              </div>

              <div class="g2-frame-wrapper">
                <div class="g2-waveguide-screen" id="g2-waveguide">
                  ${this.renderWaveguideContainers()}
                  <div class="arena-pov-watermark">576×288 GREEN WAVEGUIDE · ZERO PHONE LOOKDOWN</div>
                </div>
              </div>

              <div class="temple-deck">
                <div class="temple-Buttons">
                  <button class="gesture-btn primary-confirm ${this.highlightedBtnId === 'btn-double-tap' ? 'gesture-firing' : ''}" id="btn-double-tap">
                    ⚡ Double-Tap Temple (Confirm 10U)
                  </button>
                  <button class="gesture-btn ${this.highlightedBtnId === 'btn-swipe-dismiss' ? 'gesture-firing' : ''}" id="btn-swipe-dismiss">
                    ⇄ Swipe Temple (Ignore)
                  </button>
                  <button class="gesture-btn" id="btn-single-tap">
                    • Single Tap (${this.executionMode === 'FAK' ? 'Switch Post-Only' : 'Switch FAK'})
                  </button>
                  <button class="gesture-btn ${this.highlightedBtnId === 'btn-ring-confirm' ? 'gesture-firing' : ''}" id="btn-ring-confirm">
                    ◎ R1 Ring Double-Tap
                  </button>
                </div>
                <div class="gesture-pulse-indicator">
                  ${
                    this.hostState.lastGesture
                      ? `${this.escapeHtml(this.hostState.lastGesture.label)} · ${this.escapeHtml(this.hostState.lastGesture.source)}`
                      : 'Temple Touchbar Ready'
                  }
                </div>
              </div>
            </div>

            <div class="bottom-inspector-grid">
              <div class="panel-card">
                <div class="panel-header">
                  <span class="panel-title">@evenrealities/even_hub_sdk Wire Inspector</span>
                  <span class="panel-meta">v0.0.16</span>
                </div>
                <div class="log-list">
                  ${this.hostState.protocolLogs
                    .slice(0, 6)
                    .map(
                      (l) => `
                    <div class="log-row">
                      <span class="log-dir ${l.direction === 'GLASSES->WEB' ? 'inbound' : ''}">${l.direction}</span>
                      <span>${this.escapeHtml(l.method)} · ${this.escapeHtml(l.summary)}</span>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>

              <div class="panel-card">
                <div class="panel-header">
                  <span class="panel-title">EIP-712 Sandbox Execution Receipt</span>
                  <span class="panel-meta">Read-Only Money-Safe</span>
                </div>
                <div class="receipt-box">
                  ${
                    latestReceipt
                      ? `<strong>✓ ${this.escapeHtml(latestReceipt.receiptId)} (${latestReceipt.mode})</strong><br/>
                         Filled: ${latestReceipt.filledShares.toFixed(2)} ${this.escapeHtml(latestReceipt.outcomeLabel)} @ ${(latestReceipt.vwapPrice * 100).toFixed(1)}c VWAP<br/>
                         Risk Locked: ${latestReceipt.stakeUsdc.toFixed(2)} / ${latestReceipt.riskCapUsdc.toFixed(2)} USDC · Est EV +$${latestReceipt.expectedValueUsdc.toFixed(2)}<br/>
                         EIP-712 Digest: ${latestReceipt.eip712Digest.slice(0, 18)}...${latestReceipt.eip712Digest.slice(-8)}<br/>
                         Status: SANDBOX_SIMULATED (0 Real Funds At Risk)`
                      : `No sandbox order executed yet.<br/>Trigger a passing match swing (+Edge &amp; Spread &lt;= 4c), then <strong>Double-Tap Temple</strong> to fill with hard 10.00 USDC Risk Cap.`
                  }
                </div>
              </div>
            </div>
          </section>
        </main>

        <div class="subtitle-overlay ${this.subtitleText ? '' : 'hidden'}" id="demo-subtitle-bar">
          <span class="subtitle-act-tag">${this.escapeHtml(this.subtitleTag)}</span>
          <span class="subtitle-text">${this.escapeHtml(this.subtitleText)}</span>
        </div>
      </div>
    `;

    this.bindDomEvents();
  }

  private bindDomEvents(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-scenario]')
      .forEach((btn) => {
        btn.onclick = () => {
          const sc = btn.dataset.scenario as MatchScenarioId;
          void this.selectScenario(sc);
        };
      });

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-gamma-idx]')
      .forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.gammaIdx ?? -1);
          const m = this.discoveredMarkets[idx];
          if (m) void this.selectDiscoveredMarket(m);
        };
      });

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-pulse-idx]')
      .forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.pulseIdx ?? 0);
          const tpl = SCENARIO_PULSES[this.scenarioId][idx];
          if (tpl) void this.triggerPulseTemplate(tpl, idx);
        };
      });

    const btnDemo = this.root.querySelector<HTMLButtonElement>('#btn-run-demo');
    if (btnDemo) {
      btnDemo.onclick = () => {
        void this.startChoreographedDemoReel();
      };
    }

    const btnDoubleTap =
      this.root.querySelector<HTMLButtonElement>('#btn-double-tap');
    if (btnDoubleTap) {
      btnDoubleTap.onclick = () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.DOUBLE_CLICK_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
        );
      };
    }

    const btnSwipe =
      this.root.querySelector<HTMLButtonElement>('#btn-swipe-dismiss');
    if (btnSwipe) {
      btnSwipe.onclick = () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.SCROLL_BOTTOM_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
        );
      };
    }

    const btnSingleTap =
      this.root.querySelector<HTMLButtonElement>('#btn-single-tap');
    if (btnSingleTap) {
      btnSingleTap.onclick = () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.CLICK_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
        );
      };
    }

    const btnRing =
      this.root.querySelector<HTMLButtonElement>('#btn-ring-confirm');
    if (btnRing) {
      btnRing.onclick = () => {
        simulatorHost.dispatchHardwareGesture(
          OsEventTypeList.DOUBLE_CLICK_EVENT,
          EventSourceType.TOUCH_EVENT_FROM_RING
        );
      };
    }
  }
}
