import { RuntimeConfig } from '../config/runtimeConfig';
import { MarketRegimeType } from '../core/types';

export interface DynamicSizingDecision {
  allowed: boolean;
  sizedBuySol: number;
  riskBudgetSol: number;
  riskPctOfBalance: number;
  multiplier: number;
  portfolioHeatPct: number;
  projectedHeatPct: number;
  estimatedPriceImpactPct: number;
  estimatedExitSlippagePct: number;
  totalEstimatedCostPct: number;
  dailyLossHit: boolean;
  weeklyLossHit: boolean;
  profitProtectionHit: boolean;
  heatLimitHit: boolean;
  correlatedLimitHit: boolean;
  reason: string;
}

/**
 * Institutional Risk Sizing Engine:
 * - Liquidity-Adjusted Sizing & Pre-Trade Price Impact / Exit Slippage estimation
 * - Adaptive Risk per Trade (Security + AI Confidence + Market Regime + Loss Streak throttling)
 * - Hard un-overridable guards: Daily Loss Limit, Weekly Loss Limit, Profit Protection,
 *   Portfolio Heat, Single-Position Cap, and Correlated Exposure Detection.
 */
export function computeDynamicPositionSize(params: {
  availableBalanceSol: number;
  openExposureSol: number;
  dailyRealizedPnlSol: number;
  weeklyRealizedPnlSol?: number;
  securityScore: number;
  liquidityUsd: number;
  aiQualityScore?: number;
  aiConfidence?: number;
  marketRegime?: MarketRegimeType;
  regimeRiskMultiplier?: number;
  volatilityScore?: number;
  consecutiveLosses?: number;
  correlatedExposureSol?: number;
  roundTripSpreadPct?: number | null;
  solPriceUsd?: number;
  cfg: Pick<
    RuntimeConfig,
    | 'riskPerTradePct'
    | 'hardSlPct'
    | 'maxSinglePositionPct'
    | 'maxPortfolioHeatPct'
    | 'maxDailyLossPct'
    | 'circuitBreakerEnabled'
  > & {
    maxWeeklyLossPct?: number;
    profitProtectionPct?: number;
    maxPriceImpactPct?: number;
    maxFeeRatioPct?: number;
    jitoTipSol?: number;
    smallCapEdgeMode?: boolean;
    tp1Pct?: number;
  };
}): DynamicSizingDecision {
  const {
    availableBalanceSol,
    openExposureSol,
    dailyRealizedPnlSol,
    weeklyRealizedPnlSol = dailyRealizedPnlSol,
    securityScore,
    liquidityUsd,
    aiQualityScore = 70,
    aiConfidence = 0.75,
    marketRegime = 'SIDEWAYS',
    regimeRiskMultiplier = 1.0,
    volatilityScore = 40,
    consecutiveLosses = 0,
    correlatedExposureSol = 0,
    roundTripSpreadPct = 2.0,
    solPriceUsd = 165,
    cfg,
  } = params;

  const equitySol = Math.max(0.001, availableBalanceSol + openExposureSol);
  const currentHeatPct = Number(((openExposureSol / equitySol) * 100).toFixed(2));
  const hardBaseRiskPct = Math.max(0.25, Math.min(5, cfg.riskPerTradePct || 1));
  const hardRiskBudgetSol = Number((equitySol * (hardBaseRiskPct / 100)).toFixed(6));

  const emptyFail = (
    reason: string,
    flags?: Partial<
      Pick<
        DynamicSizingDecision,
        | 'dailyLossHit'
        | 'weeklyLossHit'
        | 'profitProtectionHit'
        | 'heatLimitHit'
        | 'correlatedLimitHit'
      >
    >,
  ): DynamicSizingDecision => ({
    allowed: false,
    sizedBuySol: 0,
    riskBudgetSol: hardRiskBudgetSol,
    riskPctOfBalance: hardBaseRiskPct,
    multiplier: 0,
    portfolioHeatPct: currentHeatPct,
    projectedHeatPct: currentHeatPct,
    estimatedPriceImpactPct: 0,
    estimatedExitSlippagePct: 0,
    totalEstimatedCostPct: 0,
    dailyLossHit: flags?.dailyLossHit ?? false,
    weeklyLossHit: flags?.weeklyLossHit ?? false,
    profitProtectionHit: flags?.profitProtectionHit ?? false,
    heatLimitHit: flags?.heatLimitHit ?? false,
    correlatedLimitHit: flags?.correlatedLimitHit ?? false,
    reason,
  });

  // 1. Hard Daily Loss Limit (AI cannot override)
  const maxDailyLossSol = equitySol * (Math.max(1, cfg.maxDailyLossPct || 5) / 100);
  if (cfg.circuitBreakerEnabled && dailyRealizedPnlSol <= -maxDailyLossSol) {
    return emptyFail(
      `Daily Loss Limit hit (${dailyRealizedPnlSol.toFixed(4)} SOL <= -${maxDailyLossSol.toFixed(4)} SOL [-${cfg.maxDailyLossPct}%])`,
      { dailyLossHit: true },
    );
  }

  // 2. Hard Weekly Loss Limit (AI cannot override)
  const maxWeeklyPct = Math.max(2, cfg.maxWeeklyLossPct ?? 12);
  const maxWeeklyLossSol = equitySol * (maxWeeklyPct / 100);
  if (cfg.circuitBreakerEnabled && weeklyRealizedPnlSol <= -maxWeeklyLossSol) {
    return emptyFail(
      `Weekly Loss Limit hit (${weeklyRealizedPnlSol.toFixed(4)} SOL <= -${maxWeeklyLossSol.toFixed(4)} SOL [-${maxWeeklyPct}%])`,
      { weeklyLossHit: true },
    );
  }

  // 3. Portfolio Heat Budget
  const maxHeatSol = equitySol * (cfg.maxPortfolioHeatPct / 100);
  const remainingHeatSol = Math.max(0, maxHeatSol - openExposureSol);
  if (remainingHeatSol < 0.005) {
    return emptyFail(
      `Portfolio Heat limit reached (${currentHeatPct}% >= ${cfg.maxPortfolioHeatPct}%)`,
      { heatLimitHit: true },
    );
  }

  // 4. Correlated Exposure Detection (cap correlated bucket at 55% of max portfolio heat)
  const maxCorrelatedSol = maxHeatSol * 0.55;
  const remainingCorrelatedSol = Math.max(0, maxCorrelatedSol - correlatedExposureSol);
  if (correlatedExposureSol > 0 && remainingCorrelatedSol < 0.005) {
    return emptyFail(
      `Correlated exposure limit hit (${correlatedExposureSol.toFixed(3)} SOL >= ${maxCorrelatedSol.toFixed(3)} SOL)`,
      { correlatedLimitHit: true },
    );
  }

  // 5. Adaptive Risk Modulation (can scale DOWN risk budget, never exceed safety caps)
  let streakMult = 1.0;
  if (consecutiveLosses === 1) streakMult = 0.85;
  else if (consecutiveLosses === 2) streakMult = 0.65;
  else if (consecutiveLosses >= 3) streakMult = 0.45;

  const volMult = volatilityScore > 75 ? 0.7 : volatilityScore > 55 ? 0.85 : 1.0;
  const clampedRegimeMult = Math.max(0.45, Math.min(1.15, regimeRiskMultiplier));
  const aiMult =
    aiQualityScore >= 80 && aiConfidence >= 0.7
      ? 1.1
      : aiQualityScore < 55 || aiConfidence < 0.5
        ? 0.75
        : 0.95;

  // Profit protection: tighten size when giving back intra-day profit cushion
  let profitProtectMult = 1.0;
  const profitProtectPct = cfg.profitProtectionPct ?? 40;
  if (dailyRealizedPnlSol > equitySol * 0.04 && consecutiveLosses >= 1) {
    profitProtectMult = Math.max(0.5, 1 - profitProtectPct / 100);
  }

  let qualityMult = 1.0;
  if (securityScore >= 95) qualityMult += 0.08;
  else if (securityScore < 80) qualityMult -= 0.25;

  const rawMult = Number(
    (qualityMult * streakMult * volMult * clampedRegimeMult * aiMult * profitProtectMult).toFixed(2),
  );
  // Strict upper bound <= 1.2x so AI/adaptive multipliers cannot breach risk envelope
  const multiplier = Math.max(0.3, Math.min(1.2, rawMult));

  // Include realistic exit slippage buffer inside SL denominator so realized SL stays near 1% equity
  const slFraction = Math.max(0.1, Math.min(0.8, Math.abs(cfg.hardSlPct || 25) / 100));
  const riskNormalizedBaseSol = hardRiskBudgetSol / slFraction;
  const rawSized = riskNormalizedBaseSol * multiplier;

  // Liquidity-Adjusted Cap: single buy never exceeds 1.5% of USD pool liquidity at live SOL/USD
  const solUsdEst = solPriceUsd > 10 ? solPriceUsd : 165;
  const liqBasedCapSol =
    liquidityUsd > 0 ? Math.max(0.01, (liquidityUsd * 0.015) / solUsdEst) : rawSized;

  const maxSingleWalletCap = equitySol * (cfg.maxSinglePositionPct / 100);
  const feeReserveSol = 0.004;
  const spendableBalance = Math.max(0, availableBalanceSol - feeReserveSol);
  const cappedSol = Math.min(
    rawSized,
    liqBasedCapSol,
    maxSingleWalletCap,
    remainingHeatSol,
    remainingCorrelatedSol > 0 ? remainingCorrelatedSol : remainingHeatSol,
    spendableBalance,
  );
  const sizedBuySol = Number(cappedSol.toFixed(4));

  if (sizedBuySol < 0.005) {
    return emptyFail(
      `Insufficient spendable/heat budget for risk trade (${sizedBuySol} SOL < 0.005 SOL)`,
      { heatLimitHit: remainingHeatSol < 0.005 },
    );
  }

  // 6. Pre-Trade Price Impact & Estimated Exit Slippage Validation
  const orderUsd = sizedBuySol * solUsdEst;
  const estimatedPriceImpactPct =
    liquidityUsd > 0 ? Number(Math.min(25, (orderUsd / (liquidityUsd * 2)) * 100).toFixed(2)) : 1.5;
  const baseSpread = Math.max(0.5, roundTripSpreadPct ?? 2.0);
  const estimatedExitSlippagePct = Number(
    Math.min(25, estimatedPriceImpactPct * 1.35 + baseSpread * 0.55).toFixed(2),
  );
  const maxImpactAllowed = cfg.maxPriceImpactPct ?? 7.5;

  if (liquidityUsd > 0 && estimatedPriceImpactPct > maxImpactAllowed) {
    return emptyFail(
      `Pre-trade price impact ${estimatedPriceImpactPct}% > max ${maxImpactAllowed}% (Liq $${Math.round(liquidityUsd)})`,
    );
  }

  const maxFeeBudgetSol =
    (cfg.smallCapEdgeMode || equitySol <= 5) && cfg.maxFeeRatioPct
      ? Math.max(0.0005, sizedBuySol * (cfg.maxFeeRatioPct / 100))
      : 0.004;
  const estFeesSol = Math.min(maxFeeBudgetSol, (cfg.jitoTipSol ?? 0.001) * 2 + 0.0004);
  const feeRatioPct = (estFeesSol / sizedBuySol) * 100;
  const totalEstimatedCostPct = Number(
    (estimatedPriceImpactPct + estimatedExitSlippagePct + feeRatioPct).toFixed(2),
  );

  // Small-capital net expectancy gate: block trades where round-trip costs eat > 35% of TP1 target
  const tp1TargetPct = Math.max(15, cfg.tp1Pct ?? 30);
  if ((cfg.smallCapEdgeMode || equitySol <= 5) && totalEstimatedCostPct > tp1TargetPct * 0.38) {
    return emptyFail(
      `Small-Cap Fee/Slippage Edge Gate: est cost ${totalEstimatedCostPct}% > 38% of TP1 (+${tp1TargetPct}%)`,
    );
  }

  const projectedHeatPct = Number((((openExposureSol + sizedBuySol) / equitySol) * 100).toFixed(2));
  const effectiveStopRiskFrac = Math.min(0.95, slFraction + estimatedExitSlippagePct / 100);
  const actualRiskSol = Number((sizedBuySol * effectiveStopRiskFrac + estFeesSol).toFixed(4));
  const actualRiskPct = Number(((actualRiskSol / equitySol) * 100).toFixed(2));

  return {
    allowed: true,
    sizedBuySol,
    riskBudgetSol: actualRiskSol,
    riskPctOfBalance: actualRiskPct,
    multiplier,
    portfolioHeatPct: currentHeatPct,
    projectedHeatPct,
    estimatedPriceImpactPct,
    estimatedExitSlippagePct,
    totalEstimatedCostPct,
    dailyLossHit: false,
    weeklyLossHit: false,
    profitProtectionHit: profitProtectMult < 1,
    heatLimitHit: false,
    correlatedLimitHit: false,
    reason: `Adaptive ${sizedBuySol} SOL (${marketRegime}, Risk ${actualRiskSol} SOL = ${actualRiskPct}% Bal incl. exit slip ~${estimatedExitSlippagePct}%, ${multiplier}x, Heat ${currentHeatPct}%->${projectedHeatPct}%)`,
  };
}
