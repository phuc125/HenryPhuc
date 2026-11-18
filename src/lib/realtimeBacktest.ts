import type { LiveTokenSnapshot } from './networkPolicy';
import {
  computeDynamicPositionSize,
  computeEffectiveFees,
  detectMarketRegime,
  evaluateAdaptiveEntry,
  evaluateAiTokenCandidate,
  evaluateTokenCandidate,
  MarketRegimeType,
  StrategyConfig,
  TokenCandidateInput,
} from './quantEngine';

export interface RealtimeSimulatedPosition {
  id: string;
  mint: string;
  symbol: string;
  dex: string;
  strategy: string;
  entryPriceSol: number;
  currentPriceSol: number;
  highestPriceSol: number;
  positionSizeSol: number;
  remainingShare: number;
  realizedSol: number;
  entryFeeSol: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  breakevenArmed: boolean;
  trailingActive: boolean;
  openedAt: number;
  ticksObserved: number;
  entryAlertId: number;
}

export interface RealtimeClosedTrade {
  id: string;
  mint: string;
  symbol: string;
  dex: string;
  strategy: string;
  closeReason: string;
  entryPriceSol: number;
  exitPriceSol: number;
  positionSizeSol: number;
  netPnlSol: number;
  netPnlPct: number;
  closedAt: number;
}

export interface RealtimeOrderAlert {
  id: number;
  mint: string;
  symbol: string;
  text: string;
  createdAt: number;
}

export interface EquityPoint {
  tick: number;
  label: string;
  equitySol: number;
}

export interface RealtimeBacktestState {
  running: boolean;
  tickCount: number;
  initialBalanceSol: number;
  cashBalanceSol: number;
  peakEquitySol: number;
  maxDrawdownSol: number;
  maxDrawdownPct: number;
  totalNetPnlSol: number;
  wins: number;
  losses: number;
  evaluatedCount: number;
  rejectedCount: number;
  lastFeedSource: string;
  lastUpdatedAt: number | null;
  openPositions: RealtimeSimulatedPosition[];
  closedTrades: RealtimeClosedTrade[];
  entryOrderAlerts: RealtimeOrderAlert[];
  equityCurve: EquityPoint[];
  nextAlertId: number;
  mintCooldownUntilTick: Record<string, number>;
}

export function createInitialRealtimeBacktestState(
  initialBalanceSol = 10,
): RealtimeBacktestState {
  const safeBal = Number.isFinite(initialBalanceSol) && initialBalanceSol > 0 ? initialBalanceSol : 10;
  return {
    running: false,
    tickCount: 0,
    initialBalanceSol: safeBal,
    cashBalanceSol: safeBal,
    peakEquitySol: safeBal,
    maxDrawdownSol: 0,
    maxDrawdownPct: 0,
    totalNetPnlSol: 0,
    wins: 0,
    losses: 0,
    evaluatedCount: 0,
    rejectedCount: 0,
    lastFeedSource: 'IDLE',
    lastUpdatedAt: null,
    openPositions: [],
    closedTrades: [],
    entryOrderAlerts: [],
    equityCurve: [{ tick: 0, label: 'START', equitySol: safeBal }],
    nextAlertId: 1,
    mintCooldownUntilTick: {},
  };
}

export function liveSnapshotToCandidate(snap: LiveTokenSnapshot): TokenCandidateInput {
  const isSpam = snap.m5Buys >= 50 && snap.m5VolumeUsd / Math.max(1, snap.m5Buys) < 6;
  return {
    mint: snap.mint,
    symbol: snap.symbol,
    name: snap.name,
    dex: snap.dex,
    eventKind: snap.dex === 'PUMP_FUN' ? 'MIGRATION' : 'NEW_POOL',
    hasVerifiedPrice: snap.priceSol > 0,
    liquidityUsd: snap.liquidityUsd,
    roundTripSpreadPct: snap.liquidityUsd >= 30_000 ? 2.4 : snap.liquidityUsd >= 12_000 ? 4.8 : 8.5,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    lpBurnedPct: snap.liquidityUsd >= 10_000 ? 98 : 88,
    top10HoldersPct: isSpam ? 44 : 18.5,
    devHoldPct: isSpam ? 9.5 : 2.2,
    bundleSupplyPct: isSpam ? 36 : 11,
    rugcheckRisk: snap.liquidityUsd >= 8000 && !isSpam ? 'Good' : 'Warn',
    honeypotPassed: !isSpam,
    buyCount: snap.m5Buys,
    sellCount: snap.m5Sells,
    uniqueBuyers: Math.max(1, Math.round(snap.m5Buys * (isSpam ? 0.14 : 0.65))),
    devSold: false,
    m5VolumeUsd: snap.m5VolumeUsd,
    h1VolumeUsd: snap.h1VolumeUsd,
    largestBuyerSharePct: isSpam ? 68 : 14,
    ageMinutes: snap.ageMinutes,
    priceChangeM5Pct: snap.priceChangeM5Pct,
    fdvUsd: snap.fdvUsd,
  };
}

