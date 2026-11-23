import { computeExecutableAskDepthUsdc, simulateVwapBuy } from './polymarketClient';
import type {
  MatchPulseEvent,
  NormalizedOrderbook,
  RiskGateConfig,
  RiskGateDecision,
} from './types';

export const DEFAULT_RISK_GATE_CONFIG: RiskGateConfig = {
  minEdge: 0.045, // +4.5c minimum lag edge
  maxSpread: 0.04, // <= 4.0c CLOB bid-ask spread
  minTopAskDepthUsdc: 25.0, // >= 25 USDC executable ask depth
  fixedRiskCapUsdc: 10.0, // Hard 10 USDC max risk per gesture
  maxSlippage: 0.015, // <= 1.5c max execution slippage
  maxAdverseWhaleFlowUsdc: 1000.0, // Pre-headline counter-whale sentinel
  maxStalenessMs: 30000, // 30s staleness guard
};

/**
 * Evaluates a live match pulse against Polymarket CLOB microstructure and
 * Pre-Headline Whale/Cui-Bono sentinels. Fails closed (silent block on G2 HUD)
 * whenever any safety condition or numeric finiteness invariant is violated.
 */
export function evaluateRiskGate(
  pulse: MatchPulseEvent,
  book: NormalizedOrderbook,
  requestedStakeUsdc = DEFAULT_RISK_GATE_CONFIG.fixedRiskCapUsdc,
  config: RiskGateConfig = DEFAULT_RISK_GATE_CONFIG,
  nowMs = Date.now()
): RiskGateDecision {
  const configFinite =
    Number.isFinite(config.fixedRiskCapUsdc) &&
    config.fixedRiskCapUsdc > 0 &&
    Number.isFinite(config.minEdge) &&
    Number.isFinite(config.maxSpread) &&
    Number.isFinite(config.minTopAskDepthUsdc) &&
    Number.isFinite(config.maxSlippage) &&
    Number.isFinite(config.maxAdverseWhaleFlowUsdc) &&
    Number.isFinite(config.maxStalenessMs);

  const stakeInputValid =
    Number.isFinite(requestedStakeUsdc) && requestedStakeUsdc > 0;

  const marketInputsFinite =
    Number.isFinite(nowMs) &&
    Number.isFinite(pulse.impliedFairProb) &&
    pulse.impliedFairProb > 0 &&
    pulse.impliedFairProb < 1 &&
    Number.isFinite(pulse.createdAtMs) &&
    Number.isFinite(pulse.adverseWhaleFlowUsdc) &&
    Number.isFinite(book.bestAsk) &&
    book.bestAsk > 0 &&
    book.bestAsk < 1 &&
    Number.isFinite(book.bestBid) &&
    Number.isFinite(book.spread) &&
    book.spread >= 0 &&
    Number.isFinite(book.fetchedAtMs) &&
    Number.isFinite(book.adverseWhaleFlowUsdc);

  const safeSpread = Number.isFinite(book.spread) && book.spread >= 0 ? book.spread : 1;
  const minClipUsdc = configFinite ? Math.min(1, config.fixedRiskCapUsdc) : 0;
  const stakeUsdc =
    configFinite && stakeInputValid
      ? Number(
          Math.max(
            minClipUsdc,
            Math.min(requestedStakeUsdc, config.fixedRiskCapUsdc)
          ).toFixed(2)
        )
      : 0;

  const limitPrice = marketInputsFinite && configFinite
    ? Number(Math.min(0.99, book.bestAsk + config.maxSlippage).toFixed(4))
    : 0;
  const rawEdge = marketInputsFinite
    ? Number((pulse.impliedFairProb - book.bestAsk).toFixed(4))
    : 0;
  const availableDepthUsdc =
    marketInputsFinite && limitPrice > 0
      ? computeExecutableAskDepthUsdc(book.asks, limitPrice)
      : 0;

  const pulseAgeMs = marketInputsFinite ? Math.max(0, nowMs - pulse.createdAtMs) : Number.POSITIVE_INFINITY;
  const bookAgeMs = marketInputsFinite ? Math.max(0, nowMs - book.fetchedAtMs) : Number.POSITIVE_INFINITY;

  const riskCapLocked =
    configFinite &&
    stakeInputValid &&
    marketInputsFinite &&
    Number.isFinite(stakeUsdc) &&
    stakeUsdc > 0 &&
    stakeUsdc <= config.fixedRiskCapUsdc;

  const freshnessOk =
    configFinite &&
    marketInputsFinite &&
    pulseAgeMs <= config.maxStalenessMs &&
    bookAgeMs <= config.maxStalenessMs;
  const cuiBonoOk = Boolean(pulse.cuiBonoSafe);
  const whaleFlowOk =
    configFinite &&
    marketInputsFinite &&
    book.adverseWhaleFlowUsdc < config.maxAdverseWhaleFlowUsdc &&
    pulse.adverseWhaleFlowUsdc < config.maxAdverseWhaleFlowUsdc;
  const whaleSafeOk = cuiBonoOk && whaleFlowOk;
  const edgeOk = configFinite && marketInputsFinite && rawEdge >= config.minEdge;
  const spreadOk =
    configFinite &&
    marketInputsFinite &&
    book.asks.length > 0 &&
    book.bids.length > 0 &&
    book.spread <= config.maxSpread;
  const depthOk =
    configFinite &&
    marketInputsFinite &&
    availableDepthUsdc >= config.minTopAskDepthUsdc;

  const vwapSim =
    riskCapLocked && limitPrice > 0
      ? simulateVwapBuy(book.asks, stakeUsdc, limitPrice)
      : { filledUsdc: 0, filledShares: 0, vwapPrice: 0, slippageFromBestAsk: 0 };

  const estimatedShares = riskCapLocked
    ? vwapSim.filledShares > 0
      ? vwapSim.filledShares
      : Number((stakeUsdc / Math.max(0.01, book.bestAsk)).toFixed(2))
    : 0;
  const effectiveCost = riskCapLocked
    ? vwapSim.filledUsdc > 0
      ? vwapSim.filledUsdc
      : stakeUsdc
    : 0;
  const expectedValueUsdc = riskCapLocked
    ? Number((estimatedShares * pulse.impliedFairProb - effectiveCost).toFixed(2))
    : 0;

  const checks = {
    freshnessOk,
    whaleSafeOk,
    edgeOk,
    spreadOk,
    depthOk,
    riskCapLocked,
  };

  if (!checks.riskCapLocked) {
    return {
      passed: false,
      rejectionCode: 'RISK_CAP_VIOLATION',
      reason: 'Silent Block: Invalid or non-finite stake / risk-cap parameter (Fail-Closed)',
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  if (!freshnessOk) {
    return {
      passed: false,
      rejectionCode: 'STALE_DATA',
      reason: `Silent Block: Telemetry/CLOB snapshot older than ${(config.maxStalenessMs / 1000).toFixed(0)}s`,
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  if (!cuiBonoOk) {
    return {
      passed: false,
      rejectionCode: 'CUI_BONO_THESIS_INVALIDATED',
      reason: 'Silent Block: Pre-headline Cui Bono / counter-incentive sentinel tripped',
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  if (!whaleFlowOk) {
    const flow = Math.max(book.adverseWhaleFlowUsdc, pulse.adverseWhaleFlowUsdc);
    return {
      passed: false,
      rejectionCode: 'WHALE_TOXICITY_ALERT',
      reason: `Silent Block: Adverse smart-money sweep ($${flow.toFixed(0)} >= $${config.maxAdverseWhaleFlowUsdc.toFixed(0)})`,
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  if (!spreadOk) {
    return {
      passed: false,
      rejectionCode: 'SPREAD_TOO_WIDE',
      reason: `Silent Block: CLOB spread ${(safeSpread * 100).toFixed(1)}c > ${(config.maxSpread * 100).toFixed(1)}c cap`,
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  if (!depthOk) {
    return {
      passed: false,
      rejectionCode: 'INSUFFICIENT_DEPTH',
      reason: `Silent Block: Top ask depth $${availableDepthUsdc.toFixed(0)} < $${config.minTopAskDepthUsdc.toFixed(0)} floor`,
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  if (!edgeOk) {
    return {
      passed: false,
      rejectionCode: 'EDGE_BELOW_THRESHOLD',
      reason: `Silent Block: Lag edge ${(rawEdge * 100).toFixed(1)}c < ${(config.minEdge * 100).toFixed(1)}c threshold`,
      rawEdge,
      spread: safeSpread,
      availableDepthUsdc,
      stakeUsdc,
      limitPrice,
      estimatedShares,
      expectedValueUsdc,
      checks,
    };
  }

  return {
    passed: true,
    rejectionCode: 'NONE',
    reason: `PASS: +${(rawEdge * 100).toFixed(1)}c Edge · ${(safeSpread * 100).toFixed(1)}c Spread · $${availableDepthUsdc.toFixed(0)} Depth`,
    rawEdge,
    spread: safeSpread,
    availableDepthUsdc,
    stakeUsdc,
    limitPrice,
    estimatedShares,
    expectedValueUsdc,
    checks,
  };
}
