import {
  CreateStartUpPageContainer,
  type EvenAppBridge,
  type EvenHubEvent,
  EventSourceType,
  formatEvenHubPageContainerValidationError,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  validateEvenHubPageContainer,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type {
  ExecutionMode,
  ExecutionReceipt,
  HudDisplayMode,
  HudRenderSnapshot,
  MatchPulseEvent,
  NormalizedOrderbook,
  RiskGateDecision,
} from '../engine/types';
import { simulatorHost } from './mockFlutterHost';

export const G2_DISPLAY_WIDTH = 576;
export const G2_DISPLAY_HEIGHT = 288;

const HUD_MENU = new MenuContainerProperty({
  menuItems: [
    new MenuItemProperty({ itemID: 1, itemName: 'Toggle FAK / Post-Only' }),
    new MenuItemProperty({ itemID: 2, itemName: 'Replay Key Match Swing' }),
    new MenuItemProperty({ itemID: 3, itemName: 'Clear Active Alert' }),
    new MenuItemProperty({ itemID: 4, itemName: 'Exit LiveEdge HUD' }),
  ],
});

export interface HudCallbacks {
  onConfirmOrder: (
    mode: ExecutionMode,
    source: EventSourceType
  ) => Promise<ExecutionReceipt | null>;
  onDismissAlert: (source: EventSourceType) => void;
  onToggleExecutionMode: (nextMode: ExecutionMode) => void;
  onMenuReplayRequested?: () => void;
  onStateChanged?: (snapshot: HudRenderSnapshot) => void;
}

export function buildIdlePageContainer(
  scoreBarLine: string
): CreateStartUpPageContainer {
  const textObject: TextContainerProperty[] = [
    new TextContainerProperty({
      containerID: 1,
      containerName: 'ambient-scorebar',
      xPosition: 16,
      yPosition: 8,
      width: 544,
      height: 36,
      borderWidth: 0,
      paddingLength: 4,
      textColor: 2, // Subtle dim green for zero distraction
      isEventCapture: 1, // SDK rule: exactly 1 container captures events
      zOrderIndex: 1,
      content: scoreBarLine,
    }),
  ];

  const payload = new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject,
    menuObject: HUD_MENU,
  });

  const check = validateEvenHubPageContainer(payload);
  if (!check.valid) {
    throw new Error(formatEvenHubPageContainerValidationError(check));
  }
  return payload;
}

export function buildActiveCardPageContainer(params: {
  headerLine: string;
  bodyThreeLines: string;
  footerLine: string;
}): RebuildPageContainer {
  const textObject: TextContainerProperty[] = [
    new TextContainerProperty({
      containerID: 1,
      containerName: 'pulse-header',
      xPosition: 16,
      yPosition: 10,
      width: 544,
      height: 36,
      borderWidth: 0,
      paddingLength: 2,
      textColor: 3,
      isEventCapture: 0,
      zOrderIndex: 1,
      content: params.headerLine,
    }),
    new TextContainerProperty({
      containerID: 2,
      containerName: 'edge-card',
      xPosition: 16,
      yPosition: 52,
      width: 544,
      height: 164,
      borderWidth: 1,
      borderColor: 4,
      borderRadius: 6,
      paddingLength: 10,
      textColor: 4, // Maximum crisp G2 brightness (level 4)
      isEventCapture: 1, // SDK rule: single active event capture container
      zOrderIndex: 2,
      content: params.bodyThreeLines,
    }),
    new TextContainerProperty({
      containerID: 3,
      containerName: 'gesture-hint',
      xPosition: 16,
      yPosition: 226,
      width: 544,
      height: 46,
      borderWidth: 0,
      paddingLength: 4,
      textColor: 3,
      isEventCapture: 0,
      zOrderIndex: 3,
      content: params.footerLine,
    }),
  ];

  const payload = new RebuildPageContainer({
    containerTotalNum: 3,
    textObject,
    menuObject: HUD_MENU,
  });

  const check = validateEvenHubPageContainer(payload);
  if (!check.valid) {
    throw new Error(formatEvenHubPageContainerValidationError(check));
  }
  return payload;
}

