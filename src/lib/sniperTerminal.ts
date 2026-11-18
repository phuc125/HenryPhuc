import type { LiveTokenSnapshot } from './networkPolicy';
import type { StrategyConfig } from './quantEngine';

export type ChainNetworkId = 'SOL' | 'BASE' | 'ETH';
export type SnipeMode = 'INSTANT' | 'AUTO_LIQ' | 'LIMIT';
export type LogSeverity = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

export interface MempoolPairItem {
  mint: string;
  symbol: string;
  name: string;
  network: ChainNetworkId;
  dexLabel: 'Raydium V4' | 'Raydium CPMM' | 'Pump.fun' | 'Meteora DLMM' | 'Uniswap V3' | 'Aerodrome';
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  marketCapUsd: number;
  change5mPct: number;
  ageLabel: string;
  mintDisabled: boolean;
  lpBurned: boolean;
  lpBurnedPct: number;
  top10HoldersPct: number;
  honeypotPassed: boolean;
  m5Buys: number;
  m5Sells: number;
}

export interface ScannedContractInfo {
  mint: string;
  symbol: string;
  name: string;
  dexLabel: string;
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  marketCapUsd: number;
  mintDisabled: boolean;
  lpBurned: boolean;
  lpBurnedPct: number;
  top10HoldersPct: number;
  honeypotPassed: boolean;
  aiScore: number;
  riskTag: 'LOW_RISK' | 'MODERATE' | 'HIGH_RISK';
}

export interface SnipeOrderSettings {
  mode: SnipeMode;
  amountSol: number;
  slippagePct: number;
  priorityFeeSol: number;
  antiMev: boolean;
  takeProfitPct: number;
  stopLossPct: number;
  limitTriggerChangePct: number;
  smallCapHighPf: boolean;
}

export type OrderExecutionPhase = 'CONFIRMED' | 'SLIPPAGE_CHECK' | 'FEE_ADJUSTING';

export interface ActiveSnipePosition {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  network: ChainNetworkId;
  dexLabel: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  entryPriceSol: number;
  currentPriceSol: number;
  initialAmountSol: number;
  remainingShare: number;
  realizedSol: number;
  tpPct: number;
  slPct: number;
  antiMev: boolean;
  priorityFeeSol: number;
  slippagePct?: number;
  executionPhase?: OrderExecutionPhase;
  adjustmentReason?: string;
  phaseUpdatedAt?: number;
  priceHistory?: number[];
  openedAt: number;
}

export interface PendingSnipeOrder {
  id: string;
  mint: string;
  symbol: string;
  network: ChainNetworkId;
  mode: 'AUTO_LIQ' | 'LIMIT';
  amountSol: number;
  triggerChangePct: number;
  settings: SnipeOrderSettings;
  createdAt: number;
}

export interface TerminalLogEntry {
  id: string;
  timestamp: number;
  timeStr: string;
  severity: LogSeverity;
  message: string;
}

export interface SniperTerminalState {
  network: ChainNetworkId;
  activePositions: ActiveSnipePosition[];
  pendingOrders: PendingSnipeOrder[];
  logs: TerminalLogEntry[];
  realizedSessionSol: number;
}

