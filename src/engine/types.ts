export interface OrderbookRung {
  price: number;
  size: number;
  notionalUsdc: number;
}

export type OrderbookSource =
  | 'LIVE_POLYMARKET_CLOB'
  | 'SNAPSHOT_FALLBACK'
  | 'HISTORICAL_L2_REPLAY';

export interface NormalizedOrderbook {
  marketSlug: string;
  question: string;
  outcomeLabel: string;
  tokenId: string;
  bids: OrderbookRung[];
  asks: OrderbookRung[];
  bestBid: number;
  bestAsk: number;
  spread: number;
  midPrice: number;
  askDepthTop3Usdc: number;
  bidDepthTop3Usdc: number;
  adverseWhaleFlowUsdc: number;
  volume24hrUsdc?: number;
  source: OrderbookSource;
  fetchedAtMs: number;
}

export type MatchScenarioId = 'lol-baron' | 'nba-clutch' | 'nfl-redzone';

export interface MatchPulseEvent {
  id: string;
  scenarioId: MatchScenarioId;
  sportTag: string;
  clockLabel: string;
  scoreLabel: string;
  headline: string;
  detail: string;
  deltaLogOdds: number;
  priorWinProb: number;
  impliedFairProb: number;
  adverseWhaleFlowUsdc: number;
  cuiBonoSafe: boolean;
  whaleNote: string;
  syntheticSpreadOverride?: number;
  syntheticDepthScale?: number;
  createdAtMs: number;
}

export interface RiskGateConfig {
  minEdge: number;
  maxSpread: number;
  minTopAskDepthUsdc: number;
  fixedRiskCapUsdc: number;
  maxSlippage: number;
  maxAdverseWhaleFlowUsdc: number;
  maxStalenessMs: number;
}

export type RiskRejectionCode =
  | 'NONE'
  | 'RISK_CAP_VIOLATION'
  | 'STALE_DATA'
  | 'CUI_BONO_THESIS_INVALIDATED'
  | 'WHALE_TOXICITY_ALERT'
  | 'EDGE_BELOW_THRESHOLD'
  | 'SPREAD_TOO_WIDE'
  | 'INSUFFICIENT_DEPTH';

export interface RiskGateChecks {
  freshnessOk: boolean;
  whaleSafeOk: boolean;
  edgeOk: boolean;
  spreadOk: boolean;
  depthOk: boolean;
  riskCapLocked: boolean;
}

export interface RiskGateDecision {
  passed: boolean;
  rejectionCode: RiskRejectionCode;
  reason: string;
  rawEdge: number;
  spread: number;
  availableDepthUsdc: number;
  stakeUsdc: number;
  limitPrice: number;
  estimatedShares: number;
  expectedValueUsdc: number;
  checks: RiskGateChecks;
}

export type ExecutionMode = 'FAK' | 'POST_ONLY';
export type SignerMode = 'SANDBOX_SIM' | 'WEB3_EIP712';

/**
 * Polymarket CTFExchange.sol Side enum (`uint8`):
 * 0 = BUY, 1 = SELL
 */
export type PolymarketOrderSideCode = 0 | 1;

export interface Eip712PolymarketOrder {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: PolymarketOrderSideCode;
  signatureType: number;
}

export interface ExecutionReceipt {
  receiptId: string;
  mode: ExecutionMode;
  signerMode: SignerMode;
  marketSlug: string;
  outcomeLabel: string;
  tokenId: string;
  stakeUsdc: number;
  filledShares: number;
  vwapPrice: number;
  limitPrice: number;
  slippage: number;
  riskCapUsdc: number;
  expectedValueUsdc: number;
  eip712Digest: string;
  signaturePreview: string;
  executedAtIso: string;
  simulatedOnly: true;
}

export type HudDisplayMode =
  | 'IDLE_SCOREBAR'
  | 'EDGE_ALERT'
  | 'ORDER_RECEIPT'
  | 'DISMISSED_COOLDOWN';

export interface HudRenderSnapshot {
  mode: HudDisplayMode;
  topBarText: string;
  cardBodyText: string;
  footerHintText: string;
  updatedAtMs: number;
}
