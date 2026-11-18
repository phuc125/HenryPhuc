import { EventEmitter } from 'events';
import { SniperDatabase } from '../analytics/database';
import { SmartExecutionRouter } from '../execution/router';
import { ContinuousLearningEngine } from '../learning/continuousLearning';
import { MarketRegimeDetector } from '../market/regimeDetector';

export interface AgentHealthStatus {
  name: string;
  intervalMs: number;
  lastRunAt: number | null;
  runsCount: number;
  lastSummary: string;
  healthy: boolean;
}

/**
 * Module 10 (II): Autonomous AI Agents Coordinator
 * Runs decoupled periodic intelligence agents:
 * 1. MarketRegimeAgent: keeps macro SOL & memecoin regime updated every 45s
 * 2. HorizonCollectorAgent: updates 1m/5m/15m/1h/24h outcome prices for bought & rejected snapshots + evaluates pending AI predictions
 * 3. DriftMonitorAgent: checks AI prediction Brier calibration & alerts on model drift (never auto-pushes to LIVE)
 */
export class AgentCoordinator extends EventEmitter {
  private regimeTimer: NodeJS.Timeout | null = null;
  private horizonTimer: NodeJS.Timeout | null = null;
  private driftTimer: NodeJS.Timeout | null = null;

  private readonly statuses: Record<string, AgentHealthStatus> = {
    MarketRegimeAgent: {
      name: 'MarketRegimeAgent',
      intervalMs: 45_000,
      lastRunAt: null,
      runsCount: 0,
      lastSummary: 'Pending first cycle',
      healthy: true,
    },
    HorizonCollectorAgent: {
      name: 'HorizonCollectorAgent',
      intervalMs: 60_000,
      lastRunAt: null,
      runsCount: 0,
      lastSummary: 'Pending first cycle',
      healthy: true,
    },
    DriftMonitorAgent: {
      name: 'DriftMonitorAgent',
      intervalMs: 300_000,
      lastRunAt: null,
      runsCount: 0,
      lastSummary: 'Pending first cycle',
      healthy: true,
    },
  };

  constructor(
    private readonly db: SniperDatabase,
    private readonly router: SmartExecutionRouter,
    private readonly regimeDetector: MarketRegimeDetector,
    private readonly learningEngine: ContinuousLearningEngine,
    private readonly continuousLearningEnabled = true,
  ) {
    super();
  }

  public start(): void {
    if (this.regimeTimer) return;

    void this.runRegimeCycle();
    this.regimeTimer = setInterval(() => void this.runRegimeCycle(), 45_000);
    this.horizonTimer = setInterval(() => void this.runHorizonCycle(), 60_000);
    this.driftTimer = setInterval(() => void this.runDriftCycle(), 300_000);
  }

  public stop(): void {
    if (this.regimeTimer) clearInterval(this.regimeTimer);
    if (this.horizonTimer) clearInterval(this.horizonTimer);
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.regimeTimer = null;
    this.horizonTimer = null;
    this.driftTimer = null;
  }

  public getAgentStatuses(): AgentHealthStatus[] {
    return Object.values(this.statuses).map((s) => ({ ...s }));
  }

  private async runRegimeCycle(): Promise<void> {
    try {
      const snap = await this.regimeDetector.refreshRegime(true);
      const st = this.statuses.MarketRegimeAgent;
      st.lastRunAt = Date.now();
      st.runsCount++;
      st.lastSummary = `${snap.regime} (SOL $${snap.solPriceUsd}, Strat=${snap.recommendedStrategy})`;
      st.healthy = true;
    } catch (err) {
      this.statuses.MarketRegimeAgent.healthy = false;
      this.statuses.MarketRegimeAgent.lastSummary = `Error: ${err instanceof Error ? err.message : 'Unknown'}`;
    }
  }

  private async runHorizonCycle(): Promise<void> {
    try {
      const pending = this.db.listPendingHorizonSnapshots(16);
      const now = Date.now();
      let updated = 0;

      for (const snap of pending) {
        if (!snap.id || snap.priceSolAtDiscovery <= 0) continue;
        const ageMin = (now - snap.createdAt) / 60_000;
        const need1m = ageMin >= 1 && snap.price1mSol === null;
        const need5m = ageMin >= 5 && snap.price5mSol === null;
        const need15m = ageMin >= 15 && snap.price15mSol === null;
        const need1h = ageMin >= 60 && snap.price1hSol === null;
        const need24h = ageMin >= 1440 && snap.price24hSol === null;

        if (!need1m && !need5m && !need15m && !need1h && !need24h) continue;

        const livePrice = await this.router.fetchLiveTokenPriceInSol(snap.mint);
        if (!livePrice || livePrice <= 0) continue;

        const patch: Parameters<SniperDatabase['updateTokenSnapshotHorizon']>[1] = {};
        if (need1m) patch.price1mSol = livePrice;
        if (need5m) patch.price5mSol = livePrice;
        if (need15m) {
          patch.price15mSol = livePrice;
          const ret15 = ((livePrice - snap.priceSolAtDiscovery) / snap.priceSolAtDiscovery) * 100;
          patch.realizedPnlPct = Number(ret15.toFixed(2));
          this.db.evaluatePendingAiDecisions(snap.mint, Number(ret15.toFixed(2)));
        }
        if (need1h) patch.price1hSol = livePrice;
        if (need24h) patch.price24hSol = livePrice;

        this.db.updateTokenSnapshotHorizon(snap.id, patch);
        updated++;
      }

      const st = this.statuses.HorizonCollectorAgent;
      st.lastRunAt = now;
      st.runsCount++;
      st.lastSummary = `Checked ${pending.length} snapshots, updated ${updated} outcomes`;
      st.healthy = true;
    } catch (err) {
      this.statuses.HorizonCollectorAgent.healthy = false;
      this.statuses.HorizonCollectorAgent.lastSummary = `Error: ${err instanceof Error ? err.message : 'Unknown'}`;
    }
  }

  private async runDriftCycle(): Promise<void> {
    if (!this.continuousLearningEnabled) return;
    try {
      const report = this.learningEngine.evaluateAccuracyAndDrift();
      const st = this.statuses.DriftMonitorAgent;
      st.lastRunAt = Date.now();
      st.runsCount++;
      st.lastSummary = `Eval=${report.evaluatedCount} | Acc=${report.accuracyPct}% | Brier=${report.brierScore}${
        report.driftDetected ? ' | ⚠️ DRIFT' : ''
      }`;
      st.healthy = true;

      if (report.driftDetected) {
        const retrained = this.learningEngine.retrainCandidateModel();
        this.emit('model_drift', { report, retrained });
      }
    } catch (err) {
      this.statuses.DriftMonitorAgent.healthy = false;
      this.statuses.DriftMonitorAgent.lastSummary = `Error: ${err instanceof Error ? err.message : 'Unknown'}`;
    }
  }
}