export const SAMPLE_MEMPOOL_PAIRS: MempoolPairItem[] = [
  {
    mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: '$PEPE2',
    name: 'Pepe 2.0 Solana',
    network: 'SOL',
    dexLabel: 'Raydium V4',
    priceUsd: 0.00482,
    priceSol: 0.000031,
    liquidityUsd: 64_200,
    marketCapUsd: 482_000,
    change5mPct: 24.6,
    ageLabel: '18s',
    mintDisabled: true,
    lpBurned: true,
    lpBurnedPct: 100,
    top10HoldersPct: 12,
    honeypotPassed: true,
    m5Buys: 48,
    m5Sells: 12,
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: '$SOLCAT',
    name: 'Solana Quant Cat',
    network: 'SOL',
    dexLabel: 'Pump.fun',
    priceUsd: 0.00214,
    priceSol: 0.0000142,
    liquidityUsd: 38_500,
    marketCapUsd: 214_000,
    change5mPct: 18.2,
    ageLabel: '42s',
    mintDisabled: true,
    lpBurned: true,
    lpBurnedPct: 99,
    top10HoldersPct: 14,
    honeypotPassed: true,
    m5Buys: 36,
    m5Sells: 9,
  },
  {
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: '$BONKAI',
    name: 'Bonk Neural Agent',
    network: 'SOL',
    dexLabel: 'Meteora DLMM',
    priceUsd: 0.00795,
    priceSol: 0.0000525,
    liquidityUsd: 89_000,
    marketCapUsd: 795_000,
    change5mPct: 11.4,
    ageLabel: '2m',
    mintDisabled: true,
    lpBurned: true,
    lpBurnedPct: 98,
    top10HoldersPct: 15,
    honeypotPassed: true,
    m5Buys: 51,
    m5Sells: 18,
  },
  {
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: '$WIFQUANT',
    name: 'Wif Quant Alpha',
    network: 'SOL',
    dexLabel: 'Raydium CPMM',
    priceUsd: 0.00136,
    priceSol: 0.0000091,
    liquidityUsd: 29_400,
    marketCapUsd: 136_000,
    change5mPct: -3.8,
    ageLabel: '4m',
    mintDisabled: true,
    lpBurned: true,
    lpBurnedPct: 95,
    top10HoldersPct: 19,
    honeypotPassed: true,
    m5Buys: 22,
    m5Sells: 13,
  },
  {
    mint: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    symbol: '$RUGTRAP',
    name: 'Suspect Honey Pool',
    network: 'SOL',
    dexLabel: 'Pump.fun',
    priceUsd: 0.00044,
    priceSol: 0.0000029,
    liquidityUsd: 6_200,
    marketCapUsd: 44_000,
    change5mPct: -19.5,
    ageLabel: '6m',
    mintDisabled: false,
    lpBurned: false,
    lpBurnedPct: 40,
    top10HoldersPct: 46,
    honeypotPassed: false,
    m5Buys: 6,
    m5Sells: 19,
  },
];

export const DEFAULT_SNIPE_SETTINGS: SnipeOrderSettings = {
  mode: 'INSTANT',
  amountSol: 0.5,
  slippagePct: 8,
  priorityFeeSol: 0.00025,
  antiMev: true,
  takeProfitPct: 35,
  stopLossPct: 12,
  limitTriggerChangePct: -8,
  smallCapHighPf: true,
};

export function shortenAddress(addr: string, head = 4, tail = 4): string {
  const clean = addr.trim();
  if (!clean) return '7xKX...9pQz';
  if (clean.length <= head + tail + 3) return clean;
  return `${clean.slice(0, head)}...${clean.slice(-tail)}`;
}

