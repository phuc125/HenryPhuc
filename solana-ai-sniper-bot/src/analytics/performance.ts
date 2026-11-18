import { SniperDatabase } from '../analytics/database';
import { PnlSummary } from '../core/types';

export interface ComprehensivePerformanceReport {
  paperSummary: PnlSummary;
  liveSummary: PnlSummary;
  strategyBreakdown: Array<{
    strategy: string;
    regime: string;
    trades: number;
    wins: number;
    winRatePct: number;
    netPnlSol: number;
    avgSlippagePct: number;
  }>;
  executionStats: {
    totalTrades: number;
    reconciledRatePct: number;
    avgLatencyMs: number;
    avgSlippageDiffPct: number;
    totalFeesSol: number;
  };
  rejectedCounterfactuals: {
    totalSnapshots: number;
    boughtCount: number;
    rejectedCount: number;
    rejectedWith15mOutcome: number;
    rejectedMissedPumpsPct: number;
    rejectedSavedRugsPct: number;
  };
}

/**
 * Module 9b: Institutional Performance Analytics Engine
 * Combines Paper vs Live comparison, Net PnL after Fees, Expectancy,
 * Profit Factor, Execution Latency/Slippage telemetry, and Rejected Token Counterfactuals.
 */
export class PerformanceAnalyticsEngine {
  constructor(private readonly db: SniperDatabase) {}

  public buildFullReport(currentLiveBalanceSol?: number): ComprehensivePerformanceReport {
    const paperSummary = this.db.getPnlSummary('PAPER');
    const liveSummary = this.db.getPnlSummary('LIVE', currentLiveBalanceSol);
    const strategyBreakdown = this.db.listStrategyPerformance();

    const recentTrades = this.db.listRecentTrades('ALL', 300);
    const totalTrades = recentTrades.length;
    const reconciledCount = recentTrades.filter((t) => t.reconciled).length;
    const latencies = recentTrades.map((t) => t.latencyMs ?? 0).filter((l) => l > 0);
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;
    const avgSlippageDiffPct =
      totalTrades > 0
        ? Number(
            (
              recentTrades.reduce((a, b) => a + Math.abs(b.slippageDiffPct ?? 0), 0) / totalTrades
            ).toFixed(2),
          )
        : 0;
    const totalFeesSol = Number(
      recentTrades.reduce((a, b) => a + b.feeSol, 0).toFixed(4),
    );

    const snapshots = this.db.listRecentTokenSnapshots(400);
    const boughtCount = snapshots.filter((s) => s.actionTaken === 'BOUGHT').length;
    const rejected = snapshots.filter((s) => s.actionTaken === 'REJECTED');
    const rejWithOutcome = rejected.filter(
      (s) => s.priceSolAtDiscovery > 0 && (s.price15mSol ?? s.price5mSol ?? 0) > 0,
    );

    let missedPumps = 0;
    let savedRugs = 0;
    for (const s of rejWithOutcome) {
      const targetPrice = s.price15mSol ?? s.price5mSol ?? s.priceSolAtDiscovery;
      const pct = ((targetPrice - s.priceSolAtDiscovery) / s.priceSolAtDiscovery) * 100;
      if (pct >= 30) missedPumps++;
      if (pct <= -25) savedRugs++;
    }

    return {
      paperSummary,
      liveSummary,
      strategyBreakdown,
      executionStats: {
        totalTrades,
        reconciledRatePct:
          totalTrades > 0 ? Number(((reconciledCount / totalTrades) * 100).toFixed(1)) : 0,
        avgLatencyMs,
        avgSlippageDiffPct,
        totalFeesSol,
      },
      rejectedCounterfactuals: {
        totalSnapshots: snapshots.length,
        boughtCount,
        rejectedCount: rejected.length,
        rejectedWith15mOutcome: rejWithOutcome.length,
        rejectedMissedPumpsPct:
          rejWithOutcome.length > 0
            ? Number(((missedPumps / rejWithOutcome.length) * 100).toFixed(1))
            : 0,
        rejectedSavedRugsPct:
          rejWithOutcome.length > 0
            ? Number(((savedRugs / rejWithOutcome.length) * 100).toFixed(1))
            : 0,
      },
    };
  }
}
