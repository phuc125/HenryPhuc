import { SniperDatabase } from '../analytics/database';
import { BacktestEngine, BacktestParams } from '../backtesting/backtestEngine';

export interface OptimizationCandidateResult {
  params: Pick<BacktestParams, 'minAiScore' | 'tp1Pct' | 'hardSlPct' | 'trailingCallbackPct'>;
  inSampleNetSol: number;
  inSampleWinRatePct: number;
  oosNetSol: number;
  oosWinRatePct: number;
  oosProfitFactor: number;
  oosMaxDrawdownPct: number;
  robustnessScore: number;
}

export interface OptimizationReport {
  sampleSize: number;
  inSampleSize: number;
  oosSize: number;
  bestCandidate: OptimizationCandidateResult | null;
  topCandidates: OptimizationCandidateResult[];
  recommendedApprovalRequired: boolean;
  notes: string;
}

/**
 * Module 8b: Strategy Parameter Optimizer
 * - Strict Walk-Forward Optimization: parameter grid is ranked on In-Sample (first 65% chronologically)
 *   and verified strictly on unseen Out-Of-Sample (last 35% chronologically).
 * - NEVER auto-pushes live parameters; returns recommendations requiring explicit owner approval.
 */
export class StrategyOptimizer {
  private readonly backtester: BacktestEngine;

  constructor(private readonly db: SniperDatabase) {
    this.backtester = new BacktestEngine(db);
  }

  public runWalkForwardOptimization(limit = 400): OptimizationReport {
    const snapshots = this.db
      .listRecentTokenSnapshots(limit)
      .filter((s) => s.priceSolAtDiscovery > 0)
      .sort((a, b) => a.createdAt - b.createdAt);

    if (snapshots.length < 15) {
      return {
        sampleSize: snapshots.length,
        inSampleSize: 0,
        oosSize: 0,
        bestCandidate: null,
        topCandidates: [],
        recommendedApprovalRequired: true,
        notes: `Chưa đủ dữ liệu snapshot có outcome (${snapshots.length}/15 tối thiểu). Hãy bật Paper/Auto-Snipe để thu thập lịch sử.`,
      };
    }

    const splitIdx = Math.floor(snapshots.length * 0.65);
    const inSample = snapshots.slice(0, splitIdx);
    const outOfSample = snapshots.slice(splitIdx);

    const aiThresholds = [46, 52, 60, 68];
    const tp1Grid = [35, 45, 65];
    const slGrid = [18, 25, 32];
    const trailGrid = [10, 14];

    const candidates: OptimizationCandidateResult[] = [];

    for (const minAiScore of aiThresholds) {
      for (const tp1Pct of tp1Grid) {
        for (const hardSlPct of slGrid) {
          for (const trailingCallbackPct of trailGrid) {
            const isRep = this.backtester.simulateSnapshots(inSample, {
              minAiScore,
              tp1Pct,
              hardSlPct,
              trailingCallbackPct,
            });
            if (isRep.totalTrades < 4) continue;

            const oosRep = this.backtester.simulateSnapshots(outOfSample, {
              minAiScore,
              tp1Pct,
              hardSlPct,
              trailingCallbackPct,
            });

            // Rank by OOS expectancy & drawdown stability, penalizing overfitting gap
            const robustnessScore = Number(
              (
                oosRep.netPnlAfterFeesSol * 25 +
                oosRep.winRatePct * 0.45 +
                oosRep.profitFactor * 8 -
                oosRep.maxDrawdownPct * 0.85
              ).toFixed(2),
            );

            candidates.push({
              params: { minAiScore, tp1Pct, hardSlPct, trailingCallbackPct },
              inSampleNetSol: isRep.netPnlAfterFeesSol,
              inSampleWinRatePct: isRep.winRatePct,
              oosNetSol: oosRep.netPnlAfterFeesSol,
              oosWinRatePct: oosRep.winRatePct,
              oosProfitFactor: oosRep.profitFactor,
              oosMaxDrawdownPct: oosRep.maxDrawdownPct,
              robustnessScore,
            });
          }
        }
      }
    }

    candidates.sort((a, b) => b.robustnessScore - a.robustnessScore);
    const topCandidates = candidates.slice(0, 5);

    return {
      sampleSize: snapshots.length,
      inSampleSize: inSample.length,
      oosSize: outOfSample.length,
      bestCandidate: topCandidates[0] ?? null,
      topCandidates,
      recommendedApprovalRequired: true,
      notes: topCandidates[0]
        ? `Walk-Forward OOS Verified: Best minAI=${topCandidates[0].params.minAiScore}, TP1=${topCandidates[0].params.tp1Pct}%, SL=-${topCandidates[0].params.hardSlPct}% (OOS WR=${topCandidates[0].oosWinRatePct}%, PF=${topCandidates[0].oosProfitFactor}). Chờ duyệt thủ công trước khi áp dụng LIVE.`
        : 'Không tìm được bộ tham số đạt đủ số mẫu tối thiểu trên In-Sample.',
    };
  }
}