export function formatTimeHMS(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function getNetworkTelemetry(network: ChainNetworkId): {
  label: string;
  latencyMs: number;
  nativeUnit: string;
} {
  if (network === 'BASE') {
    return { label: 'Base Mainnet', latencyMs: 18, nativeUnit: 'ETH' };
  }
  if (network === 'ETH') {
    return { label: 'Ethereum Mainnet', latencyMs: 24, nativeUnit: 'ETH' };
  }
  return { label: 'Solana Mainnet', latencyMs: 14, nativeUnit: 'SOL' };
}

export function mergeLiveAndSamplePairs(
  liveTokens: LiveTokenSnapshot[],
  network: ChainNetworkId,
): MempoolPairItem[] {
  if (network !== 'SOL') {
    return SAMPLE_MEMPOOL_PAIRS.slice(0, 4).map((p, idx) => ({
      ...p,
      network,
      dexLabel: network === 'BASE' ? 'Aerodrome' : 'Uniswap V3',
      symbol: idx === 0 ? '$BRETTAI' : idx === 1 ? '$DEGENX' : idx === 2 ? '$PEPEBASE' : '$QUANTETH',
    }));
  }

  const byMint = new Map<string, MempoolPairItem>();
  for (const item of SAMPLE_MEMPOOL_PAIRS) {
    byMint.set(item.mint, item);
  }

  for (const snap of liveTokens) {
    const cleanSym = snap.symbol.startsWith('$') ? snap.symbol : `$${snap.symbol}`;
    const existing = byMint.get(snap.mint);
    const isSuspicious = snap.liquidityUsd < 8_000 || (snap.m5Buys >= 50 && snap.m5VolumeUsd < 500);
    byMint.set(snap.mint, {
      mint: snap.mint,
      symbol: existing?.symbol ?? cleanSym,
      name: snap.name,
      network: 'SOL',
      dexLabel:
        snap.dex === 'PUMP_FUN'
          ? 'Pump.fun'
          : snap.dex === 'METEORA_DLMM'
            ? 'Meteora DLMM'
            : snap.dex === 'RAYDIUM_CPMM'
              ? 'Raydium CPMM'
              : 'Raydium V4',
      priceUsd: snap.priceUsd,
      priceSol: snap.priceSol,
      liquidityUsd: snap.liquidityUsd,
      marketCapUsd: snap.fdvUsd || snap.liquidityUsd * 5,
      change5mPct: snap.priceChangeM5Pct,
      ageLabel: `${Math.max(1, snap.ageMinutes)}m`,
      mintDisabled: existing?.mintDisabled ?? !isSuspicious,
      lpBurned: existing?.lpBurned ?? snap.liquidityUsd >= 10_000,
      lpBurnedPct: existing?.lpBurnedPct ?? (snap.liquidityUsd >= 10_000 ? 99 : 65),
      top10HoldersPct: existing?.top10HoldersPct ?? (isSuspicious ? 38 : 13),
      honeypotPassed: existing?.honeypotPassed ?? !isSuspicious,
      m5Buys: snap.m5Buys,
      m5Sells: snap.m5Sells,
    });
  }

  return Array.from(byMint.values()).slice(0, 8);
}

export function scanContractInfo(
  contractAddress: string,
  pairs: MempoolPairItem[],
): ScannedContractInfo | null {
  const ca = contractAddress.trim();
  if (ca.length < 16) return null;

  const matched = pairs.find((p) => p.mint.toLowerCase() === ca.toLowerCase());
  if (matched) {
    const score =
      (matched.mintDisabled ? 35 : 0) +
      (matched.lpBurned ? 30 : 10) +
      (matched.honeypotPassed ? 25 : 0) +
      (matched.top10HoldersPct <= 18 ? 10 : 0);
    return {
      mint: matched.mint,
      symbol: matched.symbol,
      name: matched.name,
      dexLabel: matched.dexLabel,
      priceUsd: matched.priceUsd,
      priceSol: matched.priceSol,
      liquidityUsd: matched.liquidityUsd,
      marketCapUsd: matched.marketCapUsd,
      mintDisabled: matched.mintDisabled,
      lpBurned: matched.lpBurned,
      lpBurnedPct: matched.lpBurnedPct,
      top10HoldersPct: matched.top10HoldersPct,
      honeypotPassed: matched.honeypotPassed,
      aiScore: Math.min(99, score),
      riskTag: score >= 80 ? 'LOW_RISK' : score >= 55 ? 'MODERATE' : 'HIGH_RISK',
    };
  }

  // Deterministic hash-based inspection for any pasted Solana/EVM contract
  let hash = 0;
  for (let i = 0; i < ca.length; i++) {
    hash = (hash * 31 + ca.charCodeAt(i)) >>> 0;
  }
  const suffix = ca.slice(0, 4).toUpperCase();
  const liqUsd = 18_000 + (hash % 75_000);
  const priceUsd = Number((0.0012 + ((hash % 900) / 100_000)).toFixed(5));
  const mintDisabled = hash % 7 !== 0;
  const lpBurned = hash % 6 !== 0;
  const top10 = 10 + (hash % 18);
  const aiScore = Math.min(96, (mintDisabled ? 35 : 5) + (lpBurned ? 30 : 10) + (top10 <= 20 ? 25 : 10));

  return {
    mint: ca,
    symbol: `$${suffix}`,
    name: `Token ${shortenAddress(ca, 4, 3)}`,
    dexLabel: 'Raydium V4',
    priceUsd,
    priceSol: Number((priceUsd / 152).toFixed(7)),
    liquidityUsd: liqUsd,
    marketCapUsd: liqUsd * 8,
    mintDisabled,
    lpBurned,
    lpBurnedPct: lpBurned ? 98 : 62,
    top10HoldersPct: top10,
    honeypotPassed: mintDisabled && lpBurned,
    aiScore,
    riskTag: aiScore >= 80 ? 'LOW_RISK' : aiScore >= 55 ? 'MODERATE' : 'HIGH_RISK',
  };
}

export const MAX_SPARKLINE_TICKS = 10;

export function seedPositionPriceHistory(
  entryPriceUsd: number,
  currentPriceUsd: number,
  count = MAX_SPARKLINE_TICKS,
): number[] {
  const safeEntry = entryPriceUsd > 0 ? entryPriceUsd : 0.001;
  const safeCurrent = currentPriceUsd > 0 ? currentPriceUsd : safeEntry;
  const total = Math.max(2, count);
  const waveOffsets = [-0.014, 0.018, -0.009, 0.024, -0.012, 0.016, -0.008, 0.011, -0.005, 0];
  const points: number[] = [];

  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const linear = safeEntry + (safeCurrent - safeEntry) * t;
    // Anchor first point near entry and exact last point at currentPriceUsd
    const wave = i === 0 || i === total - 1 ? 0 : waveOffsets[i % waveOffsets.length] * (1 - t * 0.35);
    const value = Number(Math.max(1e-8, linear * (1 + wave)).toFixed(6));
    points.push(value);
  }
  points[total - 1] = Number(safeCurrent.toFixed(6));
  return points;
}

