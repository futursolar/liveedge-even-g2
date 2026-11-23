import { simulateVwapBuy } from './polymarketClient';
import type {
  Eip712PolymarketOrder,
  ExecutionMode,
  ExecutionReceipt,
  NormalizedOrderbook,
  PolymarketOrderSideCode,
  RiskGateDecision,
  SignerMode,
} from './types';

// Public read-only / sandbox placeholder address (EIP-55 zero-key demo address, NO private key)
export const SANDBOX_DEMO_MAKER_ADDRESS =
  '0x000000000000000000000000000000000000dEaD';
export const POLYMARKET_CTF_EXCHANGE_POLYGON =
  '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

/**
 * Official Polymarket CTFExchange.sol Side enum (`uint8`):
 * 0 = BUY, 1 = SELL
 */
export const POLYMARKET_ORDER_SIDE = {
  BUY: 0 as PolymarketOrderSideCode,
  SELL: 1 as PolymarketOrderSideCode,
} as const;

export interface Eip712TypedDataPayload {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType: 'Order';
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    Order: Array<{ name: string; type: string }>;
  };
  message: Eip712PolymarketOrder;
}

export function buildPolymarketEip712OrderTypedData(params: {
  tokenId: string;
  stakeUsdc: number;
  limitPrice: number;
  makerAddress?: string;
  signerAddress?: string;
  side?: PolymarketOrderSideCode;
  chainId?: number;
  nowSec?: number;
}): Eip712TypedDataPayload {
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000);
  const maker = params.makerAddress ?? SANDBOX_DEMO_MAKER_ADDRESS;
  const signer = params.signerAddress ?? maker;
  const side: PolymarketOrderSideCode = params.side ?? POLYMARKET_ORDER_SIDE.BUY;
  const makerAmountUnits = Math.round(params.stakeUsdc * 1_000_000);
  const takerSharesUnits = Math.round(
    (params.stakeUsdc / Math.max(0.01, params.limitPrice)) * 1_000_000
  );

  const order: Eip712PolymarketOrder = {
    salt: String(nowSec * 1000 + 42),
    maker,
    signer,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: params.tokenId,
    makerAmount: String(makerAmountUnits),
    takerAmount: String(takerSharesUnits),
    expiration: String(nowSec + 90),
    nonce: '0',
    feeRateBps: '0',
    side,
    signatureType: 0,
  };

  return {
    domain: {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: params.chainId ?? 80002, // Polygon Amoy Testnet / Sandbox chainId by default
      verifyingContract: POLYMARKET_CTF_EXCHANGE_POLYGON,
    },
    primaryType: 'Order',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      // Matches CTFExchange.sol ORDER_TYPEHASH:
      // Order(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType)
      Order: [
        { name: 'salt', type: 'uint256' },
        { name: 'maker', type: 'address' },
        { name: 'signer', type: 'address' },
        { name: 'taker', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'makerAmount', type: 'uint256' },
        { name: 'takerAmount', type: 'uint256' },
        { name: 'expiration', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'feeRateBps', type: 'uint256' },
        { name: 'side', type: 'uint8' },
        { name: 'signatureType', type: 'uint8' },
      ],
    },
    message: order,
  };
}

/**
 * Deterministic 256-bit digest over canonical EIP-712 JSON payload.
 */
