export type TradingMode = 'PAPER' | 'LIVE';
export type DexSource = 'RAYDIUM_V4' | 'RAYDIUM_CPMM' | 'PUMP_FUN' | 'METEORA_DLMM';
export type TipUrgency = 'NORMAL' | 'HIGH_CONVICTION' | 'EMERGENCY';
export type StrategyPresetId =
  | 'MAX_THROUGHPUT'
  | 'BALANCED'
  | 'STRICT_SAFE'
  | 'SMALL_CAP_HIGH_PF';

export type MarketRegimeType = 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'HIGH_VOLATILITY';
export type EntryStrategyId =
  | 'EARLY_MOMENTUM'
  | 'BREAKOUT'
  | 'PULLBACK'
  | 'LIQUIDITY_INFLOW'
  | 'SMART_MONEY';
export type NarrativeCategory =
  | 'AI_AGENT'
  | 'MEME_CULT'
  | 'POLITIFI'
  | 'CAT_DOG'
  | 'DEFI_INFRA'
  | 'OTHER';
export type TokenLifecycleStage =
  | 'BIRTH'
  | 'EARLY_ACCUMULATION'
  | 'EXPANSION'
  | 'DISTRIBUTION'
  | 'EXHAUSTION';
export type EntryTimingVerdict = 'OPTIMAL_NOW' | 'WAIT_PULLBACK' | 'LATE_CHASE' | 'AVOID';

export interface StrategyConfig {
  tradingMode: TradingMode;
  autoSnipeEnabled: boolean;
  trailingStopEnabled: boolean;
  trailingTpEnabled: boolean;
  orderflowFilterEnabled: boolean;
  washTradeGuardEnabled: boolean;
  momentumFilterEnabled: boolean;
  honeypotSimEnabled: boolean;
  lpLockCheckEnabled: boolean;
  antiBundleCheckEnabled: boolean;
  spreadGuardEnabled: boolean;
  cooldownGuardEnabled: boolean;
  breakevenLockEnabled: boolean;
  earlyMomentumCutEnabled: boolean;
  timeExitEnabled: boolean;
  circuitBreakerEnabled: boolean;
  autoDeleteEntryMsgEnabled: boolean;
  snipePumpCreate: boolean;
  aiIntelligenceEnabled: boolean;
  smartMoneyFilterEnabled: boolean;
  marketRegimeGuardEnabled: boolean;
  adaptiveEntryEnabled: boolean;
  socialIntelligenceEnabled: boolean;
  continuousLearningEnabled: boolean;
  accountBalanceSol: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  profitProtectionPct: number;
  minAiQualityScore: number;
  minEntryRankScore: number;
  maxPriceImpactPct: number;
  slippageBps: number;
  jitoTipSol: number;
  maxFeeRatioPct: number;
  minLiquidityUsd: number;
  minUniqueBuyers: number;
  minBuyCount: number;
  maxRoundtripSpreadPct: number;
  minLpBurnedPct: number;
  maxTop10HoldersPct: number;
  maxDevHoldPct: number;
  maxBundleSupplyPct: number;
  tp1Pct: number;
  tp1SellSharePct: number;
  tp2Pct: number;
  tp2SellSharePct: number;
  trailingTpCallbackPct: number;
  breakevenActivatePct: number;
  trailingActivatePct: number;
  trailingCallbackPct: number;
  hardSlPct: number;
  timeExitMinutes: number;
  maxSinglePositionPct: number;
  maxPortfolioHeatPct: number;
  rugDrainMissTicks: number;
  rugDrainLiqRatio: number;
  dynamicJitoTipEnabled: boolean;
  minVolumeSpikeRatio: number;
  autoRentReclaimEnabled: boolean;
  autoConsolidateEnabled: boolean;
  smallCapEdgeMode?: boolean;
  blacklistedCreators: string[];
}

export interface TokenCandidateInput {
  mint: string;
  symbol: string;
  name: string;
  dex: DexSource;
  eventKind?: 'NEW_POOL' | 'MIGRATION';
  creatorAddress?: string;
  creatorBlacklisted?: boolean;
  hasVerifiedPrice?: boolean;
  liquidityUsd?: number;
  roundTripSpreadPct?: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpBurnedPct: number;
  top10HoldersPct: number;
  devHoldPct: number;
  bundleSupplyPct: number;
  rugcheckRisk: 'Good' | 'Warn' | 'Danger' | 'Unindexed';
  honeypotPassed: boolean;
  buyCount: number;
  sellCount: number;
  uniqueBuyers?: number;
  devSold: boolean;
  m5VolumeUsd?: number;
  h1VolumeUsd?: number;
  largestBuyerSharePct?: number;
  ageMinutes?: number;
  priceChangeM5Pct?: number;
  fdvUsd?: number;
}

export interface LayerEvaluation {
  layer: string;
  passed: boolean;
  critical: boolean;
  detail: string;
}

export interface DynamicTipResult {
  tipSol: number;
  source: 'JITO_FLOOR_API' | 'STATIC_FALLBACK';
  urgency: TipUrgency;
  floorSol: number | null;
  cappedByBudget: boolean;
}

export interface ReconciliationResult {
  reconciled: boolean;
  actualSolUi: number;
  actualTokenDeltaUi: number;
  actualFeeSol: number;
  slippageDiffPct: number;
}

export interface CandidateEvaluationResult {
  overallApproved: boolean;
  antiRugSafe: boolean;
  securityScore: number;
  creatorBlacklisted: boolean;
  marketGatePassed: boolean;
  orderflowPassed: boolean;
  buyToSellRatio: number;
  volumeSpikeRatio: number;
  priceChangeM5Pct: number;
  washTradeSuspected: boolean;
  feeRatioPct: number;
  effectiveJitoTipSol: number;
  autoSizedBuySol: number;
  riskBudgetSol: number;
  layers: LayerEvaluation[];
  rejectionReasons: string[];
}

export interface SimulatedPriceStep {
  minute: number;
  priceMultiplier: number;
  liquidityRatio?: number;
  unquotableTicks?: number;
}

export interface DynamicSizingResult {
  allowed: boolean;
  sizedBuySol: number;
  riskBudgetSol: number;
  riskPctOfBalance: number;
  multiplier: number;
  portfolioHeatPct: number;
  projectedHeatPct: number;
  dailyLossHit: boolean;
  weeklyLossHit: boolean;
  heatLimitHit: boolean;
  liquidityCapSol: number;
  estimatedPriceImpactPct: number;
  estimatedExitSlippagePct: number;
  reason: string;
}

export interface PositionLifecycleResult {
  closed: boolean;
  closeReason: string | null;
  positionSizeSol: number;
  riskBudgetSol: number;
  tp1Hit: boolean;
  tp1TrailingArmed: boolean;
  tp2Hit: boolean;
  tp2TrailingArmed: boolean;
  breakevenArmed: boolean;
  trailingActive: boolean;
  highestMultiplier: number;
  realizedSol: number;
  netPnlSol: number;
  netPnlPct: number;
  effectiveJitoTipSol: number;
  feeRatioPct: number;
  events: Array<{
    minute: number;
    action: string;
    multiplier: number;
    solProceeds: number;
    remainingSharePct: number;
  }>;
}

export interface TradeOutcome {
  symbol: string;
  netPnlSol: number;
  timestamp: number;
}

export interface AnalyticsSummary {
  totalClosed: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownSol: number;
  maxDrawdownPct: number;
  initialBalanceSol: number;
  currentBalanceSol: number;
  peakBalanceSol: number;
  netReturnPct: number;
  totalNetPnlSol: number;
  balanceCurve: Array<{
    index: number;
    symbol: string;
    balanceSol: number;
    pnlSol: number;
  }>;
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  tradingMode: 'PAPER',
  autoSnipeEnabled: true,
  trailingStopEnabled: true,
  trailingTpEnabled: true,
  orderflowFilterEnabled: true,
  washTradeGuardEnabled: true,
  momentumFilterEnabled: true,
  honeypotSimEnabled: true,
  lpLockCheckEnabled: true,
  antiBundleCheckEnabled: true,
  spreadGuardEnabled: true,
  cooldownGuardEnabled: true,
  breakevenLockEnabled: true,
  earlyMomentumCutEnabled: true,
  timeExitEnabled: true,
  circuitBreakerEnabled: true,
  autoDeleteEntryMsgEnabled: true,
  snipePumpCreate: false,
  aiIntelligenceEnabled: true,
  smartMoneyFilterEnabled: true,
  marketRegimeGuardEnabled: true,
  adaptiveEntryEnabled: true,
  socialIntelligenceEnabled: true,
  continuousLearningEnabled: true,
  accountBalanceSol: 10,
  riskPerTradePct: 1,
  maxDailyLossPct: 5,
  maxWeeklyLossPct: 12,
  profitProtectionPct: 25,
  minAiQualityScore: 54,
  minEntryRankScore: 52,
  maxPriceImpactPct: 8.5,
  slippageBps: 1200,
  jitoTipSol: 0.001,
  maxFeeRatioPct: 6,
  minLiquidityUsd: 8000,
  minUniqueBuyers: 4,
  minBuyCount: 5,
  maxRoundtripSpreadPct: 12,
  minLpBurnedPct: 90,
  maxTop10HoldersPct: 32,
  maxDevHoldPct: 6,
  maxBundleSupplyPct: 30,
  tp1Pct: 45,
  tp1SellSharePct: 50,
  tp2Pct: 120,
  tp2SellSharePct: 30,
  trailingTpCallbackPct: 8,
  breakevenActivatePct: 18,
  trailingActivatePct: 28,
  trailingCallbackPct: 12,
  hardSlPct: 25,
  timeExitMinutes: 12,
  maxSinglePositionPct: 15,
  maxPortfolioHeatPct: 35,
  rugDrainMissTicks: 5,
  rugDrainLiqRatio: 0.35,
  dynamicJitoTipEnabled: true,
  minVolumeSpikeRatio: 0.5,
  autoRentReclaimEnabled: true,
  autoConsolidateEnabled: false,
  smallCapEdgeMode: false,
  blacklistedCreators: ['RugDev6666666666666666666666666666666666666'],
};