export function appendPriceTick(
  history: number[] | undefined,
  nextPriceUsd: number,
  fallbackEntryPriceUsd: number,
): number[] {
  const base =
    Array.isArray(history) && history.length > 0
      ? history
      : seedPositionPriceHistory(fallbackEntryPriceUsd, nextPriceUsd, MAX_SPARKLINE_TICKS - 1);
  const safeNext = Number((nextPriceUsd > 0 ? nextPriceUsd : fallbackEntryPriceUsd).toFixed(6));
  return [...base, safeNext].slice(-MAX_SPARKLINE_TICKS);
}

export interface SparklinePoint {
  tick: number;
  label: string;
  price: number;
  deltaPct: number;
}

export function buildSparklineSeries(pos: ActiveSnipePosition): SparklinePoint[] {
  const raw =
    Array.isArray(pos.priceHistory) && pos.priceHistory.length >= 2
      ? pos.priceHistory.slice(-MAX_SPARKLINE_TICKS)
      : seedPositionPriceHistory(pos.entryPriceUsd, pos.currentPriceUsd, MAX_SPARKLINE_TICKS);
  const entry = pos.entryPriceUsd > 0 ? pos.entryPriceUsd : raw[0] || 1;
  const total = raw.length;
  return raw.map((price, idx) => {
    const stepsAgo = total - 1 - idx;
    return {
      tick: idx + 1,
      label: stepsAgo === 0 ? 'Now' : `T-${stepsAgo}`,
      price,
      deltaPct: Number((((price - entry) / entry) * 100).toFixed(2)),
    };
  });
}

export function isPositionAdjusting(pos: ActiveSnipePosition): boolean {
  return pos.executionPhase === 'SLIPPAGE_CHECK' || pos.executionPhase === 'FEE_ADJUSTING';
}

