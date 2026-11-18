import { loadEnvConfig } from './config/env';
import { RuntimeConfigManager } from './config/runtimeConfig';
import { sharedHttpClient } from './core/httpClient';
import { JitoClient } from './core/jito';
import { RpcManager } from './core/rpc';
import { TransactionSimulator } from './core/simulation';
import { TreasuryManager } from './core/treasury';
import {
  OrderflowResult,
  PipelineStats,
  PoolDiscoveryEvent,
  TokenMetadata,
} from './core/types';
import { WalletManager } from './core/wallet';
import { MultiDexListeners } from './listeners/dexListeners';
import { AntiRugEngine } from './security/antiRug';
import { OrderflowAnalyzer } from './filters/orderflow';
import { SmartExecutionRouter } from './execution/router';
import { PositionManager } from './strategy/positionManager';
import { computeDynamicPositionSize } from './strategy/riskSizing';
import { AdaptiveEntryEngine } from './strategy/entryEngine';
import { SmartMoneyEngine } from './smartmoney/walletIntelligence';
import { MarketRegimeDetector } from './market/regimeDetector';
import { SocialIntelligenceEngine } from './social/socialIntelligence';
import { AiIntelligenceEngine } from './ai/intelligenceEngine';
import { BacktestEngine } from './backtesting/backtestEngine';
import { StrategyOptimizer } from './optimization/strategyOptimizer';
import { ContinuousLearningEngine } from './learning/continuousLearning';
import { AgentCoordinator } from './agents/agentCoordinator';
import { SniperDatabase } from './analytics/database';
import { PerformanceAnalyticsEngine } from './analytics/performance';
import { MobileAppApiServer } from './api/appServer';
import { consumeBootNotice, HotUpdater } from './updater/hotUpdater';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTokenMetadata(event: PoolDiscoveryEvent): Promise<TokenMetadata> {
  const fallback: TokenMetadata = {
    mint: event.mint,
    name: event.prefetchedName ?? `Token ${event.mint.slice(0, 6)}`,
    symbol: event.prefetchedSymbol ?? event.mint.slice(0, 6).toUpperCase(),
    decimals: 6,
    description: '',
    twitter: event.twitterUrl,
    telegram: event.telegramUrl,
    website: event.websiteUrl,
    dexBoosted: event.dexBoosted,
    ageMinutes: event.prefetchedAgeMinutes ?? 2,
    m5Buys: event.prefetchedM5Buys,
    m5VolumeUsd: event.prefetchedM5VolumeUsd,
    liquidityUsd: event.prefetchedLiquidityUsd,
  };

  if (event.prefetchedSymbol) {
    return fallback;
  }

  try {
    const data = await sharedHttpClient.get<{
      pairs?: Array<{
        baseToken?: { address?: string; name?: string; symbol?: string };
        info?: { websites?: Array<{ url?: string }>; socials?: Array<{ type?: string; url?: string }> };
      }>;
    }>(`https://api.dexscreener.com/latest/dex/tokens/${event.mint}`, {
      axiosConfig: { timeout: 1200 },
      maxRetries: 1,
    });
    const match = (data?.pairs ?? []).find((p) => p.baseToken?.address === event.mint);
    const socials = match?.info?.socials ?? [];
    return {
      ...fallback,
      name: event.prefetchedName ?? match?.baseToken?.name ?? fallback.name,
      symbol: event.prefetchedSymbol ?? match?.baseToken?.symbol ?? fallback.symbol,
      twitter:
        fallback.twitter ?? socials.find((s) => s.type === 'twitter')?.url,
      telegram:
        fallback.telegram ?? socials.find((s) => s.type === 'telegram')?.url,
      website: fallback.website ?? match?.info?.websites?.[0]?.url,
    };
  } catch {
    return fallback;
  }
}