export function formatIdleScoreBar(params: {
  sportTag: string;
  scoreLabel: string;
  clockLabel: string;
  outcomeLabel: string;
  bestAsk: number;
}): string {
  const cents = (params.bestAsk * 100).toFixed(1);
  return `[${params.sportTag}] ${params.scoreLabel} · ${params.clockLabel} · ${params.outcomeLabel} ${cents}c`;
}

export function formatEdgeAlertCard(params: {
  pulse: MatchPulseEvent;
  book: NormalizedOrderbook;
  decision: RiskGateDecision;
  executionMode: ExecutionMode;
}): { headerLine: string; bodyThreeLines: string; footerLine: string } {
  const fairC = (params.pulse.impliedFairProb * 100).toFixed(1);
  const askC = (params.book.bestAsk * 100).toFixed(1);
  const edgeC = (params.decision.rawEdge * 100).toFixed(1);
  const limitC = (params.decision.limitPrice * 100).toFixed(1);
  const spreadC = (params.book.spread * 100).toFixed(1);

  const headerLine = `⚡ ${params.pulse.clockLabel} ${params.pulse.headline.slice(0, 34)} (+${edgeC}c)`;
  const line1 = `BUY ${params.book.outcomeLabel} <=${limitC}c [${params.executionMode}] · FAIR ${fairC}c vs ASK ${askC}c`;
  const line2 = `GATE PASS: SPREAD ${spreadC}c <=4c · DEPTH $${params.decision.availableDepthUsdc.toFixed(0)} · WHALE SAFE`;
  const line3 = `RISK CAP ${params.decision.stakeUsdc.toFixed(2)} USDC -> ~${params.decision.estimatedShares.toFixed(2)} SH (+$${params.decision.expectedValueUsdc.toFixed(2)} EV)`;

  return {
    headerLine,
    bodyThreeLines: `${line1}\n${line2}\n${line3}`,
    footerLine: `[DOUBLE-TAP] CONFIRM 10U  |  [TAP] ${params.executionMode === 'FAK' ? 'POST-ONLY' : 'FAK'}  |  [SWIPE] IGNORE`,
  };
}

export function formatOrderReceiptCard(receipt: ExecutionReceipt): {
  headerLine: string;
  bodyThreeLines: string;
  footerLine: string;
} {
  const vwapC = (receipt.vwapPrice * 100).toFixed(1);
  const slipC = (receipt.slippage * 100).toFixed(2);
  const shortDigest = `${receipt.eip712Digest.slice(0, 10)}..${receipt.eip712Digest.slice(-6)}`;

  return {
    headerLine: `✓ SANDBOX ORDER FILLED · ${receipt.receiptId} · ZERO PHONE LOOKDOWN`,
    bodyThreeLines: [
      `FILLED ${receipt.filledShares.toFixed(2)} ${receipt.outcomeLabel} @ ${vwapC}c VWAP (${receipt.mode})`,
      `RISK LOCKED: ${receipt.stakeUsdc.toFixed(2)} / ${receipt.riskCapUsdc.toFixed(2)} USDC CAP · SLIP ${slipC}c`,
      `EIP-712 DIGEST ${shortDigest} · +$${receipt.expectedValueUsdc.toFixed(2)} EST EV`,
    ].join('\n'),
    footerLine: `AUTO-RETURNING TO ZERO-OCCLUSION SCOREBAR... [SWIPE TO HIDE NOW]`,
  };
}

export class LiveEdgeHudController {
  private bridge: EvenAppBridge | null = null;
  private unsubscribeHub: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private mode: HudDisplayMode = 'IDLE_SCOREBAR';
  private executionMode: ExecutionMode = 'FAK';
  private idleScoreLine = '[LIVE] CONNECTING TO POLYMARKET CLOB...';
  private activeAlertContext: {
    pulse: MatchPulseEvent;
    book: NormalizedOrderbook;
    decision: RiskGateDecision;
  } | null = null;
  private lastSnapshot: HudRenderSnapshot = {
    mode: 'IDLE_SCOREBAR',
    topBarText: this.idleScoreLine,
    cardBodyText: '',
    footerHintText: '',
    updatedAtMs: Date.now(),
  };
  private isConfirming = false;