export function stepPositionExecutionPhase(
  pos: ActiveSnipePosition,
  nextPriceSol: number,
  now = Date.now(),
): {
  executionPhase: OrderExecutionPhase;
  adjustmentReason?: string;
  phaseUpdatedAt: number;
  transitionedToConfirmed: boolean;
} {
  const phase = pos.executionPhase ?? 'CONFIRMED';
  const lastChange = pos.phaseUpdatedAt ?? pos.openedAt;
  const elapsedMs = Math.max(0, now - lastChange);

  if (phase === 'SLIPPAGE_CHECK') {
    if (elapsedMs >= 5_000) {
      return {
        executionPhase: 'FEE_ADJUSTING',
        adjustmentReason: `Jito tip ${pos.priorityFeeSol.toFixed(5)} SOL`,
        phaseUpdatedAt: now,
        transitionedToConfirmed: false,
      };
    }
    return {
      executionPhase: 'SLIPPAGE_CHECK',
      adjustmentReason: pos.adjustmentReason ?? `±${pos.slippagePct ?? 8}% tolerance`,
      phaseUpdatedAt: lastChange,
      transitionedToConfirmed: false,
    };
  }

  if (phase === 'FEE_ADJUSTING') {
    if (elapsedMs >= 12_000) {
      return {
        executionPhase: 'CONFIRMED',
        adjustmentReason: undefined,
        phaseUpdatedAt: now,
        transitionedToConfirmed: true,
      };
    }
    return {
      executionPhase: 'FEE_ADJUSTING',
      adjustmentReason: pos.adjustmentReason ?? `Jito tip ${pos.priorityFeeSol.toFixed(5)} SOL`,
      phaseUpdatedAt: lastChange,
      transitionedToConfirmed: false,
    };
  }

  // Detect sudden >= 3% tick jump on settled positions to surface brief slippage guard check
  const prevPrice = pos.currentPriceSol > 0 ? pos.currentPriceSol : pos.entryPriceSol;
  const movePct = prevPrice > 0 ? Math.abs((nextPriceSol - prevPrice) / prevPrice) * 100 : 0;
  if (movePct >= 3) {
    return {
      executionPhase: 'SLIPPAGE_CHECK',
      adjustmentReason: `±${movePct.toFixed(1)}% tick`,
      phaseUpdatedAt: now,
      transitionedToConfirmed: false,
    };
  }

  return {
    executionPhase: 'CONFIRMED',
    adjustmentReason: undefined,
    phaseUpdatedAt: lastChange,
    transitionedToConfirmed: false,
  };
}

export function computePositionMetrics(pos: ActiveSnipePosition): {
  pnlPct: number;
  pnlSol: number;
  remainingSolBasis: number;
  currentValueSol: number;
  tpSlProgressPct: number;
} {
  const ratio = pos.entryPriceSol > 0 ? pos.currentPriceSol / pos.entryPriceSol : 1;
  const pnlPct = Number(((ratio - 1) * 100).toFixed(2));
  const remainingSolBasis = Number((pos.initialAmountSol * pos.remainingShare).toFixed(4));
  const currentValueSol = Number((remainingSolBasis * ratio).toFixed(4));
  const netPnlSol = Number((pos.realizedSol + currentValueSol - pos.initialAmountSol).toFixed(4));

  const minBound = -Math.max(1, Math.abs(pos.slPct));
  const maxBound = Math.max(5, Math.abs(pos.tpPct));
  const normalized = ((pnlPct - minBound) / (maxBound - minBound)) * 100;
  const tpSlProgressPct = Math.max(0, Math.min(100, Number(normalized.toFixed(1))));

  return {
    pnlPct,
    pnlSol: netPnlSol,
    remainingSolBasis,
    currentValueSol,
    tpSlProgressPct,
  };
}

