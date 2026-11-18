import fs from 'fs';
import path from 'path';
import { DiscoveryMode } from '../core/types';
import { EnvConfig, TradingMode } from './env';

const CURRENT_CONFIG_VERSION = 8;

export type StrategyPresetId =
  | 'MAX_THROUGHPUT'
  | 'BALANCED'
  | 'STRICT_SAFE'
  | 'SMALL_CAP_HIGH_PF';

export interface RuntimeConfig {
  configVersion: number;
  tradingMode: TradingMode;
  discoveryMode: DiscoveryMode;
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
  aiIntelligenceEnabled: boolean;
  smartMoneyFilterEnabled: boolean;
  marketRegimeGuardEnabled: boolean;
  adaptiveEntryEnabled: boolean;
  socialIntelligenceEnabled: boolean;
  continuousLearningEnabled: boolean;
  snipePumpCreate: boolean;
  observationDelayMs: number;
  minLiquidityUsd: number;
  minUniqueBuyers: number;
  minBuyCount: number;
  maxRoundtripSpreadPct: number;
  maxFeeRatioPct: number;
  entryCooldownMs: number;
  maxConsecutiveLosses: number;
  riskPerTradePct: number;
  slippageBps: number;
  jitoTipSol: number;
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
  maxOpenPositions: number;
  maxSinglePositionPct: number;
  maxPortfolioHeatPct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  profitProtectionPct: number;
  rugDrainMissTicks: number;
  rugDrainLiqRatio: number;
  dynamicJitoTipEnabled: boolean;
  minVolumeSpikeRatio: number;
  minAiQualityScore: number;
  minEntryRankScore: number;
  maxPriceImpactPct: number;
  autoRentReclaimEnabled: boolean;
  autoConsolidateEnabled: boolean;
  coldWalletAddress: string;
  consolidateThresholdSol: number;
  consolidateKeepSol: number;
  wifiOnlyMode: boolean;
  lowData4gMode: boolean;
  networkInterfaceType: 'WIFI' | 'CELLULAR_4G' | 'AUTO';
  smallCapEdgeMode?: boolean;
}

export type ToggleableConfigKey =
  | 'autoSnipeEnabled'
  | 'trailingStopEnabled'
  | 'trailingTpEnabled'
  | 'orderflowFilterEnabled'
  | 'washTradeGuardEnabled'
  | 'momentumFilterEnabled'
  | 'honeypotSimEnabled'
  | 'lpLockCheckEnabled'
  | 'antiBundleCheckEnabled'
  | 'spreadGuardEnabled'
  | 'cooldownGuardEnabled'
  | 'breakevenLockEnabled'
  | 'earlyMomentumCutEnabled'
  | 'timeExitEnabled'
  | 'circuitBreakerEnabled'
  | 'autoDeleteEntryMsgEnabled'
  | 'aiIntelligenceEnabled'
  | 'smartMoneyFilterEnabled'
  | 'marketRegimeGuardEnabled'
  | 'adaptiveEntryEnabled'
  | 'socialIntelligenceEnabled'
  | 'continuousLearningEnabled'
  | 'snipePumpCreate'
  | 'dynamicJitoTipEnabled'
  | 'autoRentReclaimEnabled'
  | 'autoConsolidateEnabled'
  | 'wifiOnlyMode'
  | 'lowData4gMode';

export class RuntimeConfigManager {
  private readonly filePath: string;
  private config: RuntimeConfig;