  constructor(private readonly callbacks: HudCallbacks) {}

  public async initialize(initialScoreLine: string): Promise<void> {
    simulatorHost.installIfNeeded();
    this.idleScoreLine = initialScoreLine;
    this.bridge = await waitForEvenAppBridge();

    await this.bridge.getDeviceInfo();
    const startupPayload = buildIdlePageContainer(initialScoreLine);
    const res = await this.bridge.createStartUpPageContainer(startupPayload);
    if (res !== StartUpPageCreateResult.success) {
      throw new Error(`Failed to create G2 startup page container: code=${res}`);
    }

    this.unsubscribeHub = this.bridge.onEvenHubEvent((ev) => {
      void this.handleEvenHubEvent(ev);
    });

    this.updateSnapshot({
      mode: 'IDLE_SCOREBAR',
      topBarText: initialScoreLine,
      cardBodyText: '',
      footerHintText: '',
      updatedAtMs: Date.now(),
    });
  }

  public getMode(): HudDisplayMode {
    return this.mode;
  }

  public getExecutionMode(): ExecutionMode {
    return this.executionMode;
  }

  public getSnapshot(): HudRenderSnapshot {
    return { ...this.lastSnapshot };
  }

  public async setExecutionMode(next: ExecutionMode): Promise<void> {
    this.executionMode = next;
    this.callbacks.onToggleExecutionMode(next);
    if (this.mode === 'EDGE_ALERT' && this.activeAlertContext && this.bridge) {
      const formatted = formatEdgeAlertCard({
        ...this.activeAlertContext,
        executionMode: this.executionMode,
      });
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 2,
          containerName: 'edge-card',
          content: formatted.bodyThreeLines,
          textColor: 4,
        })
      );
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 3,
          containerName: 'gesture-hint',
          content: formatted.footerLine,
          textColor: 3,
        })
      );
      this.updateSnapshot({
        mode: 'EDGE_ALERT',
        topBarText: formatted.headerLine,
        cardBodyText: formatted.bodyThreeLines,
        footerHintText: formatted.footerLine,
        updatedAtMs: Date.now(),
      });
    }
  }

  public async updateAmbientScoreBar(scoreLine: string): Promise<void> {
    this.idleScoreLine = scoreLine;
    if (this.mode !== 'IDLE_SCOREBAR' || !this.bridge) return;
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'ambient-scorebar',
        content: scoreLine,
        textColor: 2,
      })
    );
    this.updateSnapshot({
      mode: 'IDLE_SCOREBAR',
      topBarText: scoreLine,
      cardBodyText: '',
      footerHintText: '',
      updatedAtMs: Date.now(),
    });
  }

  public async presentEdgeAlert(params: {
    pulse: MatchPulseEvent;
    book: NormalizedOrderbook;
    decision: RiskGateDecision;
  }): Promise<boolean> {
    if (!params.decision.passed || !this.bridge) {
      // Fail-closed silent block: never disturb the viewer when risk checks fail
      return false;
    }
    this.clearAutoHide();
    this.activeAlertContext = params;
    const formatted = formatEdgeAlertCard({
      ...params,
      executionMode: this.executionMode,
    });

    const container = buildActiveCardPageContainer(formatted);
    await this.bridge.rebuildPageContainer(container);
    this.mode = 'EDGE_ALERT';

    this.updateSnapshot({
      mode: 'EDGE_ALERT',
      topBarText: formatted.headerLine,
      cardBodyText: formatted.bodyThreeLines,
      footerHintText: formatted.footerLine,
      updatedAtMs: Date.now(),
    });
    return true;
  }

  public async returnToIdle(): Promise<void> {
    this.clearAutoHide();
    this.activeAlertContext = null;
    if (!this.bridge) return;
    const idle = buildIdlePageContainer(this.idleScoreLine);
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: idle.containerTotalNum,
        textObject: idle.textObject,
        menuObject: idle.menuObject,
      })
    );
    this.mode = 'IDLE_SCOREBAR';
    this.updateSnapshot({
      mode: 'IDLE_SCOREBAR',
      topBarText: this.idleScoreLine,
      cardBodyText: '',
      footerHintText: '',
      updatedAtMs: Date.now(),
    });
  }

  public async handleEvenHubEvent(event: EvenHubEvent): Promise<void> {
    if (!this.bridge) return;

    if (event.menuItemClickEvent?.itemID) {
      const id = event.menuItemClickEvent.itemID;
      if (id === 1) {
        await this.setExecutionMode(
          this.executionMode === 'FAK' ? 'POST_ONLY' : 'FAK'
        );
      } else if (id === 2) {
        this.callbacks.onMenuReplayRequested?.();
      } else if (id === 3) {
        await this.returnToIdle();
      } else if (id === 4) {
        await this.bridge.shutDownPageContainer(1);
      }
      return;
    }

    const eventType =
      event.sysEvent?.eventType ??
      event.textEvent?.eventType ??
      event.listEvent?.eventType;
    const source =
      event.sysEvent?.eventSource ?? EventSourceType.TOUCH_EVENT_FROM_GLASSES_R;

    if (eventType === undefined) return;

    if (this.mode === 'EDGE_ALERT') {
      if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        if (this.isConfirming) return;
        this.isConfirming = true;
        try {
          const receipt = await this.callbacks.onConfirmOrder(
            this.executionMode,
            source
          );
          if (receipt) {
            await this.presentReceipt(receipt);
          }
        } finally {
          this.isConfirming = false;
        }
        return;
      }

      if (
        eventType === OsEventTypeList.SCROLL_TOP_EVENT ||
        eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT
      ) {
        this.mode = 'DISMISSED_COOLDOWN';
        this.callbacks.onDismissAlert(source);
        await this.returnToIdle();
        return;
      }

      if (eventType === OsEventTypeList.CLICK_EVENT) {
        await this.setExecutionMode(
          this.executionMode === 'FAK' ? 'POST_ONLY' : 'FAK'
        );
        return;
      }
    } else if (this.mode === 'ORDER_RECEIPT') {
      if (
        eventType === OsEventTypeList.SCROLL_TOP_EVENT ||
        eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ||
        eventType === OsEventTypeList.CLICK_EVENT
      ) {
        await this.returnToIdle();
      }
    } else if (this.mode === 'IDLE_SCOREBAR') {
      if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        // Official QA lifecycle rule: root double-tap invokes shutDownPageContainer(1)
        await this.bridge.shutDownPageContainer(1);
      }
    }
  }

  private async presentReceipt(receipt: ExecutionReceipt): Promise<void> {
    if (!this.bridge) return;
    this.mode = 'ORDER_RECEIPT';
    this.activeAlertContext = null;
    const formatted = formatOrderReceiptCard(receipt);

    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'pulse-header',
        content: formatted.headerLine,
        textColor: 4,
      })
    );
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: 'edge-card',
        content: formatted.bodyThreeLines,
        textColor: 4,
      })
    );
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 3,
        containerName: 'gesture-hint',
        content: formatted.footerLine,
        textColor: 3,
      })
    );

    this.updateSnapshot({
      mode: 'ORDER_RECEIPT',
      topBarText: formatted.headerLine,
      cardBodyText: formatted.bodyThreeLines,
      footerHintText: formatted.footerLine,
      updatedAtMs: Date.now(),
    });

    this.clearAutoHide();
    this.autoHideTimer = setTimeout(() => {
      void this.returnToIdle();
    }, 4400);
  }

  private updateSnapshot(snap: HudRenderSnapshot): void {
    this.lastSnapshot = snap;
    this.callbacks.onStateChanged?.(snap);
  }

  private clearAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  public dispose(): void {
    this.clearAutoHide();
    this.unsubscribeHub?.();
    this.unsubscribeHub = null;
  }
}