export function createInitialSniperTerminalState(now = Date.now()): SniperTerminalState {
  return {
    network: 'SOL',
    realizedSessionSol: 0.412,
    activePositions: [
      {
        id: 'pos-pepe2',
        mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        symbol: '$PEPE2',
        name: 'Pepe 2.0 Solana',
        network: 'SOL',
        dexLabel: 'Raydium V4',
        entryPriceUsd: 0.00358,
        currentPriceUsd: 0.00482,
        entryPriceSol: 0.000023,
        currentPriceSol: 0.000031,
        initialAmountSol: 0.5,
        remainingShare: 1,
        realizedSol: 0,
        tpPct: 45,
        slPct: 12,
        antiMev: true,
        priorityFeeSol: 0.00025,
        slippagePct: 8,
        executionPhase: 'CONFIRMED',
        phaseUpdatedAt: now - 140_000,
        priceHistory: seedPositionPriceHistory(0.00358, 0.00482, MAX_SPARKLINE_TICKS),
        openedAt: now - 140_000,
      },
      {
        id: 'pos-bonkai',
        mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        symbol: '$BONKAI',
        name: 'Bonk Neural Agent',
        network: 'SOL',
        dexLabel: 'Meteora DLMM',
        entryPriceUsd: 0.00848,
        currentPriceUsd: 0.00795,
        entryPriceSol: 0.000056,
        currentPriceSol: 0.0000525,
        initialAmountSol: 0.25,
        remainingShare: 1,
        realizedSol: 0,
        tpPct: 35,
        slPct: 12,
        antiMev: true,
        priorityFeeSol: 0.00025,
        slippagePct: 8,
        executionPhase: 'FEE_ADJUSTING',
        adjustmentReason: '+0.00015 SOL tip bump',
        phaseUpdatedAt: now,
        priceHistory: seedPositionPriceHistory(0.00848, 0.00795, MAX_SPARKLINE_TICKS),
        openedAt: now - 55_000,
      },
    ],
    pendingOrders: [
      {
        id: 'pend-wif',
        mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        symbol: '$WIFQUANT',
        network: 'SOL',
        mode: 'LIMIT',
        amountSol: 0.25,
        triggerChangePct: -8,
        settings: DEFAULT_SNIPE_SETTINGS,
        createdAt: now - 30_000,
      },
    ],
    logs: [
      {
        id: 'log-init-1',
        timestamp: now - 140_000,
        timeStr: formatTimeHMS(now - 140_000),
        severity: 'SUCCESS',
        message: 'Detected LP for $PEPE2 - Sending Jito bundle (Anti-MEV)... Confirmed in 0.4s',
      },
      {
        id: 'log-init-2',
        timestamp: now - 55_000,
        timeStr: formatTimeHMS(now - 55_000),
        severity: 'INFO',
        message: 'Entered $BONKAI 0.25 SOL (Small-Cap High-PF: SL -12% / TP1 +30%, Fee 0.00025 SOL)',
      },
      {
        id: 'log-init-3',
        timestamp: now - 30_000,
        timeStr: formatTimeHMS(now - 30_000),
        severity: 'WARN',
        message: 'Armed Limit Order $WIFQUANT (0.25 SOL) waiting dip -8.0% with Mint Disabled check',
      },
    ],
  };
}

function appendLog(
  logs: TerminalLogEntry[],
  severity: LogSeverity,
  message: string,
  now = Date.now(),
): TerminalLogEntry[] {
  const entry: TerminalLogEntry = {
    id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now,
    timeStr: formatTimeHMS(now),
    severity,
    message,
  };
  return [entry, ...logs].slice(0, 60);
}

export function executeSnipeOrder(
  state: SniperTerminalState,
  target: ScannedContractInfo,
  settings: SnipeOrderSettings,
  now = Date.now(),
): { nextState: SniperTerminalState; solSpent: number } {
  const safeAmount = Math.max(0.02, Number(settings.amountSol) || 0.1);

  if (settings.mode === 'AUTO_LIQ' || settings.mode === 'LIMIT') {
    const pending: PendingSnipeOrder = {
      id: `pend-${now}-${Math.random().toString(36).slice(2, 6)}`,
      mint: target.mint,
      symbol: target.symbol,
      network: state.network,
      mode: settings.mode,
      amountSol: safeAmount,
      triggerChangePct: settings.limitTriggerChangePct,
      settings,
      createdAt: now,
    };
    const msg =
      settings.mode === 'AUTO_LIQ'
        ? `Auto-Snipe queued for ${target.symbol} (${shortenAddress(target.mint)}) · ${safeAmount} SOL on LP injection`
        : `Limit Order set for ${target.symbol} (${safeAmount} SOL @ ${settings.limitTriggerChangePct}% dip)`;

    return {
      solSpent: 0,
      nextState: {
        ...state,
        pendingOrders: [pending, ...state.pendingOrders],
        logs: appendLog(state.logs, 'WARN', msg, now),
      },
    };
  }

  const initialPhase: OrderExecutionPhase =
    settings.slippagePct >= 8 || settings.priorityFeeSol >= 0.0003
      ? 'SLIPPAGE_CHECK'
      : 'FEE_ADJUSTING';
  const initialReason =
    initialPhase === 'SLIPPAGE_CHECK'
      ? `±${settings.slippagePct}% tolerance`
      : `Jito tip ${settings.priorityFeeSol.toFixed(5)} SOL`;

  const newPos: ActiveSnipePosition = {
    id: `pos-${now}-${Math.random().toString(36).slice(2, 6)}`,
    mint: target.mint,
    symbol: target.symbol,
    name: target.name,
    network: state.network,
    dexLabel: target.dexLabel,
    entryPriceUsd: target.priceUsd,
    currentPriceUsd: target.priceUsd,
    entryPriceSol: target.priceSol,
    currentPriceSol: target.priceSol,
    initialAmountSol: safeAmount,
    remainingShare: 1,
    realizedSol: 0,
    tpPct: settings.takeProfitPct,
    slPct: settings.stopLossPct,
    antiMev: settings.antiMev,
    priorityFeeSol: settings.priorityFeeSol,
    slippagePct: settings.slippagePct,
    executionPhase: initialPhase,
    adjustmentReason: initialReason,
    phaseUpdatedAt: now,
    priceHistory: seedPositionPriceHistory(target.priceUsd, target.priceUsd, MAX_SPARKLINE_TICKS),
    openedAt: now,
  };

  const bundleText = settings.antiMev ? 'Jito Anti-MEV bundle' : 'Direct RPC Swap';
  const msg = `Detected LP for ${target.symbol} (${shortenAddress(target.mint)}) - Sending ${bundleText} (${safeAmount} SOL) · ${initialReason}...`;

  return {
    solSpent: Number((safeAmount + settings.priorityFeeSol).toFixed(5)),
    nextState: {
      ...state,
      activePositions: [newPos, ...state.activePositions],
      logs: appendLog(state.logs, 'SUCCESS', msg, now),
    },
  };
}