/**
 * Advances the real-time backtest simulation by 1 live feed tick:
 * 1) Updates prices & evaluates TP1/TP2/Trailing/BE/Hard SL/Time Exit on open positions.
 * 2) Auto-deletes entry alert messages when TP/SL executes and autoDeleteEntryMsgEnabled is ON.
 * 3) Evaluates incoming live tokens with the active StrategyConfig + Regime and enters qualifying trades.
 */
export function stepRealtimeBacktest(
  prev: RealtimeBacktestState,
  snapshots: LiveTokenSnapshot[],
  cfg: StrategyConfig,
  options?: {
    regimeOverride?: MarketRegimeType;
    feedSource?: string;
    maxOpenPositions?: number;
  },
): RealtimeBacktestState {
  const maxOpen = options?.maxOpenPositions ?? 4;
  const now = Date.now();
  const nextTick = prev.tickCount + 1;
  const priceByMint = new Map<string, LiveTokenSnapshot>();
  for (const s of snapshots) {
    priceByMint.set(s.mint, s);
  }

  let cashBalanceSol = prev.cashBalanceSol;
  let wins = prev.wins;
  let losses = prev.losses;
  let totalNetPnlSol = prev.totalNetPnlSol;
  let evaluatedCount = prev.evaluatedCount;
  let rejectedCount = prev.rejectedCount;
  let nextAlertId = prev.nextAlertId;
  let entryOrderAlerts = [...prev.entryOrderAlerts];
  const closedTrades = [...prev.closedTrades];
  const nextOpenPositions: RealtimeSimulatedPosition[] = [];
  const mintCooldownUntilTick = { ...prev.mintCooldownUntilTick };

  // 1. Mark-to-market & exit evaluation on existing simulated positions
  for (const pos of prev.openPositions) {
    const snap = priceByMint.get(pos.mint);
    const livePrice = snap && snap.priceSol > 0 ? snap.priceSol : pos.currentPriceSol;
    const ticksObserved = pos.ticksObserved + 1;
    const highestPriceSol = Math.max(pos.highestPriceSol, livePrice);
    const mult = livePrice / Math.max(1e-12, pos.entryPriceSol);
    const highestMult = highestPriceSol / Math.max(1e-12, pos.entryPriceSol);
    const pnlPct = (mult - 1) * 100;

    let remainingShare = pos.remainingShare;
    let realizedSol = pos.realizedSol;
    let tp1Hit = pos.tp1Hit;
    let tp2Hit = pos.tp2Hit;
    const breakevenArmed = pos.breakevenArmed || (cfg.breakevenLockEnabled && pnlPct >= cfg.breakevenActivatePct);
    const trailingActive = pos.trailingActive || (cfg.trailingStopEnabled && pnlPct >= cfg.trailingActivatePct);
    let closeReason: string | null = null;
    let tpOrSlTriggered = false;

    const feePerExit = Math.min(0.0012, pos.entryFeeSol);

    if (pnlPct <= -Math.abs(cfg.hardSlPct)) {
      const proceeds = Math.max(0, pos.positionSizeSol * remainingShare * mult - feePerExit);
      realizedSol += proceeds;
      remainingShare = 0;
      closeReason = 'HARD_SL';
      tpOrSlTriggered = true;
    } else {
      if (!tp1Hit && pnlPct >= cfg.tp1Pct) {
        const sellFrac = Math.min(remainingShare, cfg.tp1SellSharePct / 100);
        const proceeds = Math.max(0, pos.positionSizeSol * sellFrac * mult - feePerExit);
        realizedSol += proceeds;
        remainingShare = Math.max(0, Number((remainingShare - sellFrac).toFixed(4)));
        tp1Hit = true;
        tpOrSlTriggered = true;
      }

      if (tp1Hit && !tp2Hit && remainingShare > 0 && pnlPct >= cfg.tp2Pct) {
        const sellFrac = Math.min(remainingShare, cfg.tp2SellSharePct / 100);
        const proceeds = Math.max(0, pos.positionSizeSol * sellFrac * mult - feePerExit);
        realizedSol += proceeds;
        remainingShare = Math.max(0, Number((remainingShare - sellFrac).toFixed(4)));
        tp2Hit = true;
        tpOrSlTriggered = true;
      }

      if (remainingShare <= 0.001) {
        closeReason = 'TP2_FULL';
      } else if (
        trailingActive &&
        mult <= highestMult * (1 - cfg.trailingCallbackPct / 100)
      ) {
        const proceeds = Math.max(0, pos.positionSizeSol * remainingShare * mult - feePerExit);
        realizedSol += proceeds;
        remainingShare = 0;
        closeReason = 'TRAILING_SL';
        tpOrSlTriggered = true;
      } else if (cfg.breakevenLockEnabled && breakevenArmed && !tp1Hit && pnlPct <= 3) {
        const proceeds = Math.max(0, pos.positionSizeSol * remainingShare * mult - feePerExit);
        realizedSol += proceeds;
        remainingShare = 0;
        closeReason = 'BREAKEVEN_SL';
        tpOrSlTriggered = true;
      } else if (cfg.timeExitEnabled && ticksObserved >= Math.max(6, cfg.timeExitMinutes) && pnlPct < 6 && !tp1Hit) {
        const proceeds = Math.max(0, pos.positionSizeSol * remainingShare * mult - feePerExit);
        realizedSol += proceeds;
        remainingShare = 0;
        closeReason = 'TIME_EXIT';
        tpOrSlTriggered = true;
      }
    }

    if (tpOrSlTriggered && cfg.autoDeleteEntryMsgEnabled) {
      entryOrderAlerts = entryOrderAlerts.filter((a) => a.id !== pos.entryAlertId);
    }

    if (closeReason) {
      const costBasis = pos.positionSizeSol + pos.entryFeeSol;
      const netPnlSol = Number((realizedSol - costBasis).toFixed(4));
      const netPnlPct = Number(((netPnlSol / Math.max(0.0001, costBasis)) * 100).toFixed(2));
      cashBalanceSol = Number((cashBalanceSol + realizedSol).toFixed(4));
      totalNetPnlSol = Number((totalNetPnlSol + netPnlSol).toFixed(4));
      if (netPnlSol >= 0) wins++;
      else losses++;
      mintCooldownUntilTick[pos.mint] = nextTick + 5;

      closedTrades.unshift({
        id: pos.id,
        mint: pos.mint,
        symbol: pos.symbol,
        dex: pos.dex,
        strategy: pos.strategy,
        closeReason,
        entryPriceSol: pos.entryPriceSol,
        exitPriceSol: livePrice,
        positionSizeSol: pos.positionSizeSol,
        netPnlSol,
        netPnlPct,
        closedAt: now,
      });
    } else {
      nextOpenPositions.push({
        ...pos,
        currentPriceSol: livePrice,
        highestPriceSol,
        remainingShare,
        realizedSol,
        tp1Hit,
        tp2Hit,
        breakevenArmed,
        trailingActive,
        ticksObserved,
      });
    }
  }

  // 2. Evaluate new incoming snapshots
  const openMints = new Set(nextOpenPositions.map((p) => p.mint));
  const regime = detectMarketRegime({ regimeOverride: options?.regimeOverride });

  for (const snap of snapshots) {
    if (openMints.has(snap.mint)) continue;
    if ((mintCooldownUntilTick[snap.mint] ?? 0) >= nextTick) continue;
    evaluatedCount++;

    if (nextOpenPositions.length >= maxOpen) {
      continue;
    }

    const candidate = liveSnapshotToCandidate(snap);
    const baseEval = evaluateTokenCandidate(candidate, cfg);
    const aiEval = evaluateAiTokenCandidate(candidate, cfg, baseEval, { regime });
    const entryEval = evaluateAdaptiveEntry(candidate, aiEval, baseEval, regime, cfg);

    if (!baseEval.overallApproved || !aiEval.passed || !entryEval.approved) {
      rejectedCount++;
      continue;
    }

    const openExposureSol = nextOpenPositions.reduce(
      (acc, p) => acc + p.positionSizeSol * p.remainingShare,
      0,
    );
    const sizing = computeDynamicPositionSize({
      availableBalanceSol: cashBalanceSol,
      openExposureSol,
      dailyRealizedPnlSol: totalNetPnlSol,
      securityScore: baseEval.securityScore,
      liquidityUsd: snap.liquidityUsd,
      cfg,
    });

    if (!sizing.allowed) {
      rejectedCount++;
      continue;
    }

    const feePlan = computeEffectiveFees(sizing.sizedBuySol, cfg.jitoTipSol, cfg.maxFeeRatioPct);
    const entryFeeSol = Number((feePlan.effectiveJitoTipSol + feePlan.buyPrioritySol).toFixed(6));
    const totalDebit = sizing.sizedBuySol + entryFeeSol;
    if (cashBalanceSol < totalDebit) {
      rejectedCount++;
      continue;
    }

    cashBalanceSol = Number((cashBalanceSol - totalDebit).toFixed(4));
    const alertId = nextAlertId++;
    const tradeId = `rt-${nextTick}-${snap.symbol}-${alertId}`;

    nextOpenPositions.push({
      id: tradeId,
      mint: snap.mint,
      symbol: snap.symbol,
      dex: snap.dex,
      strategy: entryEval.selectedStrategy,
      entryPriceSol: snap.priceSol,
      currentPriceSol: snap.priceSol,
      highestPriceSol: snap.priceSol,
      positionSizeSol: sizing.sizedBuySol,
      remainingShare: 1,
      realizedSol: 0,
      entryFeeSol,
      tp1Hit: false,
      tp2Hit: false,
      breakevenArmed: false,
      trailingActive: false,
      openedAt: now,
      ticksObserved: 0,
      entryAlertId: alertId,
    });
    openMints.add(snap.mint);

    entryOrderAlerts.unshift({
      id: alertId,
      mint: snap.mint,
      symbol: snap.symbol,
      text: `MUA ${snap.symbol} (${entryEval.selectedStrategy}) · ${sizing.sizedBuySol} SOL · AI ${aiEval.tokenQualityScore}/100`,
      createdAt: now,
    });
    if (entryOrderAlerts.length > 15) {
      entryOrderAlerts = entryOrderAlerts.slice(0, 15);
    }
  }

  // 3. Recompute total Equity & Drawdown
  const openMarketValueSol = nextOpenPositions.reduce((acc, p) => {
    const mult = p.currentPriceSol / Math.max(1e-12, p.entryPriceSol);
    return acc + p.positionSizeSol * p.remainingShare * mult + p.realizedSol;
  }, 0);
  const currentEquitySol = Number((cashBalanceSol + openMarketValueSol).toFixed(4));
  const peakEquitySol = Math.max(prev.peakEquitySol, currentEquitySol);
  const ddSol = Number(Math.max(0, peakEquitySol - currentEquitySol).toFixed(4));
  const maxDrawdownSol = Math.max(prev.maxDrawdownSol, ddSol);
  const maxDrawdownPct =
    peakEquitySol > 0 ? Number(((maxDrawdownSol / peakEquitySol) * 100).toFixed(2)) : 0;

  const equityCurve = [
    ...prev.equityCurve,
    { tick: nextTick, label: `T${nextTick}`, equitySol: currentEquitySol },
  ].slice(-40);

  return {
    ...prev,
    tickCount: nextTick,
    cashBalanceSol,
    peakEquitySol,
    maxDrawdownSol,
    maxDrawdownPct,
    totalNetPnlSol,
    wins,
    losses,
    evaluatedCount,
    rejectedCount,
    lastFeedSource: options?.feedSource ?? prev.lastFeedSource,
    lastUpdatedAt: now,
    openPositions: nextOpenPositions,
    closedTrades: closedTrades.slice(0, 30),
    entryOrderAlerts,
    equityCurve,
    nextAlertId,
    mintCooldownUntilTick,
  };
}