export function applyStrategyPreset(
  current: StrategyConfig,
  preset: StrategyPresetId,
): StrategyConfig {
  if (preset === 'MAX_THROUGHPUT') {
    return {
      ...current,
      honeypotSimEnabled: false,
      lpLockCheckEnabled: false,
      antiBundleCheckEnabled: false,
      orderflowFilterEnabled: true,
      washTradeGuardEnabled: false,
      momentumFilterEnabled: false,
      spreadGuardEnabled: false,
      cooldownGuardEnabled: false,
      aiIntelligenceEnabled: false,
      smartMoneyFilterEnabled: false,
      marketRegimeGuardEnabled: false,
      adaptiveEntryEnabled: false,
      socialIntelligenceEnabled: false,
      minLiquidityUsd: 3500,
      minBuyCount: 2,
      minUniqueBuyers: 2,
      maxPortfolioHeatPct: 60,
      breakevenLockEnabled: true,
      earlyMomentumCutEnabled: false,
      timeExitEnabled: true,
      circuitBreakerEnabled: false,
    };
  }
  if (preset === 'STRICT_SAFE') {
    return {
      ...current,
      honeypotSimEnabled: true,
      lpLockCheckEnabled: true,
      antiBundleCheckEnabled: true,
      orderflowFilterEnabled: true,
      washTradeGuardEnabled: true,
      momentumFilterEnabled: true,
      spreadGuardEnabled: true,
      cooldownGuardEnabled: true,
      aiIntelligenceEnabled: true,
      smartMoneyFilterEnabled: true,
      marketRegimeGuardEnabled: true,
      adaptiveEntryEnabled: true,
      socialIntelligenceEnabled: true,
      continuousLearningEnabled: true,
      minAiQualityScore: 65,
      minEntryRankScore: 62,
      maxPriceImpactPct: 4.5,
      minLiquidityUsd: 12000,
      minBuyCount: 6,
      minUniqueBuyers: 5,
      maxPortfolioHeatPct: 30,
      breakevenLockEnabled: true,
      earlyMomentumCutEnabled: true,
      timeExitEnabled: true,
      circuitBreakerEnabled: true,
    };
  }
  if (preset === 'SMALL_CAP_HIGH_PF') {
    return {
      ...current,
      honeypotSimEnabled: true,
      lpLockCheckEnabled: true,
      antiBundleCheckEnabled: true,
      orderflowFilterEnabled: true,
      washTradeGuardEnabled: true,
      momentumFilterEnabled: true,
      spreadGuardEnabled: true,
      cooldownGuardEnabled: true,
      aiIntelligenceEnabled: true,
      smartMoneyFilterEnabled: true,
      marketRegimeGuardEnabled: true,
      adaptiveEntryEnabled: true,
      socialIntelligenceEnabled: true,
      continuousLearningEnabled: true,
      smallCapEdgeMode: true,
      riskPerTradePct: 2.0,
      maxSinglePositionPct: 20,
      maxPortfolioHeatPct: 40,
      maxDailyLossPct: 4,
      maxWeeklyLossPct: 10,
      profitProtectionPct: 35,
      minAiQualityScore: 68,
      minEntryRankScore: 65,
      maxPriceImpactPct: 3.0,
      maxRoundtripSpreadPct: 6.5,
      minLiquidityUsd: 12_000,
      minBuyCount: 8,
      minUniqueBuyers: 6,
      jitoTipSol: 0.00025,
      maxFeeRatioPct: 2.2,
      tp1Pct: 30,
      tp1SellSharePct: 55,
      tp2Pct: 95,
      tp2SellSharePct: 30,
      trailingTpCallbackPct: 6,
      breakevenActivatePct: 12,
      trailingActivatePct: 18,
      trailingCallbackPct: 9,
      hardSlPct: 12,
      timeExitMinutes: 8,
      breakevenLockEnabled: true,
      earlyMomentumCutEnabled: true,
      timeExitEnabled: true,
      circuitBreakerEnabled: true,
    };
  }
  return {
    ...current,
    honeypotSimEnabled: true,
    lpLockCheckEnabled: true,
    antiBundleCheckEnabled: true,
    orderflowFilterEnabled: true,
    washTradeGuardEnabled: true,
    momentumFilterEnabled: true,
    spreadGuardEnabled: true,
    cooldownGuardEnabled: true,
    aiIntelligenceEnabled: true,
    smartMoneyFilterEnabled: true,
    marketRegimeGuardEnabled: true,
    adaptiveEntryEnabled: true,
    socialIntelligenceEnabled: true,
    continuousLearningEnabled: true,
    smallCapEdgeMode: false,
    minAiQualityScore: 54,
    minEntryRankScore: 52,
    maxPriceImpactPct: 8.5,
    minLiquidityUsd: 8000,
    minBuyCount: 5,
    minUniqueBuyers: 4,
    maxPortfolioHeatPct: 35,
    breakevenLockEnabled: true,
    earlyMomentumCutEnabled: true,
    timeExitEnabled: true,
    circuitBreakerEnabled: true,
  };
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export function isCreatorBlacklisted(
  creatorAddress: string | undefined,
  blacklistedCreators: string[],
  explicitFlag?: boolean,
): boolean {
  if (explicitFlag) return true;
  if (!creatorAddress) return false;
  const normalized = creatorAddress.trim();
  return blacklistedCreators.some((item) => item.trim() === normalized);
}

export function computeEffectiveFees(
  orderSizeSol: number,
  requestedJitoTipSol: number,
  maxFeeRatioPct: number,
): {
  effectiveJitoTipSol: number;
  buyPrioritySol: number;
  sellPrioritySol: number;
  totalRoundTripFeeSol: number;
  feeRatioPct: number;
} {
  const safeOrderSol = orderSizeSol > 0 ? orderSizeSol : 0.05;
  const buyPrioritySol = 0.0002;
  const sellPrioritySol = 0.0002;
  const basePriority = buyPrioritySol + sellPrioritySol;
  const maxBudget = Math.max(0.0005, safeOrderSol * (maxFeeRatioPct / 100));
  const maxTipPerSide = Math.max(0.00005, (maxBudget - basePriority) / 2);
  const effectiveJitoTipSol = Number(Math.min(requestedJitoTipSol, maxTipPerSide).toFixed(6));
  const totalRoundTripFeeSol = Number((effectiveJitoTipSol * 2 + basePriority).toFixed(6));
  const feeRatioPct = Number(((totalRoundTripFeeSol / safeOrderSol) * 100).toFixed(2));

  return {
    effectiveJitoTipSol,
    buyPrioritySol,
    sellPrioritySol,
    totalRoundTripFeeSol,
    feeRatioPct,
  };
}

export function computeDynamicJitoTip(params: {
  baseTipSol: number;
  buyAmountSol: number;
  maxFeeRatioPct: number;
  dynamicEnabled: boolean;
  urgency?: TipUrgency;
  liveTipFloorSol?: number | null;
}): DynamicTipResult {
  const urgency = params.urgency ?? 'NORMAL';
  const urgencyMultiplier =
    urgency === 'EMERGENCY' ? 1.5 : urgency === 'HIGH_CONVICTION' ? 1.25 : 1.0;

  const floorSol =
    params.liveTipFloorSol !== undefined &&
    params.liveTipFloorSol !== null &&
    params.liveTipFloorSol > 0
      ? params.liveTipFloorSol
      : null;

  let desiredTip = params.baseTipSol;
  let source: DynamicTipResult['source'] = 'STATIC_FALLBACK';

  if (params.dynamicEnabled && floorSol !== null) {
    desiredTip = Math.max(
      params.baseTipSol,
      Math.min(floorSol * 1.1, params.baseTipSol * 2.5),
    );
    source = 'JITO_FLOOR_API';
  }
  desiredTip *= urgencyMultiplier;

  const basePriorityTotal = 0.0004;
  const maxBudgetSol = Math.max(
    0.0005,
    params.buyAmountSol * ((params.maxFeeRatioPct || 6) / 100),
  );
  const maxTipPerSide = Math.max(0.00005, (maxBudgetSol - basePriorityTotal) / 2);
  const effectiveMaxTip =
    urgency === 'EMERGENCY' ? Math.max(maxTipPerSide, 0.0015) : maxTipPerSide;

  const cappedByBudget = desiredTip > effectiveMaxTip;
  const tipSol = Number(Math.min(desiredTip, effectiveMaxTip).toFixed(6));

  return {
    tipSol,
    source,
    urgency,
    floorSol,
    cappedByBudget,
  };
}

export function computePostTradeReconciliation(params: {
  side: 'BUY' | 'SELL';
  expectedSolUi: number;
  preLamports: number;
  postLamports: number;
  feeLamports: number;
  tipSol: number;
  preTokenUi: number;
  postTokenUi: number;
}): ReconciliationResult {
  const feeSol = Math.max(0, params.feeLamports / LAMPORTS_PER_SOL);
  const netWalletSolDelta = (params.postLamports - params.preLamports) / LAMPORTS_PER_SOL;
  const actualTokenDeltaUi = Number(Math.abs(params.postTokenUi - params.preTokenUi).toFixed(6));

  let actualSolUi: number;
  if (params.side === 'BUY') {
    const totalOut = Math.max(0, -netWalletSolDelta - feeSol - params.tipSol);
    actualSolUi = totalOut > 0 ? Number(totalOut.toFixed(6)) : params.expectedSolUi;
  } else {
    actualSolUi = Number(Math.max(0, netWalletSolDelta).toFixed(6));
  }

  const slippageDiffPct =
    params.expectedSolUi > 0
      ? Number((((actualSolUi - params.expectedSolUi) / params.expectedSolUi) * 100).toFixed(2))
      : 0;

  return {
    reconciled: true,
    actualSolUi,
    actualTokenDeltaUi,
    actualFeeSol: Number(feeSol.toFixed(6)),
    slippageDiffPct,
  };
}

export function computeDynamicPositionSize(params: {
  availableBalanceSol: number;
  openExposureSol: number;
  dailyRealizedPnlSol: number;
  weeklyRealizedPnlSol?: number;
  securityScore: number;
  liquidityUsd: number;
  cfg: Pick<
    StrategyConfig,
    | 'riskPerTradePct'
    | 'hardSlPct'
    | 'maxSinglePositionPct'
    | 'maxPortfolioHeatPct'
    | 'maxDailyLossPct'
  > & {
    circuitBreakerEnabled?: boolean;
    maxWeeklyLossPct?: number;
    maxPriceImpactPct?: number;
  };
}): DynamicSizingResult {
  const {
    availableBalanceSol,
    openExposureSol,
    dailyRealizedPnlSol,
    weeklyRealizedPnlSol = dailyRealizedPnlSol,
    securityScore,
    liquidityUsd,
    cfg,
  } = params;

  const equitySol = Math.max(0.001, availableBalanceSol + openExposureSol);
  const currentHeatPct = Number(((openExposureSol / equitySol) * 100).toFixed(2));
  const riskPct = Math.max(0.25, Math.min(5, cfg.riskPerTradePct || 1));
  const riskBudgetSol = Number((equitySol * (riskPct / 100)).toFixed(6));
  const poolSolDepth = liquidityUsd > 0 ? liquidityUsd / 150 : 0;
  const liquidityCapSol =
    poolSolDepth > 0 ? Number((poolSolDepth * 0.03).toFixed(4)) : Number((equitySol * 0.5).toFixed(4));

  const maxDailyLossSol = equitySol * (Math.max(1, cfg.maxDailyLossPct || 5) / 100);
  if ((cfg.circuitBreakerEnabled ?? true) && dailyRealizedPnlSol <= -maxDailyLossSol) {
    return {
      allowed: false,
      sizedBuySol: 0,
      riskBudgetSol,
      riskPctOfBalance: riskPct,
      multiplier: 0,
      portfolioHeatPct: currentHeatPct,
      projectedHeatPct: currentHeatPct,
      dailyLossHit: true,
      weeklyLossHit: false,
      heatLimitHit: false,
      liquidityCapSol,
      estimatedPriceImpactPct: 0,
      estimatedExitSlippagePct: 0,
      reason: `Auto Daily Loss Limit hit (${dailyRealizedPnlSol.toFixed(4)} SOL <= -${maxDailyLossSol.toFixed(4)} SOL [-${cfg.maxDailyLossPct}%])`,
    };
  }

  const maxWeeklyLossPct = Math.max(cfg.maxDailyLossPct || 5, cfg.maxWeeklyLossPct ?? 12);
  const maxWeeklyLossSol = equitySol * (maxWeeklyLossPct / 100);
  if ((cfg.circuitBreakerEnabled ?? true) && weeklyRealizedPnlSol <= -maxWeeklyLossSol) {
    return {
      allowed: false,
      sizedBuySol: 0,
      riskBudgetSol,
      riskPctOfBalance: riskPct,
      multiplier: 0,
      portfolioHeatPct: currentHeatPct,
      projectedHeatPct: currentHeatPct,
      dailyLossHit: false,
      weeklyLossHit: true,
      heatLimitHit: false,
      liquidityCapSol,
      estimatedPriceImpactPct: 0,
      estimatedExitSlippagePct: 0,
      reason: `Weekly Loss Limit hit (${weeklyRealizedPnlSol.toFixed(4)} SOL <= -${maxWeeklyLossSol.toFixed(4)} SOL [-${maxWeeklyLossPct}%])`,
    };
  }

  const maxHeatSol = equitySol * (cfg.maxPortfolioHeatPct / 100);
  const remainingHeatSol = Math.max(0, maxHeatSol - openExposureSol);
  if (remainingHeatSol < 0.005) {
    return {
      allowed: false,
      sizedBuySol: 0,
      riskBudgetSol,
      riskPctOfBalance: riskPct,
      multiplier: 0,
      portfolioHeatPct: currentHeatPct,
      projectedHeatPct: currentHeatPct,
      dailyLossHit: false,
      weeklyLossHit: false,
      heatLimitHit: true,
      liquidityCapSol,
      estimatedPriceImpactPct: 0,
      estimatedExitSlippagePct: 0,
      reason: `Portfolio Heat limit reached (${currentHeatPct}% >= ${cfg.maxPortfolioHeatPct}%)`,
    };
  }

  const slFraction = Math.max(0.1, Math.min(0.8, Math.abs(cfg.hardSlPct || 25) / 100));
  const riskNormalizedBaseSol = riskBudgetSol / slFraction;

  let multiplier = 1.0;
  if (securityScore >= 100) multiplier += 0.1;
  else if (securityScore < 80) multiplier -= 0.2;

  if (liquidityUsd > 0 && liquidityUsd < 15_000) {
    multiplier = Math.min(multiplier, 0.75);
  } else if (liquidityUsd >= 50_000) {
    multiplier += 0.1;
  }
  multiplier = Math.max(0.5, Math.min(1.25, Number(multiplier.toFixed(2))));

  const rawSized = riskNormalizedBaseSol * multiplier;
  const maxSingleWalletCap = equitySol * (cfg.maxSinglePositionPct / 100);
  const feeReserveSol = 0.003;
  const spendableBalance = Math.max(0, availableBalanceSol - feeReserveSol);
  const cappedSol = Math.min(
    rawSized,
    maxSingleWalletCap,
    remainingHeatSol,
    spendableBalance,
    liquidityCapSol,
  );
  const sizedBuySol = Number(cappedSol.toFixed(4));

  const estimatedPriceImpactPct =
    poolSolDepth > 0 ? Number(Math.min(25, (sizedBuySol / (poolSolDepth * 0.5)) * 100).toFixed(2)) : 0;
  const estimatedExitSlippagePct = Number((estimatedPriceImpactPct * 1.15 + 0.65).toFixed(2));

  if (sizedBuySol < 0.005) {
    return {
      allowed: false,
      sizedBuySol: 0,
      riskBudgetSol,
      riskPctOfBalance: riskPct,
      multiplier,
      portfolioHeatPct: currentHeatPct,
      projectedHeatPct: currentHeatPct,
      dailyLossHit: false,
      weeklyLossHit: false,
      heatLimitHit: remainingHeatSol < 0.005,
      liquidityCapSol,
      estimatedPriceImpactPct,
      estimatedExitSlippagePct,
      reason: `Insufficient spendable balance for ${riskPct}% risk trade (${sizedBuySol} SOL < 0.005 SOL)`,
    };
  }

  const projectedHeatPct = Number((((openExposureSol + sizedBuySol) / equitySol) * 100).toFixed(2));
  const actualRiskSol = Number((sizedBuySol * slFraction).toFixed(4));
  const actualRiskPct = Number(((actualRiskSol / equitySol) * 100).toFixed(2));

  return {
    allowed: true,
    sizedBuySol,
    riskBudgetSol: actualRiskSol,
    riskPctOfBalance: actualRiskPct,
    multiplier,
    portfolioHeatPct: currentHeatPct,
    projectedHeatPct,
    dailyLossHit: false,
    weeklyLossHit: false,
    heatLimitHit: false,
    liquidityCapSol,
    estimatedPriceImpactPct,
    estimatedExitSlippagePct,
    reason: `Auto ${sizedBuySol} SOL (Risk ${actualRiskSol} SOL = ${actualRiskPct}% Bal, ${multiplier}x, Heat ${currentHeatPct}% -> ${projectedHeatPct}%)`,
  };
}

export function evaluateTokenCandidate(
  token: TokenCandidateInput,
  cfg: StrategyConfig,
  options?: {
    liveTipFloorSol?: number | null;
  },
): CandidateEvaluationResult {
  const hasVerifiedPrice = token.hasVerifiedPrice ?? true;
  const liquidityUsd = token.liquidityUsd ?? 24000;
  const roundTripSpreadPct = token.roundTripSpreadPct ?? 3.5;
  const uniqueBuyers =
    token.uniqueBuyers ??
    (token.buyCount <= 0 ? 0 : Math.max(1, Math.min(token.buyCount, Math.ceil(token.buyCount * 0.68))));
  const isPumpCreate =
    token.dex === 'PUMP_FUN' && (token.eventKind ?? 'NEW_POOL') === 'NEW_POOL';
  const creatorBlacklisted = isCreatorBlacklisted(
    token.creatorAddress,
    cfg.blacklistedCreators,
    token.creatorBlacklisted,
  );

  const l1Passed = token.mintAuthorityRevoked && token.freezeAuthorityRevoked;
  const l2Passed = !cfg.lpLockCheckEnabled || token.lpBurnedPct >= cfg.minLpBurnedPct;
  const l3Passed =
    !creatorBlacklisted &&
    token.top10HoldersPct <= cfg.maxTop10HoldersPct &&
    token.devHoldPct <= cfg.maxDevHoldPct;
  const l4Passed =
    !cfg.antiBundleCheckEnabled || token.bundleSupplyPct <= cfg.maxBundleSupplyPct;
  const honeypotOk = !cfg.honeypotSimEnabled || token.honeypotPassed;
  const spreadOk = !cfg.spreadGuardEnabled || roundTripSpreadPct <= cfg.maxRoundtripSpreadPct;
  const l5Passed = honeypotOk && token.rugcheckRisk !== 'Danger' && spreadOk;

  const layers: LayerEvaluation[] = [
    {
      layer: 'L1: Mint & Freeze Authority',
      passed: l1Passed,
      critical: true,
      detail: `Mint=${token.mintAuthorityRevoked ? 'Revoked' : 'Active'}, Freeze=${
        token.freezeAuthorityRevoked ? 'Revoked' : 'Active'
      }`,
    },
    {
      layer: 'L2: LP Burn / Lock',
      passed: l2Passed,
      critical: cfg.lpLockCheckEnabled,
      detail: cfg.lpLockCheckEnabled
        ? `${token.lpBurnedPct}% burned/locked (min ${cfg.minLpBurnedPct}%)`
        : 'LP Lock Check OFF (Fast Entry)',
    },
    {
      layer: 'L3: Holder & Dev Distribution',
      passed: l3Passed,
      critical: creatorBlacklisted,
      detail: creatorBlacklisted
        ? `CREATOR BLACKLISTED (${token.creatorAddress?.slice(0, 8) ?? 'flagged'})`
        : `Top10=${token.top10HoldersPct}% (max ${cfg.maxTop10HoldersPct}%), Dev=${token.devHoldPct}% (max ${cfg.maxDevHoldPct}%)`,
    },
    {
      layer: 'L4: Block-0 Anti-Bundle',
      passed: l4Passed,
      critical: cfg.antiBundleCheckEnabled,
      detail: cfg.antiBundleCheckEnabled
        ? `Bundled supply=${token.bundleSupplyPct}% (max ${cfg.maxBundleSupplyPct}%)`
        : 'Anti-Bundle OFF (Fast Entry)',
    },
    {
      layer: 'L5: RugCheck & Honeypot Sim',
      passed: l5Passed,
      critical: true,
      detail: `RugCheck=${token.rugcheckRisk}, Spread=${
        cfg.spreadGuardEnabled ? `${roundTripSpreadPct}%` : 'OFF'
      }, Sell Sim=${!cfg.honeypotSimEnabled ? 'OFF' : token.honeypotPassed ? 'Pass' : 'Blocked'}`,
    },
  ];

  const passedCount = layers.filter((l) => l.passed).length;
  let securityScore = Math.round((passedCount / layers.length) * 100);
  if (!l1Passed) securityScore = Math.min(securityScore, 25);
  if ((cfg.honeypotSimEnabled && !token.honeypotPassed) || creatorBlacklisted) {
    securityScore = 0;
  }

  const criticalFailed = layers.some((l) => l.critical && !l.passed);
  const antiRugSafe = !creatorBlacklisted && !criticalFailed;

  const pumpAllowed = !isPumpCreate || cfg.snipePumpCreate;
  const marketGatePassed =
    pumpAllowed &&
    hasVerifiedPrice &&
    liquidityUsd >= cfg.minLiquidityUsd &&
    spreadOk;

  const buyToSellRatio =
    token.sellCount === 0
      ? token.buyCount
      : Number((token.buyCount / token.sellCount).toFixed(2));

  const m5Vol = token.m5VolumeUsd;
  const h1Vol = token.h1VolumeUsd;
  const baseline5m = h1Vol && h1Vol > 0 ? h1Vol / 12 : 0;
  const volumeSpikeRatio =
    m5Vol !== undefined && baseline5m > 0 ? Number((m5Vol / baseline5m).toFixed(2)) : 1.25;

  const avgBuyUsd =
    m5Vol !== undefined && token.buyCount > 0 ? m5Vol / token.buyCount : null;
  const washTradeSuspected =
    cfg.washTradeGuardEnabled &&
    ((avgBuyUsd !== null && token.buyCount >= 50 && avgBuyUsd < 5) ||
      (token.largestBuyerSharePct ?? 0) > 55);

  const priceChangeM5Pct = token.priceChangeM5Pct ?? 12;
  const momentumSweetSpotOk =
    !cfg.momentumFilterEnabled || (priceChangeM5Pct > -20 && priceChangeM5Pct <= 250);
  const spikeOk =
    !cfg.momentumFilterEnabled ||
    (token.ageMinutes !== undefined && token.ageMinutes < 50) ||
    volumeSpikeRatio >= cfg.minVolumeSpikeRatio;
  const fdvToLiqOk =
    !cfg.momentumFilterEnabled ||
    token.fdvUsd === undefined ||
    liquidityUsd <= 0 ||
    token.fdvUsd / liquidityUsd <= 40;
  const turnoverRatio =
    m5Vol !== undefined && liquidityUsd > 0 ? m5Vol / liquidityUsd : 0.2;
  const minTurnoverThreshold = liquidityUsd >= 25_000 ? 0.015 : 0.03;
  const turnoverOk =
    !cfg.momentumFilterEnabled || liquidityUsd <= 0 || turnoverRatio >= minTurnoverThreshold;

  const orderflowPassed =
    !cfg.orderflowFilterEnabled ||
    (!creatorBlacklisted &&
      !token.devSold &&
      !washTradeSuspected &&
      token.buyCount >= cfg.minBuyCount &&
      uniqueBuyers >= cfg.minUniqueBuyers &&
      spikeOk &&
      momentumSweetSpotOk &&
      turnoverOk &&
      fdvToLiqOk &&
      (token.sellCount === 0 ? token.buyCount >= cfg.minBuyCount : buyToSellRatio >= 1.05));

  const sizingPreview = computeDynamicPositionSize({
    availableBalanceSol: cfg.accountBalanceSol,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0,
    securityScore,
    liquidityUsd,
    cfg,
  });
  const autoSizedBuySol = sizingPreview.allowed ? sizingPreview.sizedBuySol : 0.05;
  const tipUrgency: TipUrgency = securityScore >= 100 ? 'HIGH_CONVICTION' : 'NORMAL';
  const baseFees = computeEffectiveFees(autoSizedBuySol, cfg.jitoTipSol, cfg.maxFeeRatioPct);
  const dynamicTip = computeDynamicJitoTip({
    baseTipSol: baseFees.effectiveJitoTipSol,
    buyAmountSol: autoSizedBuySol,
    maxFeeRatioPct: cfg.maxFeeRatioPct,
    dynamicEnabled: cfg.dynamicJitoTipEnabled,
    urgency: tipUrgency,
    liveTipFloorSol: options?.liveTipFloorSol ?? null,
  });

  const rejectionReasons: string[] = [];
  if (creatorBlacklisted) {
    rejectionReasons.push(
      `Creator wallet blacklisted (${token.creatorAddress ?? 'flagged deployer'})`,
    );
  }
  if (!pumpAllowed) {
    rejectionReasons.push(
      'Pump.fun raw Create blocked (wait for Migration or enable SNIPE_PUMP_CREATE)',
    );
  }
  if (!hasVerifiedPrice) {
    rejectionReasons.push(
      'No verified live price from Jupiter/DexScreener (prevents 0.000001 phantom entry)',
    );
  }
  if (liquidityUsd < cfg.minLiquidityUsd) {
    rejectionReasons.push(
      `Liquidity $${liquidityUsd.toLocaleString()} < min $${cfg.minLiquidityUsd.toLocaleString()}`,
    );
  }
  if (!spreadOk) {
    rejectionReasons.push(
      `Round-trip spread ${roundTripSpreadPct}% > max ${cfg.maxRoundtripSpreadPct}%`,
    );
  }
  if (!antiRugSafe) {
    for (const l of layers) {
      if (!l.passed && l.critical) {
        rejectionReasons.push(`${l.layer} failed (${l.detail})`);
      }
    }
  }
  if (!orderflowPassed) {
    if (token.devSold) {
      rejectionReasons.push('Orderflow rejected: Dev wallet dumped in early blocks');
    } else if (washTradeSuspected) {
      rejectionReasons.push(
        `Orderflow rejected: Wash-trade / single-wallet dominance suspected (avgBuy=${avgBuyUsd?.toFixed(1) ?? 'N/A'}$, topBuyer=${token.largestBuyerSharePct ?? 0}%)`,
      );
    } else if (!momentumSweetSpotOk) {
      rejectionReasons.push(
        priceChangeM5Pct <= -20
          ? `Orderflow rejected: Falling knife 5m=${priceChangeM5Pct}%`
          : `Orderflow rejected: Overextended top 5m=+${priceChangeM5Pct}% (>250%)`,
      );
    } else if (!turnoverOk) {
      rejectionReasons.push(
        `Orderflow rejected: Turnover ${(turnoverRatio * 100).toFixed(1)}% < ${(minTurnoverThreshold * 100).toFixed(1)}%`,
      );
    } else if (!fdvToLiqOk) {
      rejectionReasons.push('Orderflow rejected: FDV/Liquidity > 40x (over-inflated)');
    } else if (!spikeOk) {
      rejectionReasons.push(
        `Orderflow rejected: 5m volume spike ${volumeSpikeRatio}x < min ${cfg.minVolumeSpikeRatio}x`,
      );
    } else if (token.buyCount < cfg.minBuyCount) {
      rejectionReasons.push(
        `Orderflow rejected: Buy count ${token.buyCount} < min ${cfg.minBuyCount}`,
      );
    } else if (uniqueBuyers < cfg.minUniqueBuyers) {
      rejectionReasons.push(
        `Orderflow rejected: Unique buyers ${uniqueBuyers} < min ${cfg.minUniqueBuyers}`,
      );
    } else {
      rejectionReasons.push(`Orderflow rejected: Buy/Sell ratio ${buyToSellRatio}x < 1.05x`);
    }
  }

  return {
    overallApproved: antiRugSafe && marketGatePassed && orderflowPassed,
    antiRugSafe,
    securityScore,
    creatorBlacklisted,
    marketGatePassed,
    orderflowPassed,
    buyToSellRatio,
    volumeSpikeRatio,
    priceChangeM5Pct,
    washTradeSuspected,
    feeRatioPct: baseFees.feeRatioPct,
    effectiveJitoTipSol: dynamicTip.tipSol,
    autoSizedBuySol,
    riskBudgetSol: sizingPreview.riskBudgetSol,
    layers,
    rejectionReasons,
  };
}

export function simulatePositionLifecycle(
  steps: SimulatedPriceStep[],
  cfg: StrategyConfig,
): PositionLifecycleResult {
  const autoSize = computeDynamicPositionSize({
    availableBalanceSol: cfg.accountBalanceSol,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0,
    securityScore: 100,
    liquidityUsd: 28500,
    cfg,
  });
  const positionSizeSol = autoSize.allowed ? autoSize.sizedBuySol : 0.05;
  const feePlan = computeEffectiveFees(positionSizeSol, cfg.jitoTipSol, cfg.maxFeeRatioPct);
  const entryCostSol = positionSizeSol + feePlan.effectiveJitoTipSol + feePlan.buyPrioritySol;
  let remainingShare = 1.0;
  let realizedSol = 0;
  let tp1Hit = false;
  let tp1TrailingArmed = false;
  let tp1PeakMultiplier: number | null = null;
  let tp2Hit = false;
  let tp2TrailingArmed = false;
  let tp2PeakMultiplier: number | null = null;
  let breakevenArmed = false;
  let trailingActive = false;
  let highestMultiplier = 1.0;
  let trailingStopMultiplier: number | null = null;
  let closed = false;
  let closeReason: string | null = null;

  const events: PositionLifecycleResult['events'] = [];

  for (const step of steps) {
    if (closed) break;

    const mult = step.priceMultiplier;
    if (mult > highestMultiplier) {
      highestMultiplier = mult;
    }

    const pnlPct = (mult - 1) * 100;

    if (cfg.breakevenLockEnabled && pnlPct >= cfg.breakevenActivatePct) {
      breakevenArmed = true;
    }

    if (cfg.trailingStopEnabled && pnlPct >= cfg.trailingActivatePct) {
      trailingActive = true;
      const nextTrail = highestMultiplier * (1 - cfg.trailingCallbackPct / 100);
      trailingStopMultiplier =
        trailingStopMultiplier !== null ? Math.max(trailingStopMultiplier, nextTrail) : nextTrail;
    }

    if (cfg.trailingTpEnabled && !tp1Hit && (tp1TrailingArmed || pnlPct >= cfg.tp1Pct)) {
      tp1TrailingArmed = true;
      tp1PeakMultiplier = tp1PeakMultiplier !== null ? Math.max(tp1PeakMultiplier, mult) : mult;
    }

    if (cfg.trailingTpEnabled && tp1Hit && !tp2Hit && (tp2TrailingArmed || pnlPct >= cfg.tp2Pct)) {
      tp2TrailingArmed = true;
      tp2PeakMultiplier = tp2PeakMultiplier !== null ? Math.max(tp2PeakMultiplier, mult) : mult;
    }

    const unquotable = (step.unquotableTicks ?? 0) >= cfg.rugDrainMissTicks;
    const liqDrained =
      step.liquidityRatio !== undefined && step.liquidityRatio < cfg.rugDrainLiqRatio;
    if (unquotable || liqDrained) {
      const recoveryMult = unquotable ? 0 : mult;
      const proceeds = unquotable
        ? 0
        : Math.max(
            0,
            positionSizeSol * remainingShare * recoveryMult -
              (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
          );
      realizedSol += proceeds;
      remainingShare = 0;
      closed = true;
      closeReason = 'RUG_DRAIN';
      events.push({
        minute: step.minute,
        action: 'RUG_DRAIN',
        multiplier: recoveryMult,
        solProceeds: Number(proceeds.toFixed(4)),
        remainingSharePct: 0,
      });
      continue;
    }

    const earlyCutMin = cfg.smallCapEdgeMode ? 5 : 6;
    const earlyCutLossPct = cfg.smallCapEdgeMode ? -8 : -15;
    if (
      pnlPct <= -Math.abs(cfg.hardSlPct) ||
      (cfg.earlyMomentumCutEnabled &&
        step.minute >= earlyCutMin &&
        pnlPct <= earlyCutLossPct &&
        !breakevenArmed &&
        !tp1Hit)
    ) {
      const proceeds = Math.max(
        0,
        positionSizeSol * remainingShare * mult -
          (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
      );
      realizedSol += proceeds;
      remainingShare = 0;
      closed = true;
      closeReason = 'HARD_SL';
      events.push({
        minute: step.minute,
        action: 'HARD_SL',
        multiplier: mult,
        solProceeds: Number(proceeds.toFixed(4)),
        remainingSharePct: 0,
      });
      continue;
    }

    if (!tp1Hit) {
      const tp1Floor = 1 + cfg.tp1Pct / 100;
      const tp1Trigger =
        cfg.trailingTpEnabled && tp1TrailingArmed && tp1PeakMultiplier !== null
          ? Math.max(tp1Floor, tp1PeakMultiplier * (1 - cfg.trailingTpCallbackPct / 100))
          : null;

      const shouldFireTp1 =
        (!cfg.trailingTpEnabled && pnlPct >= cfg.tp1Pct) ||
        (tp1Trigger !== null && mult <= tp1Trigger);

      if (shouldFireTp1) {
        const sellFraction = Math.min(remainingShare, cfg.tp1SellSharePct / 100);
        const proceeds = Math.max(
          0,
          positionSizeSol * sellFraction * mult -
            (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
        );
        realizedSol += proceeds;
        remainingShare = Math.max(0, Number((remainingShare - sellFraction).toFixed(4)));
        tp1Hit = true;
        events.push({
          minute: step.minute,
          action: cfg.trailingTpEnabled ? 'TP1_TRAILING' : 'TP1',
          multiplier: mult,
          solProceeds: Number(proceeds.toFixed(4)),
          remainingSharePct: Math.round(remainingShare * 100),
        });
      }
    }

    if (tp1Hit && !tp2Hit && remainingShare > 0) {
      const tp2Floor = 1 + cfg.tp2Pct / 100;
      const tp2Trigger =
        cfg.trailingTpEnabled && tp2TrailingArmed && tp2PeakMultiplier !== null
          ? Math.max(tp2Floor, tp2PeakMultiplier * (1 - cfg.trailingTpCallbackPct / 100))
          : null;

      const shouldFireTp2 =
        (!cfg.trailingTpEnabled && pnlPct >= cfg.tp2Pct) ||
        (tp2Trigger !== null && mult <= tp2Trigger);

      if (shouldFireTp2) {
        const sellFraction = Math.min(remainingShare, cfg.tp2SellSharePct / 100);
        const proceeds = Math.max(
          0,
          positionSizeSol * sellFraction * mult -
            (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
        );
        realizedSol += proceeds;
        remainingShare = Math.max(0, Number((remainingShare - sellFraction).toFixed(4)));
        tp2Hit = true;
        events.push({
          minute: step.minute,
          action: cfg.trailingTpEnabled ? 'TP2_TRAILING' : 'TP2',
          multiplier: mult,
          solProceeds: Number(proceeds.toFixed(4)),
          remainingSharePct: Math.round(remainingShare * 100),
        });
      }
    }

    if (trailingActive && trailingStopMultiplier !== null && mult <= trailingStopMultiplier) {
      const proceeds = Math.max(
        0,
        positionSizeSol * remainingShare * mult -
          (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
      );
      realizedSol += proceeds;
      remainingShare = 0;
      closed = true;
      closeReason = 'TRAILING_SL';
      events.push({
        minute: step.minute,
        action: 'TRAILING_SL',
        multiplier: mult,
        solProceeds: Number(proceeds.toFixed(4)),
        remainingSharePct: 0,
      });
      continue;
    }

    const beFloorPct = cfg.smallCapEdgeMode && tp1Hit ? 3.5 : 5.01;
    if (
      cfg.breakevenLockEnabled &&
      ((breakevenArmed && !tp1Hit && pnlPct <= 5.01) ||
        (cfg.smallCapEdgeMode && tp1Hit && !trailingActive && pnlPct <= beFloorPct))
    ) {
      const proceeds = Math.max(
        0,
        positionSizeSol * remainingShare * mult -
          (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
      );
      realizedSol += proceeds;
      remainingShare = 0;
      closed = true;
      closeReason = 'BREAKEVEN_SL';
      events.push({
        minute: step.minute,
        action: 'BREAKEVEN_SL',
        multiplier: mult,
        solProceeds: Number(proceeds.toFixed(4)),
        remainingSharePct: 0,
      });
      continue;
    }

    if (
      !closed &&
      cfg.timeExitEnabled &&
      step.minute >= cfg.timeExitMinutes &&
      pnlPct < 8 &&
      !tp1Hit &&
      !tp1TrailingArmed
    ) {
      const proceeds = Math.max(
        0,
        positionSizeSol * remainingShare * mult -
          (feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol),
      );
      realizedSol += proceeds;
      remainingShare = 0;
      closed = true;
      closeReason = 'TIME_EXIT';
      events.push({
        minute: step.minute,
        action: 'TIME_EXIT',
        multiplier: mult,
        solProceeds: Number(proceeds.toFixed(4)),
        remainingSharePct: 0,
      });
    }
  }

  const lastMult = steps.length > 0 ? steps[steps.length - 1].priceMultiplier : 1;
  const unrealizedSol = closed ? 0 : positionSizeSol * remainingShare * lastMult;
  const totalSolValue = realizedSol + unrealizedSol;
  const netPnlSol = Number((totalSolValue - entryCostSol).toFixed(4));
  const netPnlPct = Number(((netPnlSol / entryCostSol) * 100).toFixed(2));

  return {
    closed,
    closeReason,
    positionSizeSol,
    riskBudgetSol: autoSize.riskBudgetSol,
    tp1Hit,
    tp1TrailingArmed,
    tp2Hit,
    tp2TrailingArmed,
    breakevenArmed,
    trailingActive,
    highestMultiplier: Number(highestMultiplier.toFixed(2)),
    realizedSol: Number(realizedSol.toFixed(4)),
    netPnlSol,
    netPnlPct,
    effectiveJitoTipSol: feePlan.effectiveJitoTipSol,
    feeRatioPct: feePlan.feeRatioPct,
    events,
  };
}

export function computeAnalyticsSummary(
  outcomes: TradeOutcome[],
  initialBalanceSol = 10,
): AnalyticsSummary {
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let cumulative = 0;
  let runningBalance = initialBalanceSol;
  let peakBalance = initialBalanceSol;
  let maxDd = 0;

  const balanceCurve: AnalyticsSummary['balanceCurve'] = [
    {
      index: 0,
      symbol: 'START',
      balanceSol: Number(initialBalanceSol.toFixed(4)),
      pnlSol: 0,
    },
  ];

  outcomes.forEach((o, i) => {
    if (o.netPnlSol >= 0) {
      wins++;
      grossProfit += o.netPnlSol;
    } else {
      losses++;
      grossLoss += Math.abs(o.netPnlSol);
    }

    cumulative = Number((cumulative + o.netPnlSol).toFixed(4));
    runningBalance = Number(Math.max(0, runningBalance + o.netPnlSol).toFixed(4));
    if (runningBalance > peakBalance) peakBalance = runningBalance;
    const dd = peakBalance - runningBalance;
    if (dd > maxDd) maxDd = dd;

    balanceCurve.push({
      index: i + 1,
      symbol: o.symbol,
      balanceSol: runningBalance,
      pnlSol: Number(o.netPnlSol.toFixed(4)),
    });
  });

  const totalClosed = outcomes.length;
  const maxDrawdownSol = Number(maxDd.toFixed(4));
  const maxDrawdownPct =
    peakBalance > 0 ? Number(((maxDrawdownSol / peakBalance) * 100).toFixed(2)) : 0;
  const netReturnPct =
    initialBalanceSol > 0 ? Number(((cumulative / initialBalanceSol) * 100).toFixed(2)) : 0;

  return {
    totalClosed,
    wins,
    losses,
    winRatePct: totalClosed > 0 ? Number(((wins / totalClosed) * 100).toFixed(2)) : 0,
    profitFactor:
      grossLoss > 0
        ? Number((grossProfit / grossLoss).toFixed(2))
        : grossProfit > 0
          ? 99.99
          : 0,
    maxDrawdownSol,
    maxDrawdownPct,
    initialBalanceSol: Number(initialBalanceSol.toFixed(4)),
    currentBalanceSol: runningBalance,
    peakBalanceSol: Number(peakBalance.toFixed(4)),
    netReturnPct,
    totalNetPnlSol: cumulative,
    balanceCurve,
  };
}

// === v7 AI Token Intelligence, Market Regime, Adaptive Entry & Walk-Forward Backtest ===

export interface MarketRegimeSnapshot {
  regime: MarketRegimeType;
  confidence: number;
  solTrendPct: number;
  memecoinSentimentScore: number;
  liquidityFlowScore: number;
  recommendedStrategy: EntryStrategyId;
  minAiScoreThreshold: number;
  sizeMultiplier: number;
}

export interface AiIntelligenceEvaluation {
  passed: boolean;
  tokenQualityScore: number;
  pumpProbability: number;
  rugProbability: number;
  calibratedConfidence: number;
  lifecycleStage: TokenLifecycleStage;
  entryTiming: EntryTimingVerdict;
  priceMomentumPrediction: 'SURGING' | 'BULLISH' | 'NEUTRAL' | 'FADING' | 'DUMPING';
  liquidityGrowthPrediction: 'EXPANDING' | 'STABLE' | 'DRAINING';
  expectedReturn15mPct: number;
  smartMoneyScore: number;
  socialScore: number;
  narrative: NarrativeCategory;
  dataConfidencePct: number;
  reason: string;
}

export interface AdaptiveEntryEvaluation {
  approved: boolean;
  selectedStrategy: EntryStrategyId;
  entryRankScore: number;
  dynamicThreshold: number;
  multiTimeframeConfirmed: boolean;
  estimatedEntrySlippagePct: number;
  strategyScores: Record<EntryStrategyId, number>;
  reasons: string[];
}

export interface WalkForwardBacktestReport {
  sampleSize: number;
  totalTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancySol: number;
  netPnlAfterFeesSol: number;
  totalFeesSol: number;
  totalSlippageCostSol: number;
  maxDrawdownPct: number;
  inSampleWinRatePct: number;
  walkForwardOosWinRatePct: number;
  walkForwardOosProfitFactor: number;
  monteCarloMedianReturnPct: number;
  monteCarloP05ReturnPct: number;
  monteCarloWorstDdPct: number;
  rejectedPumpedPct: number;
  byStrategy: Record<
    EntryStrategyId,
    { trades: number; wins: number; winRatePct: number; netPnlSol: number }
  >;
}

function sigmoid(x: number): number {
  const clamped = Math.max(-12, Math.min(12, x));
  return 1 / (1 + Math.exp(-clamped));
}

export function detectMarketRegime(params?: {
  regimeOverride?: MarketRegimeType;
  solChange1hPct?: number;
  breadthPositivePct?: number;
  volatilityPct?: number;
}): MarketRegimeSnapshot {
  const override = params?.regimeOverride;
  const solTrendPct = params?.solChange1hPct ?? (override === 'BEARISH' ? -3.4 : override === 'HIGH_VOLATILITY' ? 1.8 : override === 'SIDEWAYS' ? 0.2 : 2.6);
  const breadth = params?.breadthPositivePct ?? (override === 'BEARISH' ? 32 : override === 'HIGH_VOLATILITY' ? 48 : override === 'SIDEWAYS' ? 50 : 68);
  const vol = params?.volatilityPct ?? (override === 'HIGH_VOLATILITY' ? 6.5 : 2.1);

  let regime: MarketRegimeType = override ?? 'BULLISH';
  if (!override) {
    if (vol >= 5.2) regime = 'HIGH_VOLATILITY';
    else if (solTrendPct <= -1.8 || breadth < 40) regime = 'BEARISH';
    else if (solTrendPct >= 1.2 && breadth >= 55) regime = 'BULLISH';
    else regime = 'SIDEWAYS';
  }

  const map: Record<
    MarketRegimeType,
    Omit<MarketRegimeSnapshot, 'regime' | 'solTrendPct'>
  > = {
    BULLISH: {
      confidence: 0.86,
      memecoinSentimentScore: 76,
      liquidityFlowScore: 74,
      recommendedStrategy: 'EARLY_MOMENTUM',
      minAiScoreThreshold: 50,
      sizeMultiplier: 1.1,
    },
    BEARISH: {
      confidence: 0.82,
      memecoinSentimentScore: 34,
      liquidityFlowScore: 38,
      recommendedStrategy: 'SMART_MONEY',
      minAiScoreThreshold: 66,
      sizeMultiplier: 0.7,
    },
    SIDEWAYS: {
      confidence: 0.74,
      memecoinSentimentScore: 54,
      liquidityFlowScore: 52,
      recommendedStrategy: 'PULLBACK',
      minAiScoreThreshold: 56,
      sizeMultiplier: 0.9,
    },
    HIGH_VOLATILITY: {
      confidence: 0.8,
      memecoinSentimentScore: 61,
      liquidityFlowScore: 58,
      recommendedStrategy: 'BREAKOUT',
      minAiScoreThreshold: 62,
      sizeMultiplier: 0.75,
    },
  };

  return {
    regime,
    solTrendPct: Number(solTrendPct.toFixed(2)),
    ...map[regime],
  };
}

export function inferNarrativeCategory(name: string, symbol: string): NarrativeCategory {
  const hay = `${name} ${symbol}`.toLowerCase();
  if (/(ai|gpt|agent|llm|bot|neural|quant)/.test(hay)) return 'AI_AGENT';
  if (/(dog|cat|wif|bonk|pepe|owl|meow|pup|shib)/.test(hay)) return 'CAT_DOG';
  if (/(trump|biden|maga|vote|usa)/.test(hay)) return 'POLITIFI';
  if (/(sol|swap|dex|fi|yield|stake)/.test(hay)) return 'DEFI_INFRA';
  if (/(meme|moon|pump|chad|frog)/.test(hay)) return 'MEME_CULT';
  return 'OTHER';
}

export function evaluateAiTokenCandidate(
  token: TokenCandidateInput,
  cfg: StrategyConfig,
  evalRes?: CandidateEvaluationResult,
  options?: {
    regime?: MarketRegimeSnapshot;
    dataConfidencePct?: number;
    smartMoneyScore?: number;
    socialScore?: number;
  },
): AiIntelligenceEvaluation {
  const baseEval = evalRes ?? evaluateTokenCandidate(token, cfg);
  const regime = options?.regime ?? detectMarketRegime({ regimeOverride: 'BULLISH' });
  const liquidityUsd = token.liquidityUsd ?? 24000;
  const uniqueBuyers =
    token.uniqueBuyers ??
    (token.buyCount <= 0 ? 0 : Math.max(1, Math.min(token.buyCount, Math.ceil(token.buyCount * 0.68))));
  const m5Change = token.priceChangeM5Pct ?? 12;

  const creatorBlacklisted = baseEval.creatorBlacklisted;
  const orderflowImbalance =
    token.buyCount + token.sellCount > 0
      ? (token.buyCount - token.sellCount) / (token.buyCount + token.sellCount)
      : 0;

  const dataConfidencePct =
    options?.dataConfidencePct ??
    Math.max(
      35,
      Math.min(
        100,
        (token.hasVerifiedPrice === false ? 45 : 85) +
          (token.rugcheckRisk !== 'Unindexed' ? 15 : 0),
      ),
    );

  const smartMoneyScore =
    options?.smartMoneyScore ??
    Math.max(
      10,
      Math.min(
        98,
        Math.round(
          42 +
            (creatorBlacklisted ? -35 : 14) +
            Math.min(24, uniqueBuyers * 1.1) -
            (token.largestBuyerSharePct ?? 15) * 0.45 -
            token.bundleSupplyPct * 0.35,
        ),
      ),
    );

  const narrative = inferNarrativeCategory(token.name, token.symbol);
  const narrativeBoost = narrative === 'AI_AGENT' ? 14 : narrative === 'CAT_DOG' ? 10 : 4;
  const socialScore =
    options?.socialScore ??
    Math.max(
      15,
      Math.min(
        96,
        Math.round(
          36 +
            narrativeBoost +
            Math.min(28, uniqueBuyers * 1.3) -
            (baseEval.washTradeSuspected ? 28 : 0),
        ),
      ),
    );

  const sybilPenalty = Math.max(
    0,
    Math.min(1, ((token.largestBuyerSharePct ?? 15) / 100) * 0.7 + (token.bundleSupplyPct / 100) * 0.3),
  );
  const concPenalty = Math.max(
    0,
    Math.min(1, (token.top10HoldersPct / 100) * 0.65 + (token.bundleSupplyPct / 100) * 0.35),
  );

  const logit =
    -1.25 +
    (baseEval.securityScore / 100) * 1.45 +
    (dataConfidencePct / 100) * 0.6 +
    ((orderflowImbalance + 1) / 2) * 1.15 +
    Math.min(1, uniqueBuyers / 35) * 0.85 +
    (smartMoneyScore / 100) * 1.0 +
    (socialScore / 100) * 0.55 +
    Math.min(1, Math.log10(Math.max(1000, liquidityUsd)) / 6) * 0.48 +
    (regime.memecoinSentimentScore / 100) * 0.55 -
    sybilPenalty * 1.4 -
    concPenalty * 0.95;

  const rawPump = sigmoid(logit);
  const reliability = Math.max(0.35, Math.min(1, dataConfidencePct / 100));
  // Shrink confidence toward 0.50 when on-chain/audit data is unverified
  const pumpProbability = Number((0.5 + (rawPump - 0.5) * reliability).toFixed(3));

  const rugLogit =
    -2.1 +
    sybilPenalty * 2.1 +
    concPenalty * 1.9 +
    (creatorBlacklisted ? 2.5 : 0) +
    (!token.honeypotPassed ? 1.8 : 0) -
    (baseEval.securityScore / 100) * 1.7 -
    (dataConfidencePct / 100) * 0.85;
  const rugProbability = Number(sigmoid(rugLogit).toFixed(3));

  const tokenQualityScore = Number(
    Math.max(
      0,
      Math.min(100, pumpProbability * 62 + (1 - rugProbability) * 28 + socialScore * 0.1),
    ).toFixed(1),
  );

  const calibratedConfidence = Number(
    Math.max(0.2, Math.min(0.97, reliability * (0.65 + Math.abs(pumpProbability - 0.5) * 0.75))).toFixed(3),
  );

  const priceMomentumPrediction: AiIntelligenceEvaluation['priceMomentumPrediction'] =
    pumpProbability >= 0.72 && orderflowImbalance >= 0.25
      ? 'SURGING'
      : pumpProbability >= 0.58 && orderflowImbalance > 0
        ? 'BULLISH'
        : rugProbability >= 0.6 || orderflowImbalance <= -0.2
          ? 'DUMPING'
          : orderflowImbalance < 0.05
            ? 'FADING'
            : 'NEUTRAL';

  const liquidityGrowthPrediction: AiIntelligenceEvaluation['liquidityGrowthPrediction'] =
    liquidityUsd >= 25000 && orderflowImbalance > 0.2
      ? 'EXPANDING'
      : token.lpBurnedPct < 60 || rugProbability >= 0.65
        ? 'DRAINING'
        : 'STABLE';

  const ageMin = token.ageMinutes ?? 4;
  const lifecycleStage: TokenLifecycleStage =
    ageMin <= 1.5 && token.buyCount < 15
      ? 'BIRTH'
      : m5Change >= 8 && m5Change <= 65 && orderflowImbalance >= 0.15
        ? 'EXPANSION'
        : token.devSold || m5Change < -18
          ? 'DISTRIBUTION'
          : ageMin > 90 && token.buyCount < 4
            ? 'EXHAUSTION'
            : 'EARLY_ACCUMULATION';

  const entryTiming: EntryTimingVerdict =
    rugProbability >= 0.55 || lifecycleStage === 'DISTRIBUTION' || lifecycleStage === 'EXHAUSTION'
      ? 'AVOID'
      : m5Change > 95
        ? 'LATE_CHASE'
        : m5Change > 55 && orderflowImbalance < 0.15
          ? 'WAIT_PULLBACK'
          : 'OPTIMAL_NOW';

  const effectiveThreshold = cfg.marketRegimeGuardEnabled
    ? Math.max(cfg.minAiQualityScore, regime.minAiScoreThreshold)
    : cfg.minAiQualityScore;

  const passed =
    !cfg.aiIntelligenceEnabled ||
    (tokenQualityScore >= effectiveThreshold && rugProbability <= 0.62 && entryTiming !== 'AVOID');

  const expectedReturn15mPct = Number(
    ((pumpProbability - 0.45) * 95 - rugProbability * 45).toFixed(1),
  );

  return {
    passed,
    tokenQualityScore,
    pumpProbability,
    rugProbability,
    calibratedConfidence,
    lifecycleStage,
    entryTiming,
    priceMomentumPrediction,
    liquidityGrowthPrediction,
    expectedReturn15mPct,
    smartMoneyScore,
    socialScore,
    narrative,
    dataConfidencePct,
    reason: `AI=${tokenQualityScore}/100 (Min=${effectiveThreshold}) · P(pump)=${Math.round(
      pumpProbability * 100,
    )}% P(rug)=${Math.round(rugProbability * 100)}% · Stage=${lifecycleStage} Timing=${entryTiming}`,
  };
}

export function evaluateAdaptiveEntry(
  token: TokenCandidateInput,
  ai: AiIntelligenceEvaluation,
  evalRes: CandidateEvaluationResult,
  regime: MarketRegimeSnapshot,
  cfg: StrategyConfig,
): AdaptiveEntryEvaluation {
  const liquidityUsd = token.liquidityUsd ?? 24000;
  const uniqueBuyers =
    token.uniqueBuyers ??
    (token.buyCount <= 0 ? 0 : Math.max(1, Math.min(token.buyCount, Math.ceil(token.buyCount * 0.68))));
  const m5Change = token.priceChangeM5Pct ?? 12;
  const imbalance =
    token.buyCount + token.sellCount > 0
      ? (token.buyCount - token.sellCount) / (token.buyCount + token.sellCount)
      : 0;
  const multiTimeframeConfirmed = imbalance >= 0.05 && evalRes.volumeSpikeRatio >= 0.5;

  const earlyMomentumScore = Math.min(
    100,
    Math.max(
      0,
      35 +
        Math.min(25, uniqueBuyers * 2.2) +
        Math.max(-15, imbalance * 30) +
        (m5Change >= 3 && m5Change <= 50 ? 15 : 0) +
        (ai.tokenQualityScore - 50) * 0.4,
    ),
  );
  const breakoutScore = Math.min(
    100,
    Math.max(
      0,
      30 +
        Math.min(25, evalRes.volumeSpikeRatio * 14) +
        (m5Change >= 12 && m5Change <= 90 ? 22 : m5Change > 90 ? 5 : 0) +
        ai.socialScore * 0.25 +
        (multiTimeframeConfirmed ? 10 : -8),
    ),
  );
  const pullbackScore = Math.min(
    100,
    Math.max(
      0,
      28 +
        (m5Change <= -2 && m5Change >= -22 ? 32 : 8) +
        (imbalance > 0 ? 18 : -10) +
        ai.smartMoneyScore * 0.22,
    ),
  );
  const liqInflowScore = Math.min(
    100,
    Math.max(
      0,
      32 +
        Math.min(28, (liquidityUsd / 25_000) * 20) +
        (imbalance > 0.2 ? 18 : 0) +
        ((token.roundTripSpreadPct ?? 3.5) <= 5 ? 16 : 0),
    ),
  );
  const smartMoneyScore = Math.min(
    100,
    Math.max(0, ai.smartMoneyScore * 0.78 + Math.min(18, uniqueBuyers * 0.9)),
  );

  const strategyScores: Record<EntryStrategyId, number> = {
    EARLY_MOMENTUM: Number(earlyMomentumScore.toFixed(1)),
    BREAKOUT: Number(breakoutScore.toFixed(1)),
    PULLBACK: Number(pullbackScore.toFixed(1)),
    LIQUIDITY_INFLOW: Number(liqInflowScore.toFixed(1)),
    SMART_MONEY: Number(smartMoneyScore.toFixed(1)),
  };

  const ranked = (Object.keys(strategyScores) as EntryStrategyId[]).map((strat) => ({
    strat,
    eff: strategyScores[strat] + (strat === regime.recommendedStrategy ? 6 : 0),
  }));
  ranked.sort((a, b) => b.eff - a.eff);
  const selectedStrategy = ranked[0].strat;
  const bestBase = strategyScores[selectedStrategy];

  const entryRankScore = Number(
    Math.max(
      0,
      Math.min(
        100,
        bestBase * 0.55 +
          ai.tokenQualityScore * 0.3 +
          evalRes.securityScore * 0.15 +
          (multiTimeframeConfirmed ? 5 : -6),
      ),
    ).toFixed(1),
  );

  let dynamicThreshold = cfg.minEntryRankScore;
  if (cfg.marketRegimeGuardEnabled) {
    if (regime.regime === 'BEARISH') dynamicThreshold += 8;
    else if (regime.regime === 'HIGH_VOLATILITY') dynamicThreshold += 5;
    else if (regime.regime === 'BULLISH') dynamicThreshold -= 4;
  }
  if (ai.calibratedConfidence < 0.48) dynamicThreshold += 4;
  dynamicThreshold = Number(Math.max(38, Math.min(78, dynamicThreshold)).toFixed(1));

  const estimatedEntrySlippagePct = Number(
    Math.min(12, Math.max(0.5, (token.roundTripSpreadPct ?? 3.2) * 0.45)).toFixed(2),
  );

  const reasons: string[] = [];
  if (cfg.adaptiveEntryEnabled) {
    if (entryRankScore < dynamicThreshold) {
      reasons.push(`EntryRank ${entryRankScore} < DynamicThreshold ${dynamicThreshold}`);
    }
    if (ai.entryTiming === 'LATE_CHASE') {
      reasons.push(`Late-chase blocked (5m +${m5Change.toFixed(1)}%)`);
    }
    if (estimatedEntrySlippagePct > cfg.maxPriceImpactPct) {
      reasons.push(
        `Entry slippage ${estimatedEntrySlippagePct}% > max ${cfg.maxPriceImpactPct}%`,
      );
    }
    if (evalRes.washTradeSuspected) {
      reasons.push('Wash-trade / Sybil cluster flagged');
    }
  }

  return {
    approved: !cfg.adaptiveEntryEnabled || reasons.length === 0,
    selectedStrategy,
    entryRankScore,
    dynamicThreshold,
    multiTimeframeConfirmed,
    estimatedEntrySlippagePct,
    strategyScores,
    reasons:
      reasons.length > 0
        ? reasons
        : [
            `Strategy=${selectedStrategy} (${bestBase}) | Rank=${entryRankScore}>=${dynamicThreshold}`,
          ],
  };
}

export function runWalkForwardBacktestSimulation(
  cfg: StrategyConfig,
  options?: { seed?: number; sampleCount?: number },
): WalkForwardBacktestReport {
  let state = (options?.seed ?? 202607) >>> 0;
  const nextRand = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const totalSamples = Math.max(24, options?.sampleCount ?? 60);
  const strategies: EntryStrategyId[] = [
    'EARLY_MOMENTUM',
    'BREAKOUT',
    'PULLBACK',
    'LIQUIDITY_INFLOW',
    'SMART_MONEY',
  ];

  interface SimRecord {
    strategy: EntryStrategyId;
    aiScore: number;
    secScore: number;
    liquidityUsd: number;
    horizonsPct: number[];
    netPnlSol: number | null;
    feesSol: number;
    slippageCostSol: number;
  }

  const records: SimRecord[] = [];
  const orderSizeSol = Math.max(
    0.05,
    Number((((cfg.accountBalanceSol * (cfg.riskPerTradePct || 1)) / 100) / Math.max(0.1, cfg.hardSlPct / 100)).toFixed(3)),
  );
  const feePerTradeSol = Number((cfg.jitoTipSol * 2 + 0.0004).toFixed(5));

  let rejectedWithData = 0;
  let rejectedPumped = 0;

  for (let i = 0; i < totalSamples; i++) {
    const strat = strategies[i % strategies.length];
    const aiScore = Math.round(36 + nextRand() * 60);
    const secScore = nextRand() > 0.18 ? Math.round(75 + nextRand() * 25) : 40;
    const liquidityUsd = Math.round(6500 + nextRand() * 58000);
    const edge = (aiScore - 48) * 1.15 + (secScore >= 80 ? 12 : -22);
    const r1 = nextRand() * 36 - 14 + edge * 0.35;
    const r2 = r1 + (nextRand() * 52 - 18 + edge * 0.45);
    const r3 = r2 + (nextRand() * 44 - 24);
    const horizonsPct = [r1, r2, r3];

    const passesMinAi = !cfg.aiIntelligenceEnabled || aiScore >= cfg.minAiQualityScore;
    const passesLiq = liquidityUsd >= cfg.minLiquidityUsd;
    const passesSec = secScore >= 70;

    if (!passesMinAi || !passesLiq || !passesSec) {
      rejectedWithData++;
      if (Math.max(...horizonsPct) >= cfg.tp1Pct) rejectedPumped++;
      records.push({
        strategy: strat,
        aiScore,
        secScore,
        liquidityUsd,
        horizonsPct,
        netPnlSol: null,
        feesSol: 0,
        slippageCostSol: 0,
      });
      continue;
    }

    let exitPct = horizonsPct[horizonsPct.length - 1];
    let tp1Done = false;
    let partialLocked = 0;
    let peakPct = 0;
    for (const h of horizonsPct) {
      peakPct = Math.max(peakPct, h);
      if (h <= -Math.abs(cfg.hardSlPct) && !tp1Done) {
        exitPct = -Math.abs(cfg.hardSlPct);
        break;
      }
      if (!tp1Done && h >= cfg.tp1Pct) {
        tp1Done = true;
        partialLocked = cfg.tp1Pct * (cfg.tp1SellSharePct / 100);
      }
      if (tp1Done && h <= peakPct - cfg.trailingCallbackPct) {
        exitPct = partialLocked + h * (1 - cfg.tp1SellSharePct / 100);
        break;
      }
    }

    const liqFactor = Math.min(7, 28_000 / liquidityUsd);
    const slippagePct = 1.1 + liqFactor * 0.55;
    const slippageCostSol = Number((orderSizeSol * (slippagePct / 100)).toFixed(5));
    const netPnlSol = Number((orderSizeSol * (exitPct / 100) - slippageCostSol - feePerTradeSol).toFixed(5));

    records.push({
      strategy: strat,
      aiScore,
      secScore,
      liquidityUsd,
      horizonsPct,
      netPnlSol,
      feesSol: feePerTradeSol,
      slippageCostSol,
    });
  }

  const trades = records.filter((r): r is SimRecord & { netPnlSol: number } => r.netPnlSol !== null);
  const wins = trades.filter((t) => t.netPnlSol >= 0);
  const losses = trades.filter((t) => t.netPnlSol < 0);
  const grossWin = wins.reduce((a, b) => a + b.netPnlSol, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.netPnlSol, 0));
  const netPnlAfterFeesSol = Number(trades.reduce((a, b) => a + b.netPnlSol, 0).toFixed(4));
  const totalFeesSol = Number(trades.reduce((a, b) => a + b.feesSol, 0).toFixed(4));
  const totalSlippageCostSol = Number(trades.reduce((a, b) => a + b.slippageCostSol, 0).toFixed(4));

  const splitIdx = Math.floor(trades.length * 0.65);
  const isTrades = trades.slice(0, splitIdx);
  const oosTrades = trades.slice(splitIdx);
  const isWinRatePct =
    isTrades.length > 0
      ? Number(((isTrades.filter((t) => t.netPnlSol >= 0).length / isTrades.length) * 100).toFixed(1))
      : 0;
  const oosWins = oosTrades.filter((t) => t.netPnlSol >= 0);
  const oosWinRatePct =
    oosTrades.length > 0 ? Number(((oosWins.length / oosTrades.length) * 100).toFixed(1)) : 0;
  const oosGw = oosWins.reduce((a, b) => a + b.netPnlSol, 0);
  const oosGl = Math.abs(oosTrades.filter((t) => t.netPnlSol < 0).reduce((a, b) => a + b.netPnlSol, 0));
  const walkForwardOosProfitFactor =
    oosGl > 0 ? Number((oosGw / oosGl).toFixed(2)) : oosGw > 0 ? 99.99 : 0;

  let bal = cfg.accountBalanceSol;
  let peak = bal;
  let maxDrawdownPct = 0;
  for (const t of trades) {
    bal = Math.max(0.01, bal + t.netPnlSol);
    if (bal > peak) peak = bal;
    const dd = ((peak - bal) / peak) * 100;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  // Deterministic 300-run Monte Carlo bootstrap
  const mcReturns: number[] = [];
  const mcDds: number[] = [];
  if (trades.length > 0) {
    for (let it = 0; it < 300; it++) {
      let mcBal = cfg.accountBalanceSol;
      let mcPeak = mcBal;
      let mcDd = 0;
      for (let step = 0; step < trades.length; step++) {
        const pick = trades[Math.floor(nextRand() * trades.length)];
        mcBal = Math.max(0.01, mcBal + pick.netPnlSol);
        if (mcBal > mcPeak) mcPeak = mcBal;
        const dd = ((mcPeak - mcBal) / mcPeak) * 100;
        if (dd > mcDd) mcDd = dd;
      }
      mcReturns.push(((mcBal - cfg.accountBalanceSol) / cfg.accountBalanceSol) * 100);
      mcDds.push(mcDd);
    }
    mcReturns.sort((a, b) => a - b);
    mcDds.sort((a, b) => a - b);
  }

  const byStrategy = {} as WalkForwardBacktestReport['byStrategy'];
  for (const s of strategies) {
    const st = trades.filter((t) => t.strategy === s);
    const sw = st.filter((t) => t.netPnlSol >= 0).length;
    byStrategy[s] = {
      trades: st.length,
      wins: sw,
      winRatePct: st.length > 0 ? Number(((sw / st.length) * 100).toFixed(1)) : 0,
      netPnlSol: Number(st.reduce((a, b) => a + b.netPnlSol, 0).toFixed(4)),
    };
  }

  return {
    sampleSize: totalSamples,
    totalTrades: trades.length,
    winRatePct: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 9.99 : 0,
    expectancySol: trades.length > 0 ? Number((netPnlAfterFeesSol / trades.length).toFixed(4)) : 0,
    netPnlAfterFeesSol,
    totalFeesSol,
    totalSlippageCostSol,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    inSampleWinRatePct: isWinRatePct,
    walkForwardOosWinRatePct: oosWinRatePct,
    walkForwardOosProfitFactor,
    monteCarloMedianReturnPct: Number((mcReturns[Math.floor(mcReturns.length * 0.5)] ?? 0).toFixed(2)),
    monteCarloP05ReturnPct: Number((mcReturns[Math.floor(mcReturns.length * 0.05)] ?? 0).toFixed(2)),
    monteCarloWorstDdPct: Number((mcDds[Math.floor(mcDds.length * 0.95)] ?? 0).toFixed(2)),
    rejectedPumpedPct:
      rejectedWithData > 0 ? Number(((rejectedPumped / rejectedWithData) * 100).toFixed(1)) : 0,
    byStrategy,
  };
}