export function sellPositionFraction(
  state: SniperTerminalState,
  positionId: string,
  fraction: number,
  now = Date.now(),
): { nextState: SniperTerminalState; solProceeds: number; netPnlDeltaSol: number } {
  const pos = state.activePositions.find((p) => p.id === positionId);
  if (!pos) {
    return { nextState: state, solProceeds: 0, netPnlDeltaSol: 0 };
  }

  const clampedFrac = Math.max(0.05, Math.min(1, fraction));
  const soldShare = pos.remainingShare * clampedFrac;
  const priceMult = pos.entryPriceSol > 0 ? pos.currentPriceSol / pos.entryPriceSol : 1;
  const grossProceeds = pos.initialAmountSol * soldShare * priceMult;
  const fee = Math.min(0.001, pos.priorityFeeSol);
  const solProceeds = Number(Math.max(0, grossProceeds - fee).toFixed(4));
  const basisSold = pos.initialAmountSol * soldShare;
  const netPnlDeltaSol = Number((solProceeds - basisSold).toFixed(4));

  const nextRemaining = Number((pos.remainingShare - soldShare).toFixed(4));
  const isClosed = clampedFrac >= 0.99 || nextRemaining <= 0.01;

  const updatedPositions = isClosed
    ? state.activePositions.filter((p) => p.id !== positionId)
    : state.activePositions.map((p) =>
        p.id === positionId
          ? {
              ...p,
              remainingShare: nextRemaining,
              realizedSol: Number((p.realizedSol + solProceeds).toFixed(4)),
            }
          : p,
      );

  const actionLabel = isClosed ? 'Sell 100%' : `Sell ${Math.round(clampedFrac * 100)}%`;
  const rentNote = isClosed ? ' (+0.00204 SOL rent reclaimed)' : '';
  const msg = `${actionLabel} ${pos.symbol} (${shortenAddress(pos.mint)}) -> +${solProceeds} SOL (PnL ${
    netPnlDeltaSol >= 0 ? '+' : ''
  }${netPnlDeltaSol} SOL)${rentNote}`;

  return {
    solProceeds,
    netPnlDeltaSol,
    nextState: {
      ...state,
      activePositions: updatedPositions,
      realizedSessionSol: Number((state.realizedSessionSol + netPnlDeltaSol).toFixed(4)),
      logs: appendLog(state.logs, netPnlDeltaSol >= 0 ? 'SUCCESS' : 'WARN', msg, now),
    },
  };
}

