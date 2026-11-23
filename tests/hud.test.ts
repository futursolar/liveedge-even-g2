import {
  EventSourceType,
  OsEventTypeList,
  validateEvenHubPageContainer,
} from '@evenrealities/even_hub_sdk';
import { describe, expect, it } from 'vitest';
import { MARKET_PRESETS, normalizeOrderbook } from '../src/engine/polymarketClient';
import { materializePulseEvent, SCENARIO_PULSES } from '../src/engine/pulseEngine';
import { evaluateRiskGate } from '../src/engine/riskGate';
import { executeRiskGatedSandboxOrder } from '../src/engine/sandboxSigner';
import {
  buildActiveCardPageContainer,
  buildIdlePageContainer,
  G2_DISPLAY_HEIGHT,
  G2_DISPLAY_WIDTH,
  LiveEdgeHudController,
} from '../src/hud/evenBridgeController';
import { simulatorHost } from '../src/hud/mockFlutterHost';

describe('Even Realities G2 576x288 SDK Container & Gesture Compliance', () => {
  it('validates idle and active HUD layouts against official @evenrealities/even_hub_sdk rules', () => {
    const idle = buildIdlePageContainer('[NBA LIVE] OKC 104-103 IND · PM 64.0c');
    const active = buildActiveCardPageContainer({
      headerLine: '⚡ CLUTCH 8-0 RUN (+14.4c)',
      bodyThreeLines: 'LINE 1\nLINE 2\nLINE 3',
      footerLine: '[DOUBLE-TAP] CONFIRM 10U | [SWIPE] IGNORE',
    });

    expect(validateEvenHubPageContainer(idle)).toEqual({ valid: true });
    expect(validateEvenHubPageContainer(active)).toEqual({ valid: true });

    // Verify every container stays strictly inside 576x288 optical bounds and exactly 1 has isEventCapture=1
    const captureCount = (active.textObject ?? []).filter(
      (c) => c.isEventCapture === 1
    ).length;
    expect(captureCount).toBe(1);

    for (const c of active.textObject ?? []) {
      expect((c.xPosition ?? 0) + (c.width ?? 0)).toBeLessThanOrEqual(
        G2_DISPLAY_WIDTH
      );
      expect((c.yPosition ?? 0) + (c.height ?? 0)).toBeLessThanOrEqual(
        G2_DISPLAY_HEIGHT
      );
    }
  });

  it('drives end-to-end HUD state machine: Idle -> Edge Alert -> Swipe Dismiss -> Double-Tap Fill -> Shutdown(1)', async () => {
    const preset = MARKET_PRESETS['nba-clutch'];
    const book = normalizeOrderbook(
      { bids: preset.fallbackBids, asks: preset.fallbackAsks },
      {
        marketSlug: preset.marketSlug,
        question: preset.question,
        outcomeLabel: preset.outcomeLabel,
        tokenId: preset.tokenId,
        source: 'SNAPSHOT_FALLBACK',
      }
    );
    const pulse = materializePulseEvent(
      'nba-clutch',
      'NBA LIVE',
      SCENARIO_PULSES['nba-clutch'][2],
      book.bestAsk
    );
    const decision = evaluateRiskGate(pulse, book);

    let dismissedCount = 0;
    let filledCount = 0;

    const hud = new LiveEdgeHudController({
      onConfirmOrder: async (mode) => {
        filledCount += 1;
        return executeRiskGatedSandboxOrder({
          book,
          decision,
          fairProb: pulse.impliedFairProb,
          mode,
        });
      },
      onDismissAlert: () => {
        dismissedCount += 1;
      },
      onToggleExecutionMode: () => {},
    });

    await hud.initialize('[NBA LIVE] OKC 104-103 IND · Q4 02:18');
    expect(hud.getMode()).toBe('IDLE_SCOREBAR');
    expect(simulatorHost.snapshot().containers.length).toBe(1);

    // 1. Pop Edge Alert -> 3 containers rendered
    const shown = await hud.presentEdgeAlert({ pulse, book, decision });
    expect(shown).toBe(true);
    expect(hud.getMode()).toBe('EDGE_ALERT');
    expect(simulatorHost.snapshot().containers.length).toBe(3);

    // 2. Single tap toggles FAK -> POST_ONLY
    simulatorHost.dispatchHardwareGesture(
      OsEventTypeList.CLICK_EVENT,
      EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(hud.getExecutionMode()).toBe('POST_ONLY');

    // 3. Swipe dismisses back to IDLE_SCOREBAR
    simulatorHost.dispatchHardwareGesture(
      OsEventTypeList.SCROLL_BOTTOM_EVENT,
      EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(dismissedCount).toBe(1);
    expect(hud.getMode()).toBe('IDLE_SCOREBAR');

    // 4. Present alert again & Double-Tap confirms order -> ORDER_RECEIPT
    await hud.presentEdgeAlert({ pulse, book, decision });
    simulatorHost.dispatchHardwareGesture(
      OsEventTypeList.DOUBLE_CLICK_EVENT,
      EventSourceType.TOUCH_EVENT_FROM_RING
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(filledCount).toBe(1);
    expect(hud.getMode()).toBe('ORDER_RECEIPT');
    expect(simulatorHost.snapshot().containers[1].content).toContain('FILLED');

    // 5. Return to idle and verify QA root double-tap calls shutDownPageContainer(1)
    await hud.returnToIdle();
    simulatorHost.dispatchHardwareGesture(
      OsEventTypeList.DOUBLE_CLICK_EVENT,
      EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(simulatorHost.snapshot().lastExitMode).toBe(1);

    hud.dispose();
  });
});