export function computeDeterministicDigestHex(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  const lanes = [
    0x811c9dc5,
    0x9e3779b9,
    0x85ebca6b,
    0xc2b2ae35,
    0x27d4eb2f,
    0x165667b1,
    0xd3a2646c,
    0xfd7046c5,
  ];
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    const lane = i & 7;
    lanes[lane] = Math.imul(lanes[lane] ^ code, 0x01000193) >>> 0;
    lanes[(lane + 3) & 7] =
      Math.imul(lanes[(lane + 3) & 7] ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return (
    '0x' + lanes.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
  );
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export async function executeRiskGatedSandboxOrder(params: {
  book: NormalizedOrderbook;
  decision: RiskGateDecision;
  fairProb: number;
  mode?: ExecutionMode;
  signerMode?: SignerMode;
  riskCapUsdc?: number;
}): Promise<ExecutionReceipt> {
  if (
    !params.decision.passed ||
    !params.decision.checks.riskCapLocked ||
    !Number.isFinite(params.decision.stakeUsdc) ||
    params.decision.stakeUsdc <= 0
  ) {
    throw new Error(
      `Order blocked by Risk Gate: ${params.decision.rejectionCode}`
    );
  }

  const mode: ExecutionMode = params.mode ?? 'FAK';
  const signerMode: SignerMode = params.signerMode ?? 'SANDBOX_SIM';
  const riskCapUsdc = params.riskCapUsdc ?? 10.0;
  const stakeUsdc = Math.min(params.decision.stakeUsdc, riskCapUsdc);

  // POST_ONLY rests 1 tick below bestAsk (maker); FAK sweeps up to limitPrice
  const targetLimit =
    mode === 'POST_ONLY'
      ? Number(Math.max(0.01, params.book.bestAsk - 0.01).toFixed(4))
      : params.decision.limitPrice;

  const nowSec = Math.floor(Date.now() / 1000);
  let resolvedMaker = SANDBOX_DEMO_MAKER_ADDRESS;
  let ethProvider: Eip1193Provider | undefined;

  if (signerMode === 'WEB3_EIP712' && typeof window !== 'undefined') {
    ethProvider = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (ethProvider) {
      try {
        const accounts = (await ethProvider.request({
          method: 'eth_requestAccounts',
        })) as string[];
        if (accounts?.[0]) {
          resolvedMaker = accounts[0];
        }
      } catch {
        // Fallback to zero-key sandbox maker when wallet prompt is declined
      }
    }
  }

  // Construct final typedData AFTER resolving maker/signer so eip712Digest matches signed payload 1:1
  const typedData = buildPolymarketEip712OrderTypedData({
    tokenId: params.book.tokenId,
    stakeUsdc,
    limitPrice: targetLimit,
    makerAddress: resolvedMaker,
    signerAddress: resolvedMaker,
    side: POLYMARKET_ORDER_SIDE.BUY,
    nowSec,
  });
  const eip712Digest = computeDeterministicDigestHex(typedData);

  let signaturePreview = `sim_sig_${eip712Digest.slice(2, 10)}...${eip712Digest.slice(-6)}`;

  if (
    signerMode === 'WEB3_EIP712' &&
    ethProvider &&
    resolvedMaker !== SANDBOX_DEMO_MAKER_ADDRESS
  ) {
    try {
      const sig = String(
        await ethProvider.request({
          method: 'eth_signTypedData_v4',
          params: [resolvedMaker, JSON.stringify(typedData)],
        })
      );
      signaturePreview = `${sig.slice(0, 10)}...${sig.slice(-6)}`;
    } catch {
      signaturePreview = `wallet_fallback_${eip712Digest.slice(2, 10)}`;
    }
  }

  const vwap =
    mode === 'FAK'
      ? simulateVwapBuy(params.book.asks, stakeUsdc, targetLimit)
      : {
          filledUsdc: stakeUsdc,
          filledShares: Number((stakeUsdc / targetLimit).toFixed(2)),
          vwapPrice: targetLimit,
          slippageFromBestAsk: 0,
        };

  const filledShares =
    vwap.filledShares > 0
      ? vwap.filledShares
      : Number((stakeUsdc / params.book.bestAsk).toFixed(2));
  const vwapPrice =
    vwap.vwapPrice > 0 ? vwap.vwapPrice : params.book.bestAsk;
  const filledUsdc = vwap.filledUsdc > 0 ? vwap.filledUsdc : stakeUsdc;
  const expectedValueUsdc = Number(
    (filledShares * params.fairProb - filledUsdc).toFixed(2)
  );

  return {
    receiptId: `LE-${Date.now().toString(36).toUpperCase()}`,
    mode,
    signerMode,
    marketSlug: params.book.marketSlug,
    outcomeLabel: params.book.outcomeLabel,
    tokenId: params.book.tokenId,
    stakeUsdc: filledUsdc,
    filledShares,
    vwapPrice,
    limitPrice: targetLimit,
    slippage: vwap.slippageFromBestAsk,
    riskCapUsdc,
    expectedValueUsdc,
    eip712Digest,
    signaturePreview,
    executedAtIso: new Date().toISOString(),
    simulatedOnly: true,
  };
}
