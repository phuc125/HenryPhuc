import { SniperDatabase } from '../analytics/database';
import { AiFeatureWeights, DEFAULT_AI_WEIGHTS } from '../ai/intelligenceEngine';
import { AiModelVersionRecord } from '../core/types';

export interface AccuracyAndDriftReport {
  evaluatedCount: number;
  accuracyPct: number;
  brierScore: number;
  recentAccuracyPct: number;
  driftDetected: boolean;
  driftDeltaPct: number;
  activeVersion: string;
  featureImportance: Array<{ feature: string; weight: number; importancePct: number }>;
}

function sigmoid(x: number): number {
  const c = Math.max(-12, Math.min(12, x));
  return 1 / (1 + Math.exp(-c));
}

/**
 * Module 13: Continuous Learning & Model Drift Monitor
 * - Evaluates Prediction Accuracy & Brier Score calibration on realized outcomes
 * - Detects Model Drift when recent accuracy degrades >= 12% vs baseline
 * - Retrains logistic feature weights on chronological In-Sample split & validates on OOS holdout
 * - ALWAYS saves retrained models as CANDIDATE requiring explicit owner approval (`/ai approve <ver>`)
 */
export class ContinuousLearningEngine {
  constructor(private readonly db: SniperDatabase) {}

  public evaluateAccuracyAndDrift(limit = 250): AccuracyAndDriftReport {
    const active = this.db.getActiveAiModel();
    let activeWeights: AiFeatureWeights = { ...DEFAULT_AI_WEIGHTS };
    if (active) {
      try {
        activeWeights = { ...DEFAULT_AI_WEIGHTS, ...JSON.parse(active.weightsJson) };
      } catch {
        activeWeights = { ...DEFAULT_AI_WEIGHTS };
      }
    }

    const rows = this.db.getEvaluatedAiDecisions(limit);
    const total = rows.length;
    let correct = 0;
    let brierSum = 0;

    for (const r of rows) {
      const predClass = r.predictedPumpProb >= 0.5 ? 1 : 0;
      if (predClass === r.actualWin) correct++;
      brierSum += Math.pow(r.predictedPumpProb - r.actualWin, 2);
    }

    const accuracyPct = total > 0 ? Number(((correct / total) * 100).toFixed(2)) : 0;
    const brierScore = total > 0 ? Number((brierSum / total).toFixed(4)) : 0.25;

    const recentSlice = rows.slice(-25);
    const recentWins = recentSlice.filter(
      (r) => (r.predictedPumpProb >= 0.5 ? 1 : 0) === r.actualWin,
    ).length;
    const recentAccuracyPct =
      recentSlice.length > 0 ? Number(((recentWins / recentSlice.length) * 100).toFixed(2)) : 0;

    const baselineAcc = active?.oosAccuracyPct ?? 64;
    const driftDeltaPct =
      recentSlice.length >= 12 ? Number((baselineAcc - recentAccuracyPct).toFixed(2)) : 0;
    const driftDetected = recentSlice.length >= 12 && driftDeltaPct >= 12;

    const featureKeys = Object.keys(DEFAULT_AI_WEIGHTS).filter(
      (k) => k !== 'intercept',
    ) as Array<keyof Omit<AiFeatureWeights, 'intercept'>>;
    const sumAbs = featureKeys.reduce((acc, k) => acc + Math.abs(activeWeights[k]), 0) || 1;
    const featureImportance = featureKeys
      .map((feature) => ({
        feature,
        weight: Number(activeWeights[feature].toFixed(3)),
        importancePct: Number(((Math.abs(activeWeights[feature]) / sumAbs) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.importancePct - a.importancePct);

    return {
      evaluatedCount: total,
      accuracyPct,
      brierScore,
      recentAccuracyPct,
      driftDetected,
      driftDeltaPct,
      activeVersion: active?.version ?? 'v7.0-baseline',
      featureImportance,
    };
  }

  public retrainCandidateModel(): {
    created: boolean;
    candidate?: AiModelVersionRecord;
    reason: string;
  } {
    const rows = this.db.getEvaluatedAiDecisions(500);
    if (rows.length < 24) {
      return {
        created: false,
        reason: `Cần tối thiểu 24 mẫu AI đã đánh giá thực tế (hiện có ${rows.length}/24).`,
      };
    }

    const split = Math.floor(rows.length * 0.7);
    const trainSet = rows.slice(0, split);
    const oosSet = rows.slice(split);

    const active = this.db.getActiveAiModel();
    const w: AiFeatureWeights = active
      ? { ...DEFAULT_AI_WEIGHTS, ...(JSON.parse(active.weightsJson) as Partial<AiFeatureWeights>) }
      : { ...DEFAULT_AI_WEIGHTS };

    const featureKeys = Object.keys(DEFAULT_AI_WEIGHTS).filter(
      (k) => k !== 'intercept',
    ) as Array<keyof Omit<AiFeatureWeights, 'intercept'>>;

    // Regularized gradient ascent on log-likelihood (L2 = 0.02, lr = 0.06, 45 epochs)
    const lr = 0.06;
    const l2 = 0.02;
    for (let epoch = 0; epoch < 45; epoch++) {
      for (const sample of trainSet) {
        let z = w.intercept;
        for (const k of featureKeys) {
          z += w[k] * (sample.features[k] ?? 0.5);
        }
        const pred = sigmoid(z);
        const err = sample.actualWin - pred;
        w.intercept = Math.max(-3, Math.min(2, w.intercept + lr * err));
        for (const k of featureKeys) {
          const x = sample.features[k] ?? 0.5;
          const next = w[k] + lr * (err * x - l2 * (w[k] - DEFAULT_AI_WEIGHTS[k]));
          w[k] = Number(Math.max(-2.5, Math.min(2.5, next)).toFixed(4));
        }
      }
    }

    const evalSet = (list: typeof rows) => {
      let ok = 0;
      let brier = 0;
      for (const s of list) {
        let z = w.intercept;
        for (const k of featureKeys) z += w[k] * (s.features[k] ?? 0.5);
        const p = sigmoid(z);
        if ((p >= 0.5 ? 1 : 0) === s.actualWin) ok++;
        brier += Math.pow(p - s.actualWin, 2);
      }
      return {
        accPct: list.length > 0 ? Number(((ok / list.length) * 100).toFixed(2)) : 0,
        brier: list.length > 0 ? Number((brier / list.length).toFixed(4)) : 0.25,
      };
    };

    const isEval = evalSet(trainSet);
    const oosEval = evalSet(oosSet);

    const sumAbs = featureKeys.reduce((acc, k) => acc + Math.abs(w[k]), 0) || 1;
    const importance: Record<string, number> = {};
    for (const k of featureKeys) {
      importance[k] = Number((Math.abs(w[k]) / sumAbs).toFixed(4));
    }

    const version = `v7.${Math.floor(Date.now() / 1000).toString().slice(-4)}`;
    const candidate: AiModelVersionRecord = {
      version,
      createdAt: Date.now(),
      sampleSize: rows.length,
      inSampleAccuracyPct: isEval.accPct,
      oosAccuracyPct: oosEval.accPct,
      brierScore: oosEval.brier,
      status: 'CANDIDATE', // Never auto-apply directly to LIVE
      weightsJson: JSON.stringify(w),
      featureImportanceJson: JSON.stringify(importance),
      notes: `Retrained on ${trainSet.length} IS / ${oosSet.length} OOS samples. Awaiting manual approval.`,
    };

    this.db.saveAiModelVersion(candidate);
    return {
      created: true,
      candidate,
      reason: `Đã tạo model ${version} (CANDIDATE) | OOS Acc=${oosEval.accPct}% | Brier=${oosEval.brier}. Dùng /ai approve ${version} để kích hoạt.`,
    };
  }
}