export function panicSellAllPositions(
  state: SniperTerminalState,
  now = Date.now(),
): { nextState: SniperTerminalState; totalRecoveredSol: number; totalNetPnlSol: number; closedCount: number } {
  const closedCount = state.activePositions.length;
  const cancelledPending = state.pendingOrders.length;

  let totalRecoveredSol = 0;
  let totalNetPnlSol = 0;

  for (const pos of state.activePositions) {
    const mult = pos.entryPriceSol > 0 ? pos.currentPriceSol / pos.entryPriceSol : 1;
    const proceeds = Math.max(0, pos.initialAmountSol * pos.remainingShare * mult - 0.0003);
    const basis = pos.initialAmountSol * pos.remainingShare;
    totalRecoveredSol += proceeds;
    totalNetPnlSol += proceeds - basis;
  }

  totalRecoveredSol = Number(totalRecoveredSol.toFixed(4));
  totalNetPnlSol = Number(totalNetPnlSol.toFixed(4));

  const msg =
    closedCount > 0 || cancelledPending > 0
      ? `PANIC SELL ALL executed: closed ${closedCount} positions (+${totalRecoveredSol} SOL recovered, cancelled ${cancelledPending} pending orders)`
      : 'PANIC SELL ALL triggered: 0 open positions to close.';

  return {
    totalRecoveredSol,
    totalNetPnlSol,
    closedCount,
    nextState: {
      ...state,
      activePositions: [],
      pendingOrders: [],
      realizedSessionSol: Number((state.realizedSessionSol + totalNetPnlSol).toFixed(4)),
      logs: appendLog(state.logs, closedCount > 0 ? 'ERROR' : 'WARN', msg, now),
    },
  };
}

export function tickSniperPositions(
  state: SniperTerminalState,
  pairs: MempoolPairItem[],
  cfg?: StrategyConfig,
  now = Date.now(),
): SniperTerminalState {
  if (state.activePositions.length === 0) return state;

  const byMint = new Map<string, MempoolPairItem>();
  for (const p of pairs) byMint.set(p.mint, p);

  const nextPositions: ActiveSnipePosition[] = [];
  let logs = state.logs;
  let realizedSessionSol = state.realizedSessionSol;

  for (let i = 0; i < state.activePositions.length; i++) {
    const pos = state.activePositions[i];
    const matched = byMint.get(pos.mint);
    const phase = (now / 4500 + i * 1.3) % (Math.PI * 2);
    const gentleMove = 1 + Math.sin(phase) * 0.025;
    const nextPriceSol = matched && matched.priceSol > 0 ? matched.priceSol : Number((pos.currentPriceSol * gentleMove).toFixed(8));
    const nextPriceUsd = matched && matched.priceUsd > 0 ? matched.priceUsd : Number((pos.currentPriceUsd * gentleMove).toFixed(6));

    const nextPhase = stepPositionExecutionPhase(pos, nextPriceSol, now);
    const updatedPos: ActiveSnipePosition = {
      ...pos,
      currentPriceSol: nextPriceSol,
      currentPriceUsd: nextPriceUsd,
      executionPhase: nextPhase.executionPhase,
      adjustmentReason: nextPhase.adjustmentReason,
      phaseUpdatedAt: nextPhase.phaseUpdatedAt,
      priceHistory: appendPriceTick(pos.priceHistory, nextPriceUsd, pos.entryPriceUsd),
    };
    if (nextPhase.transitionedToConfirmed) {
      logs = appendLog(
        logs,
        'SUCCESS',
        `Execution settled on ${pos.symbol} after slippage & priority-fee calibration`,
        now,
      );
    }
    const metrics = computePositionMetrics(updatedPos);

    if (cfg?.autoSnipeEnabled && metrics.pnlPct >= pos.tpPct) {
      realizedSessionSol = Number((realizedSessionSol + metrics.pnlSol).toFixed(4));
      logs = appendLog(
        logs,
        'SUCCESS',
        `Auto TP hit on ${pos.symbol} at +${metrics.pnlPct}% -> Closed +${metrics.currentValueSol} SOL`,
        now,
      );
      continue;
    }
    if (cfg?.autoSnipeEnabled && metrics.pnlPct <= -Math.abs(pos.slPct)) {
      realizedSessionSol = Number((realizedSessionSol + metrics.pnlSol).toFixed(4));
      logs = appendLog(
        logs,
        'WARN',
        `Auto SL triggered on ${pos.symbol} at ${metrics.pnlPct}% -> Protected remaining ${metrics.currentValueSol} SOL`,
        now,
      );
      continue;
    }

    nextPositions.push(updatedPos);
  }

  return {
    ...state,
    activePositions: nextPositions,
    realizedSessionSol,
    logs,
  };
}