  constructor(
    private readonly env: EnvConfig,
    configDir = path.resolve(process.cwd(), 'data'),
  ) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.filePath = path.join(configDir, 'runtimeConfig.json');
    this.config = this.buildDefaults(env);
    this.loadFromDisk();
  }

  private buildDefaults(env: EnvConfig): RuntimeConfig {
    return {
      configVersion: CURRENT_CONFIG_VERSION,
      tradingMode: env.tradingMode,
      discoveryMode: env.discoveryMode,
      autoSnipeEnabled: false,
      trailingStopEnabled: true,
      trailingTpEnabled: env.trailingTpEnabled,
      orderflowFilterEnabled: env.orderflowFilterEnabled,
      washTradeGuardEnabled: env.washTradeGuardEnabled,
      momentumFilterEnabled: env.momentumFilterEnabled,
      honeypotSimEnabled: env.honeypotSimEnabled,
      lpLockCheckEnabled: env.lpLockCheckEnabled,
      antiBundleCheckEnabled: env.antiBundleCheckEnabled,
      spreadGuardEnabled: env.spreadGuardEnabled,
      cooldownGuardEnabled: env.cooldownGuardEnabled,
      breakevenLockEnabled: env.breakevenLockEnabled,
      earlyMomentumCutEnabled: env.earlyMomentumCutEnabled,
      timeExitEnabled: env.timeExitEnabled,
      circuitBreakerEnabled: env.circuitBreakerEnabled,
      autoDeleteEntryMsgEnabled: env.autoDeleteEntryMsgEnabled,
      aiIntelligenceEnabled: env.aiIntelligenceEnabled,
      smartMoneyFilterEnabled: env.smartMoneyFilterEnabled,
      marketRegimeGuardEnabled: env.marketRegimeGuardEnabled,
      adaptiveEntryEnabled: env.adaptiveEntryEnabled,
      socialIntelligenceEnabled: env.socialIntelligenceEnabled,
      continuousLearningEnabled: env.continuousLearningEnabled,
      snipePumpCreate: env.snipePumpCreate,
      observationDelayMs: env.observationDelayMs,
      minLiquidityUsd: env.minLiquidityUsd,
      minUniqueBuyers: env.minUniqueBuyers,
      minBuyCount: env.minBuyCount,
      maxRoundtripSpreadPct: env.maxRoundtripSpreadPct,
      maxFeeRatioPct: env.maxFeeRatioPct,
      entryCooldownMs: env.entryCooldownMs,
      maxConsecutiveLosses: env.maxConsecutiveLosses,
      riskPerTradePct: env.riskPerTradePct,
      slippageBps: env.slippageBps,
      jitoTipSol: env.jitoTipSol,
      minLpBurnedPct: env.minLpBurnedPct,
      maxTop10HoldersPct: env.maxTop10HoldersPct,
      maxDevHoldPct: env.maxDevHoldPct,
      maxBundleSupplyPct: env.maxBundleSupplyPct,
      tp1Pct: env.tp1Pct,
      tp1SellSharePct: env.tp1SellSharePct,
      tp2Pct: env.tp2Pct,
      tp2SellSharePct: env.tp2SellSharePct,
      trailingTpCallbackPct: env.trailingTpCallbackPct,
      breakevenActivatePct: env.breakevenActivatePct,
      trailingActivatePct: env.trailingActivatePct,
      trailingCallbackPct: env.trailingCallbackPct,
      hardSlPct: env.hardSlPct,
      timeExitMinutes: env.timeExitMinutes,
      maxOpenPositions: 6,
      maxSinglePositionPct: env.maxSinglePositionPct,
      maxPortfolioHeatPct: env.maxPortfolioHeatPct,
      maxDailyLossPct: env.maxDailyLossPct,
      maxWeeklyLossPct: env.maxWeeklyLossPct,
      profitProtectionPct: env.profitProtectionPct,
      rugDrainMissTicks: env.rugDrainMissTicks,
      rugDrainLiqRatio: env.rugDrainLiqRatio,
      dynamicJitoTipEnabled: env.dynamicJitoTipEnabled,
      minVolumeSpikeRatio: env.minVolumeSpikeRatio,
      minAiQualityScore: env.minAiQualityScore,
      minEntryRankScore: env.minEntryRankScore,
      maxPriceImpactPct: env.maxPriceImpactPct,
      autoRentReclaimEnabled: env.autoRentReclaimEnabled,
      autoConsolidateEnabled: env.autoConsolidateEnabled,
      coldWalletAddress: env.coldWalletAddress,
      consolidateThresholdSol: env.consolidateThresholdSol,
      consolidateKeepSol: env.consolidateKeepSol,
      wifiOnlyMode: env.wifiOnlyMode,
      lowData4gMode: env.lowData4gMode,
      networkInterfaceType: 'AUTO',
      smallCapEdgeMode: false,
    };
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      this.saveToDisk();
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
      const defaults = this.buildDefaults(this.env);
      if ((parsed.configVersion ?? 0) < CURRENT_CONFIG_VERSION) {
        this.config = {
          ...defaults,
          ...parsed,
          configVersion: CURRENT_CONFIG_VERSION,
        };
        this.saveToDisk();
        return;
      }
      this.config = { ...defaults, ...parsed };
    } catch {
      this.saveToDisk();
    }
  }

  private saveToDisk(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  public get(): RuntimeConfig {
    return { ...this.config };
  }

  public resetToEnvDefaults(): RuntimeConfig {
    const prevMode = this.config.tradingMode;
    const prevAuto = this.config.autoSnipeEnabled;
    this.config = {
      ...this.buildDefaults(this.env),
      tradingMode: prevMode,
      autoSnipeEnabled: prevAuto,
    };
    this.saveToDisk();
    return this.get();
  }

  public applyPreset(preset: StrategyPresetId): RuntimeConfig {
    if (preset === 'MAX_THROUGHPUT') {
      return this.update({
        honeypotSimEnabled: false,
        lpLockCheckEnabled: false,
        antiBundleCheckEnabled: false,
        orderflowFilterEnabled: true,
        washTradeGuardEnabled: false,
        momentumFilterEnabled: false,
        spreadGuardEnabled: false,
        cooldownGuardEnabled: false,
        aiIntelligenceEnabled: true,
        smartMoneyFilterEnabled: false,
        marketRegimeGuardEnabled: false,
        adaptiveEntryEnabled: true,
        socialIntelligenceEnabled: true,
        minAiQualityScore: 40,
        minEntryRankScore: 42,
        minLiquidityUsd: 3500,
        minBuyCount: 2,
        minUniqueBuyers: 2,
        maxOpenPositions: 10,
        maxPortfolioHeatPct: 60,
        breakevenLockEnabled: true,
        earlyMomentumCutEnabled: false,
        timeExitEnabled: true,
        circuitBreakerEnabled: false,
      });
    }
    if (preset === 'STRICT_SAFE') {
      return this.update({
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
        minAiQualityScore: 64,
        minEntryRankScore: 65,
        minLiquidityUsd: 12000,
        minBuyCount: 6,
        minUniqueBuyers: 5,
        maxOpenPositions: 5,
        maxPortfolioHeatPct: 30,
        breakevenLockEnabled: true,
        earlyMomentumCutEnabled: true,
        timeExitEnabled: true,
        circuitBreakerEnabled: true,
      });
    }
    if (preset === 'SMALL_CAP_HIGH_PF') {
      return this.update({
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
        maxOpenPositions: 4,
        breakevenLockEnabled: true,
        earlyMomentumCutEnabled: true,
        timeExitEnabled: true,
        circuitBreakerEnabled: true,
      });
    }
    return this.update({
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
      smallCapEdgeMode: false,
      minAiQualityScore: 52,
      minEntryRankScore: 52,
      minLiquidityUsd: 8000,
      minBuyCount: 5,
      minUniqueBuyers: 4,
      maxOpenPositions: 6,
      maxPortfolioHeatPct: 35,
      breakevenLockEnabled: true,
      earlyMomentumCutEnabled: true,
      timeExitEnabled: true,
      circuitBreakerEnabled: true,
    });
  }

  public update(patch: Partial<RuntimeConfig>): RuntimeConfig {
    this.config = { ...this.config, ...patch };
    this.saveToDisk();
    return this.get();
  }

  public toggle(key: ToggleableConfigKey): RuntimeConfig {
    this.config[key] = !this.config[key];
    this.saveToDisk();
    return this.get();
  }
}
