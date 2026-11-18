import { applyStrategyPreset, StrategyConfig } from './quantEngine';
import type { SnipeOrderSettings } from './sniperTerminal';

export const OTA_BUNDLE_VERSION = '2.2.0-dark-glass-high-pf';
export const OTA_STORAGE_KEY = 'solsniper_ota_hotupdate_v2';

export interface OtaHotUpdateBundle {
  schema: 'solsniper-ota-v1';
  version: string;
  releasedAt: string;
  title: string;
  changelog: string[];
  strategyPatch: Partial<StrategyConfig>;
  sniperDefaults: Partial<SnipeOrderSettings>;
  botFilePatches?: Record<string, string>;
}

export function buildDefaultOtaBundle(
  botFilePatches: Record<string, string> = {},
): OtaHotUpdateBundle {
  const highPfConfig = applyStrategyPreset(
    {
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
      accountBalanceSol: 1.5,
      riskPerTradePct: 2,
      maxDailyLossPct: 4,
      maxWeeklyLossPct: 10,
      profitProtectionPct: 35,
      minAiQualityScore: 68,
      minEntryRankScore: 65,
      maxPriceImpactPct: 3.0,
      slippageBps: 800,
      jitoTipSol: 0.00025,
      maxFeeRatioPct: 2.2,
      minLiquidityUsd: 12_000,
      minUniqueBuyers: 6,
      minBuyCount: 8,
      maxRoundtripSpreadPct: 6.5,
      minLpBurnedPct: 90,
      maxTop10HoldersPct: 28,
      maxDevHoldPct: 5,
      maxBundleSupplyPct: 25,
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
      maxSinglePositionPct: 20,
      maxPortfolioHeatPct: 40,
      rugDrainMissTicks: 5,
      rugDrainLiqRatio: 0.35,
      dynamicJitoTipEnabled: true,
      minVolumeSpikeRatio: 0.7,
      autoRentReclaimEnabled: true,
      autoConsolidateEnabled: true,
      smallCapEdgeMode: true,
      blacklistedCreators: ['RugDev6666666666666666666666666666666666666'],
    },
    'SMALL_CAP_HIGH_PF',
  );

  return {
    schema: 'solsniper-ota-v1',
    version: OTA_BUNDLE_VERSION,
    releasedAt: new Date().toISOString(),
    title: 'Dark Glassmorphism Sniper + Small-Capital High-PF Edge Pack',
    changelog: [
      'Nâng cấp chiến lược SMALL_CAP_HIGH_PF tối ưu Profit Factor cho tài khoản 0.5–5 SOL',
      'Giảm Fee-Drag Jito Tip xuống 0.00025 SOL (trần <= 2.2% lệnh nhỏ) + chặn kèo impact > 3%',
      'TP1 nhanh +30% (chốt 55% vốn), khóa Break-Even điều chỉnh phí +3.5%, Hard SL chặt -12%',
      'Kích hoạt giao diện Dark Glassmorphism Sniper Terminal & Audit Badges',
    ],
    strategyPatch: {
      smallCapEdgeMode: true,
      riskPerTradePct: highPfConfig.riskPerTradePct,
      jitoTipSol: highPfConfig.jitoTipSol,
      maxFeeRatioPct: highPfConfig.maxFeeRatioPct,
      maxPriceImpactPct: highPfConfig.maxPriceImpactPct,
      minAiQualityScore: highPfConfig.minAiQualityScore,
      minLiquidityUsd: highPfConfig.minLiquidityUsd,
      minBuyCount: highPfConfig.minBuyCount,
      minUniqueBuyers: highPfConfig.minUniqueBuyers,
      tp1Pct: highPfConfig.tp1Pct,
      tp1SellSharePct: highPfConfig.tp1SellSharePct,
      tp2Pct: highPfConfig.tp2Pct,
      hardSlPct: highPfConfig.hardSlPct,
      breakevenActivatePct: highPfConfig.breakevenActivatePct,
      trailingActivatePct: highPfConfig.trailingActivatePct,
      trailingCallbackPct: highPfConfig.trailingCallbackPct,
      timeExitMinutes: highPfConfig.timeExitMinutes,
    },
    sniperDefaults: {
      slippagePct: 8,
      priorityFeeSol: 0.00025,
      antiMev: true,
      takeProfitPct: 30,
      stopLossPct: 12,
      smallCapHighPf: true,
    },
    botFilePatches,
  };
}

export function validateOtaHotUpdate(raw: unknown): {
  valid: boolean;
  bundle?: OtaHotUpdateBundle;
  error?: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Tệp OTA không đúng định dạng JSON đối tượng.' };
  }
  const obj = raw as Partial<OtaHotUpdateBundle>;
  if (obj.schema !== 'solsniper-ota-v1') {
    return { valid: false, error: 'Sai schema OTA (yêu cầu solsniper-ota-v1).' };
  }
  if (!obj.version || typeof obj.version !== 'string') {
    return { valid: false, error: 'Thiếu trường version trong tệp hot-update.' };
  }
  if (!obj.strategyPatch || typeof obj.strategyPatch !== 'object') {
    return { valid: false, error: 'Thiếu strategyPatch trong gói hot-update.' };
  }

  // Clamp dangerous bounds so untrusted edits cannot corrupt risk limits
  const safePatch: Partial<StrategyConfig> = { ...obj.strategyPatch };
  if (typeof safePatch.riskPerTradePct === 'number') {
    safePatch.riskPerTradePct = Math.max(0.25, Math.min(5, safePatch.riskPerTradePct));
  }
  if (typeof safePatch.hardSlPct === 'number') {
    safePatch.hardSlPct = Math.max(5, Math.min(50, safePatch.hardSlPct));
  }
  if (typeof safePatch.tp1Pct === 'number') {
    safePatch.tp1Pct = Math.max(10, Math.min(200, safePatch.tp1Pct));
  }

  return {
    valid: true,
    bundle: {
      schema: 'solsniper-ota-v1',
      version: obj.version,
      releasedAt: obj.releasedAt || new Date().toISOString(),
      title: obj.title || 'SolSniper OTA Hot-Update',
      changelog: Array.isArray(obj.changelog) ? obj.changelog.map(String) : [],
      strategyPatch: safePatch,
      sniperDefaults: obj.sniperDefaults ?? {},
      botFilePatches: obj.botFilePatches ?? {},
    },
  };
}

export function loadAppliedOtaState(): {
  version: string | null;
  appliedAt: string | null;
  bundle: OtaHotUpdateBundle | null;
} {
  try {
    const raw = localStorage.getItem(OTA_STORAGE_KEY);
    if (!raw) return { version: null, appliedAt: null, bundle: null };
    const parsed = JSON.parse(raw) as {
      version?: string;
      appliedAt?: string;
      bundle?: OtaHotUpdateBundle;
    };
    return {
      version: parsed.version ?? null,
      appliedAt: parsed.appliedAt ?? null,
      bundle: parsed.bundle ?? null,
    };
  } catch {
    return { version: null, appliedAt: null, bundle: null };
  }
}

export function saveAppliedOtaState(bundle: OtaHotUpdateBundle): {
  version: string;
  appliedAt: string;
} {
  const appliedAt = new Date().toISOString();
  try {
    localStorage.setItem(
      OTA_STORAGE_KEY,
      JSON.stringify({
        version: bundle.version,
        appliedAt,
        bundle,
      }),
    );
  } catch {
    // ignore storage quota errors
  }
  return { version: bundle.version, appliedAt };
}
