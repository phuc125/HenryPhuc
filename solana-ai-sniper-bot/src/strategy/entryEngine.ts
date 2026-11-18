import { RuntimeConfig } from '../config/runtimeConfig';
import {
  AdaptiveEntryDecision,
  AiPredictionResult,
  AntiRugReport,
  EntryStrategyId,
  MarketRegimeSnapshot,
  MarketSnapshot,
  OrderflowResult,
  SmartMoneyAnalysis,
  SocialIntelligenceResult,
} from '../core/types';

/**
 * Module 5: Adaptive Entry Engine
 * - Evaluates 5 distinct strategies: EARLY_MOMENTUM, BREAKOUT, PULLBACK, LIQUIDITY_INFLOW, SMART_MONEY
 * - Performs Multi-Timeframe confirmation (1m / 5m / 15m orderflow + SOL macro alignment)
 * - Adapts entry threshold dynamically to Market Regime & AI Confidence
 * - Enforces pre-entry slippage & roundtrip checks before approving execution
 */
export class AdaptiveEntryEngine {
  public evaluateEntry(params: {
    audit: AntiRugReport;
    flow: OrderflowResult;
    smartMoney: SmartMoneyAnalysis;
    social: SocialIntelligenceResult;
    ai: AiPredictionResult;
    regime: MarketRegimeSnapshot;
    snapshot: MarketSnapshot;
    liquidityUsd: number;
    h1PriceChangePct?: number;
    cfg: RuntimeConfig;
  }): AdaptiveEntryDecision {
    const {
      audit,
      flow,
      smartMoney,
      social,
      ai,
      regime,
      snapshot,
      liquidityUsd,
      h1PriceChangePct = 0,
      cfg,
    } = params;

    const tfs = flow.timeframes ?? [];
    const tf1m = tfs.find((t) => t.windowLabel === '1m');
    const tf5m = tfs.find((t) => t.windowLabel === '5m');
    const tf15m = tfs.find((t) => t.windowLabel === '15m');

    const m5Change = flow.priceChangeM5Pct ?? 0;
    const multiTimeframeConfirmed =
      (tf1m ? tf1m.imbalanceRatio >= -0.05 : flow.buyToSellRatio >= 1.0) &&
      (tf5m ? tf5m.imbalanceRatio >= 0.05 : flow.orderflowImbalance >= 0.05) &&
      (tf15m ? tf15m.volumeDeltaSol >= -0.2 : true);

    // 1. EARLY_MOMENTUM: fast buyer acceleration + positive imbalance on early pools
    const earlyMomentumScore = Math.min(
      100,
      Math.max(
        0,
        35 +
          Math.min(25, flow.uniqueBuyers * 2.2) +
          Math.max(-15, flow.orderflowImbalance * 30) +
          (m5Change >= 3 && m5Change <= 50 ? 15 : 0) +
          (ai.tokenQualityScore - 50) * 0.4,
      ),
    );

    // 2. BREAKOUT: volume spike + surging 5m momentum + high social/narrative confirmation
    const breakoutScore = Math.min(
      100,
      Math.max(
        0,
        30 +
          Math.min(25, (flow.volumeSpikeRatio ?? 1) * 14) +
          (m5Change >= 12 && m5Change <= 90 ? 22 : m5Change > 90 ? 5 : 0) +
          social.narrativeGrowthScore * 0.25 +
          (multiTimeframeConfirmed ? 10 : -8),
      ),
    );

    // 3. PULLBACK: strong 1h trend with temporary 5m dip while buyers still hold CVD positive
    const pullbackScore = Math.min(
      100,
      Math.max(
        0,
        28 +
          (h1PriceChangePct >= 20 && m5Change <= -2 && m5Change >= -22 ? 36 : 0) +
          (flow.cvdSol > 0 ? 18 : -10) +
          smartMoney.smartMoneyScore * 0.22,
      ),
    );

    // 4. LIQUIDITY_INFLOW: deep USD liquidity + high turnover + low spread
    const liqInflowScore = Math.min(
      100,
      Math.max(
        0,
        32 +
          Math.min(28, (liquidityUsd / 25_000) * 20) +
          (flow.netSolInflow > 0.8 ? 20 : 0) +
          (snapshot.roundTripLossPct !== null && snapshot.roundTripLossPct <= 5 ? 16 : 0),
      ),
    );

    // 5. SMART_MONEY: whale & alpha wallets net accumulating with low sybil/insider dump risk
    const smartMoneyStratScore = Math.min(
      100,
      Math.max(
        0,
        smartMoney.smartMoneyScore * 0.72 +
          Math.min(22, smartMoney.smartBuyersCount * 8 + smartMoney.whaleEntriesCount * 5) -
          (smartMoney.insiderAlert ? 22 : 0),
      ),
    );

    const strategyScores: Record<EntryStrategyId, number> = {
      EARLY_MOMENTUM: Number(earlyMomentumScore.toFixed(1)),
      BREAKOUT: Number(breakoutScore.toFixed(1)),
      PULLBACK: Number(pullbackScore.toFixed(1)),
      LIQUIDITY_INFLOW: Number(liqInflowScore.toFixed(1)),
      SMART_MONEY: Number(smartMoneyStratScore.toFixed(1)),
    };

    // Give slight bonus (+6) to the macro regime's recommended strategy
    const entries = (Object.keys(strategyScores) as EntryStrategyId[]).map((strat) => ({
      strat,
      effective: strategyScores[strat] + (strat === regime.recommendedStrategy ? 6 : 0),
    }));
    entries.sort((a, b) => b.effective - a.effective);
    const selectedStrategy = entries[0].strat;
    const baseBestScore = strategyScores[selectedStrategy];

    const mtfBonus = multiTimeframeConfirmed ? 5 : -6;
    const entryRankScore = Number(
      Math.max(
        0,
        Math.min(
          100,
          baseBestScore * 0.55 + ai.tokenQualityScore * 0.30 + audit.securityScore * 0.15 + mtfBonus,
        ),
      ).toFixed(1),
    );

    // Dynamic Threshold: higher in BEARISH/HIGH_VOLATILITY, lower in clean BULLISH regime with high AI confidence
    let dynamicThreshold = cfg.minEntryRankScore;
    if (cfg.marketRegimeGuardEnabled) {
      if (regime.regime === 'BEARISH') dynamicThreshold += 8;
      else if (regime.regime === 'HIGH_VOLATILITY') dynamicThreshold += 5;
      else if (regime.regime === 'BULLISH') dynamicThreshold -= 4;
    }
    if (ai.calibratedConfidence < 0.48) {
      dynamicThreshold += 4;
    }
    dynamicThreshold = Number(Math.max(38, Math.min(78, dynamicThreshold)).toFixed(1));

    const estimatedEntrySlippagePct = Number(
      (
        snapshot.buyPriceImpactPct ??
        Math.min(12, Math.max(0.5, (snapshot.roundTripLossPct ?? 3.0) * 0.45))
      ).toFixed(2),
    );

    const reasons: string[] = [];
    if (cfg.adaptiveEntryEnabled) {
      if (entryRankScore < dynamicThreshold) {
        reasons.push(`EntryRank ${entryRankScore} < DynamicThreshold ${dynamicThreshold}`);
      }
      if (ai.entryTiming === 'LATE_CHASE') {
        reasons.push(`Late-chase warning (+${m5Change.toFixed(1)}% in 5m)`);
      }
      if (estimatedEntrySlippagePct > cfg.maxPriceImpactPct) {
        reasons.push(
          `Est entry slippage ${estimatedEntrySlippagePct}% > max ${cfg.maxPriceImpactPct}%`,
        );
      }
      if (flow.sybilSuspected || smartMoney.coordinatedClusterDetected) {
        reasons.push('Coordinated Sybil cluster detected');
      }
    }

    const approved = !cfg.adaptiveEntryEnabled || reasons.length === 0;
    const urgency: AdaptiveEntryDecision['urgency'] =
      entryRankScore >= 78 && audit.securityScore >= 90 && ai.pumpProbability >= 0.72
        ? 'HIGH_CONVICTION'
        : 'NORMAL';

    return {
      approved,
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
              `Strategy=${selectedStrategy} (${baseBestScore}) | Rank=${entryRankScore}>=${dynamicThreshold} | MTF=${multiTimeframeConfirmed ? 'OK' : 'WARN'}`,
            ],
      urgency,
    };
  }
}