async function bootstrap(): Promise<void> {
  console.log('==========================================================');
  console.log('  SOLANA AUTONOMOUS QUANT & AI SNIPER (v7) — INITIALIZING');
  console.log('==========================================================');

  const env = loadEnvConfig();
  sharedHttpClient.configure({
    initialRetryDelayMs: env.apiInitialRetryDelayMs,
    maxRetries: env.apiMaxRetries,
    globalCooldownMs: env.apiGlobalCooldownMs,
    cacheTtlMs: env.apiCacheTtlMs,
  });
  const configManager = new RuntimeConfigManager(env);
  const rpcManager = new RpcManager(env);
  const wallet = new WalletManager(env.privateKey);
  const treasury = new TreasuryManager(rpcManager, wallet);
  const jito = new JitoClient(env.jitoBlockEngineUrl);
  const simulator = new TransactionSimulator();

  const db = new SniperDatabase(env.sqliteDbPath, env.paperInitialBalanceSol);
  for (const seedCreator of env.blacklistedCreators) {
    db.blacklistCreator(seedCreator, 'Seeded from .env BLACKLISTED_CREATORS', 'ENV_SEED');
  }
  const pipelineStats: PipelineStats = {
    startedAt: Date.now(),
    lastResetAt: Date.now(),
    discovered: 0,
    blockedCooldownOrCap: 0,
    blockedAntiRug: 0,
    blockedMarket: 0,
    blockedOrderflow: 0,
    blockedAiOrEntry: 0,
    blockedRisk: 0,
    executedBuys: 0,
  };

  const blacklistChecker = (creator?: string | null) => db.isCreatorBlacklisted(creator);
  const listeners = new MultiDexListeners(rpcManager, env.discoveryMode, env.freeFeedPollMs);
  const antiRug = new AntiRugEngine(rpcManager, simulator, blacklistChecker);
  const orderflow = new OrderflowAnalyzer(rpcManager, blacklistChecker, db);
  const router = new SmartExecutionRouter(env, rpcManager, wallet, jito, simulator, db);

  // Module 3, 4, 12, 1, 5, 8, 13, Performance & Autonomous Agents
  const smartMoneyEngine = new SmartMoneyEngine(db, env.smartWalletsSeed);
  const regimeDetector = new MarketRegimeDetector();
  const socialEngine = new SocialIntelligenceEngine(env.twitterBearerToken);
  const aiEngine = new AiIntelligenceEngine(db, {
    apiKey: env.openAiApiKey,
    baseUrl: env.openAiBaseUrl,
  });
  const adaptiveEntry = new AdaptiveEntryEngine();
  const backtestEngine = new BacktestEngine(db);
  const optimizer = new StrategyOptimizer(db);
  const learningEngine = new ContinuousLearningEngine(db);
  const perfAnalytics = new PerformanceAnalyticsEngine(db);

  const positionManager = new PositionManager(db, router, configManager, orderflow, antiRug, treasury);
  const agentCoordinator = new AgentCoordinator(
    db,
    router,
    regimeDetector,
    learningEngine,
    env.continuousLearningEnabled,
  );
  const hotUpdater = new HotUpdater(process.cwd(), {
    apiKey: env.openAiApiKey,
    baseUrl: env.openAiBaseUrl,
  });

  const appServer = new MobileAppApiServer(
    env.appApiPort,
    configManager,
    wallet,
    db,
    positionManager,
    regimeDetector,
    backtestEngine,
    perfAnalytics,
    pipelineStats,
  );

  let lastBuyTimestamp = 0;
  let activeAuditWorkers = 0;
  const maxConcurrentAudits = env.hasPaidRpcPlan ? 4 : 1;
  const pendingPoolQueue: PoolDiscoveryEvent[] = [];

  /**
   * 6-Stage Decoupled Trading Pipeline:
   * 1) Pre-checks & Observation -> 2) Anti-Rug & Market -> 3) Orderflow + SmartMoney + Social + Regime + AI ->
   * 4) Adaptive Entry -> 5) Institutional Risk Sizing -> 6) Smart Execution & Snapshot Persistence
   */
  const processDiscoveredPool = async (event: PoolDiscoveryEvent): Promise<void> => {
    const cfg = configManager.get();
    if (!cfg.autoSnipeEnabled) return;
    if (cfg.wifiOnlyMode && cfg.networkInterfaceType === 'CELLULAR_4G' && !cfg.lowData4gMode) {
      return;
    }

    if (event.prefetchedLiquidityUsd || event.prefetchedM5PriceChangePct) {
      regimeDetector.observeDiscoveredPool(
        event.prefetchedLiquidityUsd ?? 0,
        event.prefetchedM5PriceChangePct ?? 0,
      );
    }

    if (cfg.cooldownGuardEnabled && Date.now() - lastBuyTimestamp < cfg.entryCooldownMs) {
      pipelineStats.blockedCooldownOrCap++;
      listeners.markMintCooldown(event.mint, 15_000);
      return;
    }

    const openPositions = db.getOpenPositions(cfg.tradingMode);
    if (openPositions.length >= cfg.maxOpenPositions || openPositions.some((p) => p.mint === event.mint)) {
      pipelineStats.blockedCooldownOrCap++;
      if (!openPositions.some((p) => p.mint === event.mint)) {
        listeners.markMintCooldown(event.mint, 20_000);
      }
      return;
    }

    if (event.creatorAddress && db.isCreatorBlacklisted(event.creatorAddress).blacklisted) {
      pipelineStats.blockedAntiRug++;
      return;
    }

    if (
      event.eventKind === 'NEW_POOL' &&
      !event.signature.startsWith('FREE_') &&
      cfg.observationDelayMs > 0
    ) {
      await sleep(cfg.observationDelayMs);
    }

    const latestCfg = configManager.get();
    if (!latestCfg.autoSnipeEnabled) return;

    // Stage 1.5 Fast Prefetch Gate: eliminate obvious illiquid/inactive candidates BEFORE calling RPC/RugCheck/Jupiter
    if (
      latestCfg.minLiquidityUsd > 0 &&
      event.prefetchedLiquidityUsd !== undefined &&
      event.prefetchedLiquidityUsd > 0 &&
      event.prefetchedLiquidityUsd < latestCfg.minLiquidityUsd * 0.85
    ) {
      pipelineStats.blockedMarket++;
      listeners.markMintCooldown(event.mint, 60_000);
      return;
    }
    if (
      latestCfg.orderflowFilterEnabled &&
      event.prefetchedM5Buys !== undefined &&
      event.prefetchedM5Buys < Math.max(1, latestCfg.minBuyCount - 1)
    ) {
      pipelineStats.blockedOrderflow++;
      listeners.markMintCooldown(event.mint, 45_000);
      return;
    }

    const currentRegime = await regimeDetector.refreshRegime(false);
    const availableSol =
      latestCfg.tradingMode === 'PAPER'
        ? db.getPaperBalance().balanceSol
        : await rpcManager.withFallback((conn) => wallet.getLiveSolBalance(conn)).catch(() => 0);
    const openExposureSol = db.getOpenExposureSol(latestCfg.tradingMode);
    const dailyRealizedPnlSol = db.getDailyRealizedPnlSol(latestCfg.tradingMode);
    const weeklyRealizedPnlSol = db.getWeeklyRealizedPnlSol(latestCfg.tradingMode);

    const estEquity = Math.max(0.05, availableSol + openExposureSol);
    const probeOrderSol = Math.min(
      0.1,
      Math.max(0.01, (estEquity * (latestCfg.riskPerTradePct / 100)) / Math.max(0.1, latestCfg.hardSlPct / 100)),
    );

    // STAGE 2A: 5-Layer Anti-Rug + Metadata first (skip MarketSnapshot HTTP calls if AntiRug blocks)
    const [audit, metadata] = await Promise.all([
      antiRug.runFiveLayerAudit(
        {
          mint: event.mint,
          dex: event.dex,
          poolAddress: event.poolAddress,
          lpMint: event.lpMint,
          creatorAddress: event.creatorAddress,
          launchSlot: event.slot,
          payerPublicKey: wallet.publicKey.toBase58(),
        },
        latestCfg,
      ),
      resolveTokenMetadata(event),
    ]);
    db.saveSecurityAudit(audit);

    const resolvedCreator = audit.creatorAddress ?? event.creatorAddress;

    if (!audit.overallSafe) {
      pipelineStats.blockedAntiRug++;
      const permanentRug =
        audit.creatorBlacklisted || !audit.mintAuthorityRevoked || !audit.freezeAuthorityRevoked || !audit.honeypotPassed;
      if (resolvedCreator && (!audit.mintAuthorityRevoked || !audit.honeypotPassed)) {
        db.blacklistCreator(
          resolvedCreator,
          `Auto-blacklisted (${metadata.symbol}): HP=${audit.honeypotPassed}, MintRevoked=${audit.mintAuthorityRevoked}`,
          'AUTO_SECURITY_RUG',
        );
      }
      db.saveTokenSnapshot({
        mint: event.mint,
        symbol: metadata.symbol,
        dex: event.dex,
        poolAddress: event.poolAddress,
        creatorAddress: resolvedCreator,
        marketRegime: currentRegime.regime,
        actionTaken: 'REJECTED',
        rejectionStage: 'SECURITY',
        rejectionReason: `Score=${audit.securityScore} Unverified=${audit.unverifiedLayers.join(',')}`,
        securityScore: audit.securityScore,
        aiQualityScore: 0,
        pumpProbability: 0,
        rugProbability: 0,
        smartMoneyScore: 50,
        socialScore: 30,
        orderflowImbalance: 0,
        cvdSol: 0,
        liquidityUsd: event.prefetchedLiquidityUsd ?? 0,
        priceSolAtDiscovery: event.prefetchedPriceSol ?? 0,
        createdAt: Date.now(),
      });
      if (!permanentRug) {
        listeners.markMintCooldown(event.mint, 90_000);
      }
      return;
    }

    // STAGE 2B: Market Snapshot (reuses prefetched price/liquidity + AntiRug roundTripLossPct when present)
    const snapshot = await router.fetchMarketSnapshot(event.mint, probeOrderSol, {
      priceSol: event.prefetchedPriceSol,
      liquidityUsd: event.prefetchedLiquidityUsd,
      solPriceUsd: currentRegime.solPriceUsd,
      roundTripLossPct: audit.roundTripLossPct,
    });

    const effectiveLiquidityUsd = snapshot.liquidityUsd ?? event.prefetchedLiquidityUsd ?? 0;
    const priceAtDiscovery = snapshot.priceSol ?? event.prefetchedPriceSol ?? 0;

    const saveRejectedSnapshot = (stage: string, reason: string, partial?: {
      aiScore?: number;
      pumpProb?: number;
      rugProb?: number;
      smScore?: number;
      socialScore?: number;
      imbalance?: number;
      cvdSol?: number;
      strategy?: PoolDiscoveryEvent['dex'] extends never ? never : undefined;
    }) => {
      db.saveTokenSnapshot({
        mint: event.mint,
        symbol: metadata.symbol,
        dex: event.dex,
        poolAddress: event.poolAddress,
        creatorAddress: resolvedCreator,
        marketRegime: currentRegime.regime,
        actionTaken: 'REJECTED',
        rejectionStage: stage,
        rejectionReason: reason,
        securityScore: audit.securityScore,
        aiQualityScore: partial?.aiScore ?? 0,
        pumpProbability: partial?.pumpProb ?? 0,
        rugProbability: partial?.rugProb ?? 0,
        smartMoneyScore: partial?.smScore ?? 50,
        socialScore: partial?.socialScore ?? 30,
        orderflowImbalance: partial?.imbalance ?? 0,
        cvdSol: partial?.cvdSol ?? 0,
        liquidityUsd: effectiveLiquidityUsd,
        priceSolAtDiscovery: priceAtDiscovery,
        createdAt: Date.now(),
      });
    };

    if (!snapshot.priceSol || snapshot.priceSol <= 0) {
      pipelineStats.blockedMarket++;
      saveRejectedSnapshot('MARKET', 'No verified price');
      listeners.markMintCooldown(event.mint, 30_000);
      return;
    }

    if (latestCfg.minLiquidityUsd > 0 && effectiveLiquidityUsd < latestCfg.minLiquidityUsd) {
      pipelineStats.blockedMarket++;
      saveRejectedSnapshot('MARKET', `Liquidity $${Math.round(effectiveLiquidityUsd)} < $${latestCfg.minLiquidityUsd}`);
      listeners.markMintCooldown(event.mint, 45_000);
      return;
    }

    if (
      latestCfg.spreadGuardEnabled &&
      snapshot.roundTripLossPct !== null &&
      snapshot.roundTripLossPct > latestCfg.maxRoundtripSpreadPct
    ) {
      pipelineStats.blockedMarket++;
      saveRejectedSnapshot('MARKET', `Spread ${snapshot.roundTripLossPct}% > ${latestCfg.maxRoundtripSpreadPct}%`);
      listeners.markMintCooldown(event.mint, 45_000);
      return;
    }

    // STAGE 3: Intelligence Fusion (Orderflow CVD + SmartMoney + Social + AI Scoring)
    const neutralFlow: OrderflowResult = {
      passed: true,
      dataSource: 'FREE_FEED_AGGREGATED',
      reliabilityScore: 0.5,
      buyCount: event.prefetchedM5Buys ?? 5,
      sellCount: event.prefetchedM5Sells ?? 1,
      buyToSellRatio: 2,
      devSold: false,
      uniqueBuyers: Math.max(4, event.prefetchedM5Buys ?? 4),
      uniqueSellers: 1,
      netSolInflow: 0.5,
      buySolVolume: 0.8,
      sellSolVolume: 0.3,
      cvdSol: 0.5,
      orderflowImbalance: 0.45,
      whaleBuyCount: 0,
      whaleSellCount: 0,
      whaleNetSol: 0,
      smartMoneyAccumulation: false,
      smartMoneyDistribution: false,
      sybilSuspected: false,
      sybilScore: 0,
      coordinatedBuyDetected: false,
      avgBuySol: 0.16,
      reason: 'Orderflow filter bypassed',
    };

    const flow = latestCfg.orderflowFilterEnabled
      ? await orderflow.analyzeEarlyMomentum(event.mint, resolvedCreator, {
          minBuyCount: latestCfg.minBuyCount,
          minUniqueBuyers: latestCfg.minUniqueBuyers,
          minVolumeSpikeRatio: latestCfg.minVolumeSpikeRatio,
          washTradeGuardEnabled: latestCfg.washTradeGuardEnabled,
          momentumFilterEnabled: latestCfg.momentumFilterEnabled,
          prefetchedM5Buys: event.prefetchedM5Buys,
          prefetchedM5Sells: event.prefetchedM5Sells,
          prefetchedM5VolumeUsd: event.prefetchedM5VolumeUsd,
          prefetchedH1VolumeUsd: event.prefetchedH1VolumeUsd,
          prefetchedM5PriceChangePct: event.prefetchedM5PriceChangePct,
          prefetchedLiquidityUsd: effectiveLiquidityUsd,
          prefetchedFdvUsd: event.prefetchedFdvUsd,
          prefetchedAgeMinutes: event.prefetchedAgeMinutes,
          prefetchedAtMs: event.detectedAt,
          solPriceUsd: currentRegime.solPriceUsd,
          poolAddress: event.poolAddress,
        })
      : neutralFlow;

    if (!flow.passed) {
      pipelineStats.blockedOrderflow++;
      saveRejectedSnapshot('ORDERFLOW', flow.reason, {
        imbalance: flow.orderflowImbalance,
        cvdSol: flow.cvdSol,
      });
      if (!flow.devSold && !flow.washTradeSuspected) {
        listeners.markMintCooldown(event.mint, 45_000);
      }
      return;
    }

    const smartMoney = smartMoneyEngine.analyzeTokenSmartMoney({
      mint: event.mint,
      creatorAddress: resolvedCreator,
      flow,
      bundleSupplyPct: audit.bundleSupplyPct,
      sybilScore: Math.max(audit.sybilScore, flow.sybilScore),
      insidersDetected: audit.insiderWalletsCount,
    });

    if (latestCfg.smartMoneyFilterEnabled && (smartMoney.insiderAlert || smartMoney.smartMoneyScore < 32)) {
      pipelineStats.blockedOrderflow++;
      saveRejectedSnapshot('SMART_MONEY', smartMoney.reason, {
        smScore: smartMoney.smartMoneyScore,
        imbalance: flow.orderflowImbalance,
        cvdSol: flow.cvdSol,
      });
      if (!smartMoney.insiderAlert) {
        listeners.markMintCooldown(event.mint, 45_000);
      }
      return;
    }

    const social = latestCfg.socialIntelligenceEnabled
      ? await socialEngine.analyzeSocial({
          metadata,
          uniqueBuyers: flow.uniqueBuyers,
          buyCount: flow.buyCount,
          dexBoosted: event.dexBoosted,
        })
      : {
          socialScore: 50,
          narrative: 'UNKNOWN' as const,
          twitterPresent: Boolean(event.twitterUrl),
          telegramPresent: Boolean(event.telegramUrl),
          websitePresent: Boolean(event.websiteUrl),
          mentionVelocityPerHr: 0,
          fakeEngagementSuspected: false,
          influencerSignalScore: 0,
          narrativeGrowthScore: 50,
          sentimentScore: 50,
          reason: 'Social filter bypassed',
        };

    const ai = await aiEngine.evaluateCandidate({
      metadata,
      audit,
      flow,
      smartMoney,
      social,
      regime: currentRegime,
      liquidityUsd: effectiveLiquidityUsd,
      cfg: latestCfg,
    });

    if (!ai.passed) {
      pipelineStats.blockedAiOrEntry++;
      saveRejectedSnapshot('AI_INTELLIGENCE', ai.reason, {
        aiScore: ai.tokenQualityScore,
        pumpProb: ai.pumpProbability,
        rugProb: ai.rugProbability,
        smScore: smartMoney.smartMoneyScore,
        socialScore: social.socialScore,
        imbalance: flow.orderflowImbalance,
        cvdSol: flow.cvdSol,
      });
      listeners.markMintCooldown(event.mint, 45_000);
      return;
    }

    // STAGE 4: Adaptive Entry Strategy Engine
    const entryDecision = adaptiveEntry.evaluateEntry({
      audit,
      flow,
      smartMoney,
      social,
      ai,
      regime: currentRegime,
      snapshot,
      liquidityUsd: effectiveLiquidityUsd,
      h1PriceChangePct: event.prefetchedH1PriceChangePct,
      cfg: latestCfg,
    });

    if (!entryDecision.approved) {
      pipelineStats.blockedAiOrEntry++;
      saveRejectedSnapshot('ADAPTIVE_ENTRY', entryDecision.reasons.join('; '), {
        aiScore: ai.tokenQualityScore,
        pumpProb: ai.pumpProbability,
        rugProb: ai.rugProbability,
        smScore: smartMoney.smartMoneyScore,
        socialScore: social.socialScore,
        imbalance: flow.orderflowImbalance,
        cvdSol: flow.cvdSol,
      });
      if (!flow.sybilSuspected && !smartMoney.coordinatedClusterDetected) {
        listeners.markMintCooldown(event.mint, 45_000);
      }
      return;
    }

    // STAGE 5: Institutional Risk Sizing (Hard Limits + Correlated Exposure + Price Impact)
    const correlatedOpenSol = db
      .getOpenPositions(latestCfg.tradingMode)
      .filter((p) => p.dex === event.dex)
      .reduce((acc, p) => acc + p.remainingSolCostBasis, 0);

    const sizing = computeDynamicPositionSize({
      availableBalanceSol: availableSol,
      openExposureSol,
      dailyRealizedPnlSol,
      weeklyRealizedPnlSol,
      securityScore: audit.securityScore,
      liquidityUsd: effectiveLiquidityUsd,
      aiQualityScore: ai.tokenQualityScore,
      aiConfidence: ai.calibratedConfidence,
      marketRegime: currentRegime.regime,
      regimeRiskMultiplier: latestCfg.marketRegimeGuardEnabled ? currentRegime.riskMultiplier : 1.0,
      volatilityScore: currentRegime.volatilityScore,
      consecutiveLosses: db.getConsecutiveLossCount(latestCfg.tradingMode),
      correlatedExposureSol: correlatedOpenSol,
      roundTripSpreadPct: snapshot.roundTripLossPct,
      solPriceUsd: currentRegime.solPriceUsd,
      cfg: latestCfg,
    });

    if (!sizing.allowed) {
      pipelineStats.blockedRisk++;
      saveRejectedSnapshot('RISK', sizing.reason, {
        aiScore: ai.tokenQualityScore,
        pumpProb: ai.pumpProbability,
        rugProb: ai.rugProbability,
        smScore: smartMoney.smartMoneyScore,
        socialScore: social.socialScore,
        imbalance: flow.orderflowImbalance,
        cvdSol: flow.cvdSol,
      });
      if (latestCfg.circuitBreakerEnabled && (sizing.dailyLossHit || sizing.weeklyLossHit) && latestCfg.autoSnipeEnabled) {
        configManager.update({ autoSnipeEnabled: false });
        appServer.pushEvent(
          'ALERT',
          `LOSS LIMIT HIT [${latestCfg.tradingMode}]: ${sizing.reason} — Bot tạm dừng Auto-Snipe.`,
        );
      } else {
        listeners.markMintCooldown(event.mint, 45_000);
      }
      return;
    }

    // STAGE 6: Smart Execution & Complete Telemetry Persistence
    const exec = await router.executeBuy({
      mint: event.mint,
      dex: event.dex,
      poolAddress: event.poolAddress,
      buyAmountSolOverride: sizing.sizedBuySol,
      urgency: entryDecision.urgency,
      cfg: latestCfg,
      snapshot,
      solPriceUsd: currentRegime.solPriceUsd,
    });

    if (!exec.success) {
      saveRejectedSnapshot('EXECUTION', exec.error ?? 'Execution failed', {
        aiScore: ai.tokenQualityScore,
        pumpProb: ai.pumpProbability,
        rugProb: ai.rugProbability,
        smScore: smartMoney.smartMoneyScore,
        socialScore: social.socialScore,
        imbalance: flow.orderflowImbalance,
        cvdSol: flow.cvdSol,
      });
      listeners.markMintCooldown(event.mint, 45_000);
      appServer.pushEvent(
        'ALERT',
        `Snipe bỏ qua [${latestCfg.tradingMode}] ${metadata.symbol}: ${exec.error}`,
        { mint: event.mint, symbol: metadata.symbol },
      );
      return;
    }

    pipelineStats.executedBuys++;
    lastBuyTimestamp = Date.now();

    db.saveTokenSnapshot({
      mint: event.mint,
      symbol: metadata.symbol,
      dex: event.dex,
      poolAddress: event.poolAddress,
      creatorAddress: resolvedCreator,
      marketRegime: currentRegime.regime,
      entryStrategy: entryDecision.selectedStrategy,
      actionTaken: 'BOUGHT',
      securityScore: audit.securityScore,
      aiQualityScore: ai.tokenQualityScore,
      pumpProbability: ai.pumpProbability,
      rugProbability: ai.rugProbability,
      smartMoneyScore: smartMoney.smartMoneyScore,
      socialScore: social.socialScore,
      orderflowImbalance: flow.orderflowImbalance,
      cvdSol: flow.cvdSol,
      liquidityUsd: effectiveLiquidityUsd,
      priceSolAtDiscovery: exec.executionPriceSol,
      createdAt: Date.now(),
    });

    const pos = db.createPosition({
      mint: event.mint,
      symbol: metadata.symbol,
      dex: event.dex,
      poolAddress: event.poolAddress,
      creatorAddress: resolvedCreator,
      mode: exec.mode,
      entryStrategy: entryDecision.selectedStrategy,
      marketRegime: currentRegime.regime,
      aiScoreAtEntry: ai.tokenQualityScore,
      entryPriceSol: exec.executionPriceSol,
      entryLiquidityUsd: effectiveLiquidityUsd,
      solSpent: exec.solAmount,
      tokenAmount: exec.tokenAmountUi,
    });

    db.logTrade({
      positionId: pos.id,
      mint: event.mint,
      symbol: metadata.symbol,
      mode: exec.mode,
      side: 'BUY',
      dexRoute: exec.dexRoute,
      solAmount: exec.solAmount,
      tokenAmount: exec.tokenAmountUi,
      priceSol: exec.executionPriceSol,
      feeSol: exec.priorityFeeSol + exec.jitoTipSol,
      pnlSol: 0,
      signature: exec.signature,
      reason: `AUTO_${entryDecision.selectedStrategy}`,
      reconciled: exec.reconciled,
      slippageDiffPct: exec.slippageDiffPct,
      latencyMs: exec.latencyMs,
    });

    const buyMsgId = appServer.pushEvent(
      'BUY',
      `AUTO-SNIPE (${exec.mode} | ${entryDecision.selectedStrategy}) ${metadata.symbol} | ${exec.solAmount} SOL | AI ${ai.tokenQualityScore}/100 | Liq $${Math.round(effectiveLiquidityUsd).toLocaleString()}`,
      { mint: event.mint, symbol: metadata.symbol },
    );

    db.updatePositionState(pos.id, {
      buyChatId: 1,
      buyMessageId: buyMsgId,
    });
  };

  const pumpAuditQueue = (): void => {
    while (activeAuditWorkers < maxConcurrentAudits && pendingPoolQueue.length > 0) {
      // Pick highest-liquidity candidate first so top pools are audited before stale/low-liq pools
      let bestIdx = 0;
      let bestLiq = pendingPoolQueue[0]?.prefetchedLiquidityUsd ?? 0;
      for (let i = 1; i < pendingPoolQueue.length; i++) {
        const liq = pendingPoolQueue[i]?.prefetchedLiquidityUsd ?? 0;
        if (liq > bestLiq) {
          bestLiq = liq;
          bestIdx = i;
        }
      }
      const nextEvent = pendingPoolQueue.splice(bestIdx, 1)[0]!;
      activeAuditWorkers++;
      void processDiscoveredPool(nextEvent)
        .catch((err) => {
          console.error('[Pipeline Worker Error]', err);
        })
        .finally(() => {
          activeAuditWorkers--;
          pumpAuditQueue();
        });
    }
  };

  listeners.on('pool_discovered', (event: PoolDiscoveryEvent) => {
    const cfg = configManager.get();
    if (!cfg.autoSnipeEnabled) return;

    pipelineStats.discovered++;
    if (event.dex === 'PUMP_FUN' && event.eventKind === 'NEW_POOL' && !cfg.snipePumpCreate) {
      return;
    }

    if (pendingPoolQueue.length >= 40) {
      // Evict lowest-liquidity candidate instead of blind FIFO shift so high-conviction pools survive bursts
      let lowestIdx = 0;
      let lowestLiq = pendingPoolQueue[0]?.prefetchedLiquidityUsd ?? 0;
      for (let i = 1; i < pendingPoolQueue.length; i++) {
        const liq = pendingPoolQueue[i]?.prefetchedLiquidityUsd ?? 0;
        if (liq < lowestLiq) {
          lowestLiq = liq;
          lowestIdx = i;
        }
      }
      if ((event.prefetchedLiquidityUsd ?? 0) >= lowestLiq) {
        pendingPoolQueue.splice(lowestIdx, 1);
        pendingPoolQueue.push(event);
      }
    } else {
      pendingPoolQueue.push(event);
    }
    pumpAuditQueue();
  });

  listeners.on('listener_status', (info: { dex: string; status: string }) => {
    console.log(`[Listener] ${info.dex} -> ${info.status}`);
  });

  listeners.on('listener_error', (err: { dex: string; error: string }) => {
    console.error(`[Listener Error] ${err.dex}: ${err.error}`);
  });

  positionManager.on('strategy_action', async (ev) => {
    const latestCfg = configManager.get();
    let deletedEntryNote = '';
    if (latestCfg.autoDeleteEntryMsgEnabled && ev.buyMessageId) {
      const deleted = appServer.removeEntryAlertById(ev.buyMessageId);
      if (deleted) {
        deletedEntryNote = ' (Đã tự động xóa thông báo đặt lệnh coin này)';
      }
    }

    const reconText =
      ev.mode === 'LIVE' && ev.reconciled
        ? ` | Reconciled (${ev.slippageDiffPct ?? 0}%)`
        : '';
    appServer.pushEvent(
      'EXIT',
      `CHỐT LỆNH [${ev.action}] (${ev.mode}) ${ev.symbol}: +${ev.solReceived.toFixed(4)} SOL | PnL ${
        ev.pnlPct >= 0 ? '+' : ''
      }${ev.pnlPct.toFixed(2)}%${reconText}${deletedEntryNote}`,
      { mint: ev.mint, symbol: ev.symbol },
    );
  });

  positionManager.on(
    'circuit_breaker',
    async (info: { mode: string; lossStreak: number }) => {
      appServer.pushEvent(
        'ALERT',
        `CIRCUIT BREAKER [${info.mode}]: Tạm dừng Auto-Snipe sau ${info.lossStreak} lệnh thua liên tiếp.`,
      );
    },
  );

  agentCoordinator.on('model_drift', async (ev: { report: { driftDeltaPct: number }; retrained: { reason: string } }) => {
    appServer.pushEvent(
      'ALERT',
      `AI MODEL DRIFT (-${ev.report.driftDeltaPct}%): ${ev.retrained.reason}`,
    );
  });

  positionManager.on(
    'treasury_action',
    async (out: {
      reclaim?: { mode: string; closedCount: number; reclaimedSol: number; signatures: string[] };
      consolidation?: { executed: boolean; transferredSol: number; coldWalletAddress?: string; signature?: string };
    }) => {
      const parts: string[] = [];
      if (out.reclaim && out.reclaim.closedCount > 0) {
        parts.push(
          `Thu hồi Rent (${out.reclaim.mode}): đóng ${out.reclaim.closedCount} ATA -> +${out.reclaim.reclaimedSol.toFixed(5)} SOL`,
        );
      }
      if (out.consolidation?.executed) {
        parts.push(
          `Gom ví lạnh: chuyển ${out.consolidation.transferredSol.toFixed(4)} SOL -> ${out.consolidation.coldWalletAddress}`,
        );
      }
      if (parts.length > 0) {
        appServer.pushEvent('SYSTEM', parts.join(' | '));
      }
    },
  );

  const treasurySweepTimer = setInterval(() => {
    const cfg = configManager.get();
    if (cfg.tradingMode !== 'LIVE' || (!cfg.autoRentReclaimEnabled && !cfg.autoConsolidateEnabled)) {
      return;
    }
    const openPositions = db.getOpenPositions('LIVE');
    const openMints = new Set(openPositions.map((p) => p.mint));
    const openExposureSol = db.getOpenExposureSol('LIVE');
    void (async () => {
      const reclaim = cfg.autoRentReclaimEnabled
        ? await treasury.reclaimEmptyTokenAccounts({ mode: 'LIVE', openMints })
        : undefined;
      const consolidation = cfg.autoConsolidateEnabled
        ? await treasury.consolidateProfitToColdWallet({ cfg, openExposureSol })
        : undefined;
      if ((reclaim && reclaim.closedCount > 0) || consolidation?.executed) {
        positionManager.emit('treasury_action', { reclaim, consolidation });
      }
    })().catch(() => {});
  }, 600_000);

  // Start subsystems
  listeners.start();
  positionManager.start(env.positionPollMs);
  agentCoordinator.start();
  appServer.start();
  hotUpdater.startWatching(async (res, sourceFile) => {
    if (res.success) {
      appServer.pushEvent(
        'SYSTEM',
        `Hot-Update ${sourceFile} biên dịch OK (${res.updatedFiles.join(', ')})${
          res.autoFixed ? ' [Auto-Fix]' : ''
        }. Đang khởi động lại bot...`,
      );
    } else {
      appServer.pushEvent(
        'ALERT',
        `Hot-Update ${sourceFile} thất bại: ${res.error ?? 'Compile error'}${
          res.rolledBack ? ' (Đã rollback an toàn)' : ''
        }`,
      );
    }
  });

  const bootNotice = consumeBootNotice(process.cwd());
  if (bootNotice) {
    appServer.pushEvent('SYSTEM', bootNotice.message);
  }

  const initialCfg = configManager.get();
  console.log(
    `[Ready v7 App-Only] Mode=${initialCfg.tradingMode} | Discovery=${initialCfg.discoveryMode} | WiFiOnly=${initialCfg.wifiOnlyMode} | Risk=${initialCfg.riskPerTradePct}% Bal | Blacklist=${db.getBlacklistedCreatorCount()}`,
  );
  appServer.pushEvent(
    'SYSTEM',
    `Bot v7 App Mode khởi động (${initialCfg.tradingMode} | Wi-Fi Only=${initialCfg.wifiOnlyMode} | API Port ${env.appApiPort})`,
  );

  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}, draining connections...`);
    clearInterval(treasurySweepTimer);
    hotUpdater.stopWatching();
    agentCoordinator.stop();
    positionManager.stop();
    await listeners.stop();
    await appServer.stop();
    db.close();
    console.log('[Shutdown] Clean exit complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Fatal Boot Error]', err);
  process.exit(1);
});
