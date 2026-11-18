import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStrategyPreset,
  computeAnalyticsSummary,
  computeDynamicJitoTip,
  computeDynamicPositionSize,
  computeEffectiveFees,
  computePostTradeReconciliation,
  DEFAULT_STRATEGY_CONFIG,
  detectMarketRegime,
  evaluateAdaptiveEntry,
  evaluateAiTokenCandidate,
  evaluateTokenCandidate,
  runWalkForwardBacktestSimulation,
  simulatePositionLifecycle,
  TokenCandidateInput,
} from './quantEngine';

const SAFE_TOKEN: TokenCandidateInput = {
  mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  symbol: 'QUANT',
  name: 'Quant Cat AI',
  dex: 'RAYDIUM_V4',
  eventKind: 'NEW_POOL',
  creatorAddress: 'SafeDev111111111111111111111111111111111111',
  hasVerifiedPrice: true,
  liquidityUsd: 28500,
  roundTripSpreadPct: 3.2,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  lpBurnedPct: 99.5,
  top10HoldersPct: 14.2,
  devHoldPct: 1.8,
  bundleSupplyPct: 8.5,
  rugcheckRisk: 'Good',
  honeypotPassed: true,
  buyCount: 28,
  sellCount: 6,
  uniqueBuyers: 18,
  devSold: false,
  m5VolumeUsd: 8200,
  h1VolumeUsd: 42000,
  largestBuyerSharePct: 14,
};

test('5-layer anti-rug approves clean liquid token, computes 100 score, and sizes 1% balance risk', () => {
  const res = evaluateTokenCandidate(SAFE_TOKEN, DEFAULT_STRATEGY_CONFIG);
  assert.equal(res.overallApproved, true);
  assert.equal(res.antiRugSafe, true);
  assert.equal(res.marketGatePassed, true);
  assert.equal(res.securityScore, 100);
  assert.equal(res.creatorBlacklisted, false);
  assert.equal(res.orderflowPassed, true);
  assert.equal(res.washTradeSuspected, false);
  assert.ok(res.volumeSpikeRatio >= 2);
  // 10 SOL * 1% risk = 0.10 SOL risk / 0.25 SL = 0.40 SOL * 1.1 = 0.44 SOL
  assert.equal(res.autoSizedBuySol, 0.44);
});

test('balanced 5-layer audit blocks critical rug vectors while ignoring non-critical L3 concentration warning', () => {
  const highTop10Only = evaluateTokenCandidate(
    { ...SAFE_TOKEN, top10HoldersPct: 40 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(highTop10Only.antiRugSafe, true);
  assert.equal(highTop10Only.overallApproved, true);
  assert.equal(highTop10Only.securityScore, 80);

  const blacklisted = evaluateTokenCandidate(
    { ...SAFE_TOKEN, creatorAddress: DEFAULT_STRATEGY_CONFIG.blacklistedCreators[0] },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(blacklisted.overallApproved, false);
  assert.equal(blacklisted.creatorBlacklisted, true);
  assert.equal(blacklisted.securityScore, 0);
  assert.equal(blacklisted.antiRugSafe, false);
});

test('blocks micro-spam wash trades, whale dominance, cold volume, and pump-top spikes', () => {
  const washBotSpam = evaluateTokenCandidate(
    { ...SAFE_TOKEN, buyCount: 65, m5VolumeUsd: 260, h1VolumeUsd: 1200 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(washBotSpam.overallApproved, false);
  assert.equal(washBotSpam.washTradeSuspected, true);
  assert.equal(washBotSpam.orderflowPassed, false);

  const singleWhaleDominance = evaluateTokenCandidate(
    { ...SAFE_TOKEN, largestBuyerSharePct: 68 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(singleWhaleDominance.overallApproved, false);
  assert.equal(singleWhaleDominance.washTradeSuspected, true);

  const coldVolume = evaluateTokenCandidate(
    { ...SAFE_TOKEN, m5VolumeUsd: 400, h1VolumeUsd: 24000 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(coldVolume.overallApproved, false);
  assert.equal(coldVolume.orderflowPassed, false);
  assert.ok(coldVolume.volumeSpikeRatio < 0.5);

  const youngWave2 = evaluateTokenCandidate(
    { ...SAFE_TOKEN, ageMinutes: 18, m5VolumeUsd: 1600, h1VolumeUsd: 60000, buyCount: 15, sellCount: 11 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(youngWave2.orderflowPassed, true);
  assert.equal(youngWave2.overallApproved, true);

  const overextendedTop = evaluateTokenCandidate(
    { ...SAFE_TOKEN, priceChangeM5Pct: 275 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(overextendedTop.orderflowPassed, false);
  assert.equal(overextendedTop.overallApproved, false);

  const fallingKnife = evaluateTokenCandidate(
    { ...SAFE_TOKEN, priceChangeM5Pct: -25 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(fallingKnife.orderflowPassed, false);
  assert.equal(fallingKnife.overallApproved, false);
});

test('autonomous 1% balance risk sizing scales cleanly with account balance, liquidity, heat, and daily loss %', () => {
  // 10 SOL equity, 1% risk (0.10 SOL), 25% SL => 0.40 SOL base * 1.2x (100 sec + 65k liq) = 0.48 SOL
  const bal10 = computeDynamicPositionSize({
    availableBalanceSol: 10.0,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0.05,
    securityScore: 100,
    liquidityUsd: 65000,
    cfg: DEFAULT_STRATEGY_CONFIG,
  });
  assert.equal(bal10.allowed, true);
  assert.equal(bal10.multiplier, 1.2);
  assert.equal(bal10.sizedBuySol, 0.48);
  assert.equal(bal10.riskPctOfBalance, 1.2);

  // 2 SOL equity, 1% risk (0.02 SOL), 25% SL => 0.08 SOL base * 0.75 (shallow $10k pool) = 0.06 SOL
  const shallowSmallBal = computeDynamicPositionSize({
    availableBalanceSol: 2.0,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0,
    securityScore: 100,
    liquidityUsd: 10_000,
    cfg: DEFAULT_STRATEGY_CONFIG,
  });
  assert.equal(shallowSmallBal.allowed, true);
  assert.equal(shallowSmallBal.multiplier, 0.75);
  assert.equal(shallowSmallBal.sizedBuySol, 0.06);

  const heatBlocked = computeDynamicPositionSize({
    availableBalanceSol: 0.65,
    openExposureSol: 0.35,
    dailyRealizedPnlSol: 0,
    securityScore: 100,
    liquidityUsd: 50_000,
    cfg: DEFAULT_STRATEGY_CONFIG,
  });
  assert.equal(heatBlocked.allowed, false);
  assert.equal(heatBlocked.heatLimitHit, true);

  // Daily loss >= -5% of 10 SOL (-0.50 SOL) stops auto-sniping
  const dailyLossBlocked = computeDynamicPositionSize({
    availableBalanceSol: 10.0,
    openExposureSol: 0,
    dailyRealizedPnlSol: -0.52,
    securityScore: 100,
    liquidityUsd: 50_000,
    cfg: DEFAULT_STRATEGY_CONFIG,
  });
  assert.equal(dailyLossBlocked.allowed, false);
  assert.equal(dailyLossBlocked.dailyLossHit, true);
});

test('dynamic Jito tip scales with live tip floor + urgency and stays within fee caps', () => {
  const highConv = computeDynamicJitoTip({
    baseTipSol: 0.001,
    buyAmountSol: 0.2,
    maxFeeRatioPct: 6,
    dynamicEnabled: true,
    urgency: 'HIGH_CONVICTION',
    liveTipFloorSol: 0.0014,
  });
  assert.equal(highConv.source, 'JITO_FLOOR_API');
  assert.ok(highConv.tipSol > 0.0015 && highConv.tipSol <= 0.006);

  const budgetCapped = computeDynamicJitoTip({
    baseTipSol: 0.001,
    buyAmountSol: 0.02,
    maxFeeRatioPct: 6,
    dynamicEnabled: true,
    urgency: 'NORMAL',
    liveTipFloorSol: 0.003,
  });
  assert.equal(budgetCapped.cappedByBudget, true);
  assert.ok(budgetCapped.tipSol <= 0.0005);
});

test('post-trade reconciliation computes exact wallet SOL delta and slippage drift', () => {
  const buyRecon = computePostTradeReconciliation({
    side: 'BUY',
    expectedSolUi: 0.05,
    preLamports: 1_000_000_000,
    postLamports: 947_550_000,
    feeLamports: 200_000,
    tipSol: 0.001,
    preTokenUi: 0,
    postTokenUi: 500_000,
  });
  assert.equal(buyRecon.reconciled, true);
  assert.equal(buyRecon.actualTokenDeltaUi, 500_000);
  assert.equal(buyRecon.actualSolUi, 0.05125);
  assert.equal(buyRecon.slippageDiffPct, 2.5);
});

test('blocks unverified price, low liquidity, wide spread, and raw Pump.fun Create by default', () => {
  const unpriced = evaluateTokenCandidate(
    { ...SAFE_TOKEN, hasVerifiedPrice: false },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(unpriced.overallApproved, false);
  assert.equal(unpriced.marketGatePassed, false);

  const lowLiq = evaluateTokenCandidate(
    { ...SAFE_TOKEN, liquidityUsd: 1500 },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(lowLiq.overallApproved, false);

  const rawPump = evaluateTokenCandidate(
    { ...SAFE_TOKEN, dex: 'PUMP_FUN', eventKind: 'NEW_POOL' },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(rawPump.overallApproved, false);

  const pumpMigration = evaluateTokenCandidate(
    { ...SAFE_TOKEN, dex: 'PUMP_FUN', eventKind: 'MIGRATION' },
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(pumpMigration.overallApproved, true);
});

test('5-layer anti-rug blocks honeypot, active mint authority, and weak 1-buy orderflow', () => {
  const rugToken: TokenCandidateInput = {
    ...SAFE_TOKEN,
    mintAuthorityRevoked: false,
    honeypotPassed: false,
    bundleSupplyPct: 45,
    buyCount: 1,
    uniqueBuyers: 1,
  };
  const res = evaluateTokenCandidate(rugToken, DEFAULT_STRATEGY_CONFIG);
  assert.equal(res.overallApproved, false);
  assert.equal(res.antiRugSafe, false);
  assert.equal(res.orderflowPassed, false);
  assert.equal(res.securityScore, 0);
  assert.ok(res.rejectionReasons.length >= 4);
});

test('fee ratio guard prevents excessive fee bleed on small balances', () => {
  const feePlan = computeEffectiveFees(0.01, 0.002, 6);
  assert.ok(feePlan.feeRatioPct <= 6.5);
  assert.ok(feePlan.effectiveJitoTipSol < 0.002);
});

test('multi-tier TP1 (+45%) and trailing SL ratchet work accurately with auto 1%-risk sizing', () => {
  const steps = [
    { minute: 1, priceMultiplier: 1.25 },
    { minute: 2, priceMultiplier: 1.52 },
    { minute: 4, priceMultiplier: 1.28 },
  ];
  const sim = simulatePositionLifecycle(steps, {
    ...DEFAULT_STRATEGY_CONFIG,
    trailingTpEnabled: false,
  });
  assert.equal(sim.positionSizeSol, 0.44);
  assert.equal(sim.tp1Hit, true);
  assert.equal(sim.trailingActive, true);
  assert.equal(sim.closed, true);
  assert.equal(sim.closeReason, 'TRAILING_SL');
  assert.ok(sim.netPnlSol > 0);
});

test('break-even lock protects +20% pump that pulls back instead of hitting -25% hard SL', () => {
  const steps = [
    { minute: 1, priceMultiplier: 1.22 },
    { minute: 3, priceMultiplier: 1.05 },
    { minute: 4, priceMultiplier: 0.6 },
  ];
  const sim = simulatePositionLifecycle(steps, DEFAULT_STRATEGY_CONFIG);
  assert.equal(sim.breakevenArmed, true);
  assert.equal(sim.closed, true);
  assert.equal(sim.closeReason, 'BREAKEVEN_SL');
  assert.ok(sim.netPnlSol >= 0);
});

test('trailing TP arms at TP1 (+45%) and captures extended parabolic pump before pullback', () => {
  const steps = [
    { minute: 1, priceMultiplier: 1.55 },
    { minute: 2, priceMultiplier: 2.3 },
    { minute: 3, priceMultiplier: 2.05 },
  ];
  const simWithTrailingTp = simulatePositionLifecycle(steps, {
    ...DEFAULT_STRATEGY_CONFIG,
    trailingTpEnabled: true,
    trailingTpCallbackPct: 8,
  });
  const simInstantTp = simulatePositionLifecycle(steps, {
    ...DEFAULT_STRATEGY_CONFIG,
    trailingTpEnabled: false,
  });
  assert.equal(simWithTrailingTp.tp1TrailingArmed, true);
  assert.equal(simWithTrailingTp.tp1Hit, true);
  assert.equal(simWithTrailingTp.events[0].action, 'TP1_TRAILING');
  assert.ok(simWithTrailingTp.netPnlSol > simInstantTp.netPnlSol);
});

test('RUG_DRAIN triggers at 5 unquotable ticks or liquidity drop below 35%', () => {
  const liqDrainSim = simulatePositionLifecycle(
    [{ minute: 1, priceMultiplier: 0.72, liquidityRatio: 0.28 }],
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(liqDrainSim.closed, true);
  assert.equal(liqDrainSim.closeReason, 'RUG_DRAIN');
  assert.ok(liqDrainSim.realizedSol > 0);

  const unquotableSim = simulatePositionLifecycle(
    [{ minute: 1, priceMultiplier: 1.0, unquotableTicks: 5 }],
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(unquotableSim.closed, true);
  assert.equal(unquotableSim.closeReason, 'RUG_DRAIN');
});

test('hard SL (-25%), early momentum cut (6m / -15%), and time exit (12m sideways) work cleanly', () => {
  const slSim = simulatePositionLifecycle(
    [{ minute: 2, priceMultiplier: 0.72 }],
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(slSim.closed, true);
  assert.equal(slSim.closeReason, 'HARD_SL');

  const earlyCutSim = simulatePositionLifecycle(
    [{ minute: 6, priceMultiplier: 0.84 }],
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(earlyCutSim.closed, true);
  assert.equal(earlyCutSim.closeReason, 'HARD_SL');

  const timeSim = simulatePositionLifecycle(
    [
      { minute: 5, priceMultiplier: 1.06 },
      { minute: 12, priceMultiplier: 1.03 },
    ],
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(timeSim.closed, true);
  assert.equal(timeSim.closeReason, 'TIME_EXIT');
});

test('analytics summary computes Balance Curve from starting balance, peak balance, return %, and drawdown', () => {
  const summary = computeAnalyticsSummary(
    [
      { symbol: 'A', netPnlSol: 0.12, timestamp: 1 },
      { symbol: 'B', netPnlSol: -0.04, timestamp: 2 },
      { symbol: 'C', netPnlSol: -0.02, timestamp: 3 },
      { symbol: 'D', netPnlSol: 0.18, timestamp: 4 },
    ],
    10,
  );
  assert.equal(summary.totalClosed, 4);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 2);
  assert.equal(summary.winRatePct, 50);
  assert.equal(summary.profitFactor, 5);
  assert.equal(summary.initialBalanceSol, 10);
  assert.equal(summary.currentBalanceSol, 10.24);
  assert.equal(summary.peakBalanceSol, 10.24);
  assert.equal(summary.netReturnPct, 2.4);
  assert.equal(summary.maxDrawdownSol, 0.06);
  assert.equal(summary.balanceCurve[0].balanceSol, 10);
  assert.equal(summary.balanceCurve[4].balanceSol, 10.24);
});

test('applyStrategyPreset MAX_THROUGHPUT unlocks borderline launches and increases order throughput', () => {
  const borderlineLaunch: TokenCandidateInput = {
    ...SAFE_TOKEN,
    liquidityUsd: 4200,
    roundTripSpreadPct: 18,
    lpBurnedPct: 40,
    bundleSupplyPct: 42,
    honeypotPassed: false,
    buyCount: 2,
    sellCount: 1,
    uniqueBuyers: 2,
    m5VolumeUsd: 180,
    h1VolumeUsd: 900,
    largestBuyerSharePct: 68,
    priceChangeM5Pct: 290,
  };

  const balancedEval = evaluateTokenCandidate(borderlineLaunch, DEFAULT_STRATEGY_CONFIG);
  assert.equal(balancedEval.overallApproved, false);

  const maxThroughputCfg = applyStrategyPreset(DEFAULT_STRATEGY_CONFIG, 'MAX_THROUGHPUT');
  const maxEval = evaluateTokenCandidate(borderlineLaunch, maxThroughputCfg);
  assert.equal(maxEval.overallApproved, true);
  assert.equal(maxEval.antiRugSafe, true);
  assert.equal(maxEval.marketGatePassed, true);
  assert.equal(maxEval.orderflowPassed, true);

  const strictCfg = applyStrategyPreset(maxThroughputCfg, 'STRICT_SAFE');
  assert.equal(strictCfg.honeypotSimEnabled, true);
  assert.equal(strictCfg.lpLockCheckEnabled, true);
  assert.equal(strictCfg.minLiquidityUsd, 12000);
});

test('granular security, orderflow, exit, and circuit breaker toggles work independently', () => {
  // Disabling washTradeGuardEnabled & momentumFilterEnabled individually
  const spamNoGuard = evaluateTokenCandidate(
    { ...SAFE_TOKEN, largestBuyerSharePct: 72, priceChangeM5Pct: 300 },
    { ...DEFAULT_STRATEGY_CONFIG, washTradeGuardEnabled: false, momentumFilterEnabled: false },
  );
  assert.equal(spamNoGuard.orderflowPassed, true);
  assert.equal(spamNoGuard.overallApproved, true);

  // Disabling spreadGuardEnabled allows wider spread launches
  const wideSpreadPass = evaluateTokenCandidate(
    { ...SAFE_TOKEN, roundTripSpreadPct: 24 },
    { ...DEFAULT_STRATEGY_CONFIG, spreadGuardEnabled: false },
  );
  assert.equal(wideSpreadPass.marketGatePassed, true);

  // Disabling circuitBreakerEnabled bypasses daily loss cap
  const noBreakerSizing = computeDynamicPositionSize({
    availableBalanceSol: 10,
    openExposureSol: 0,
    dailyRealizedPnlSol: -1.5,
    securityScore: 100,
    liquidityUsd: 50_000,
    cfg: { ...DEFAULT_STRATEGY_CONFIG, circuitBreakerEnabled: false },
  });
  assert.equal(noBreakerSizing.allowed, true);
  assert.equal(noBreakerSizing.dailyLossHit, false);

  // Disabling breakevenLockEnabled, earlyMomentumCutEnabled, timeExitEnabled in position lifecycle
  const noEarlyExitSim = simulatePositionLifecycle(
    [
      { minute: 1, priceMultiplier: 1.22 },
      { minute: 6, priceMultiplier: 0.84 },
      { minute: 12, priceMultiplier: 1.03 },
    ],
    {
      ...DEFAULT_STRATEGY_CONFIG,
      breakevenLockEnabled: false,
      earlyMomentumCutEnabled: false,
      timeExitEnabled: false,
    },
  );
  assert.equal(noEarlyExitSim.closed, false);
  assert.equal(noEarlyExitSim.closeReason, null);
  assert.equal(DEFAULT_STRATEGY_CONFIG.autoDeleteEntryMsgEnabled, true);
  assert.equal(
    applyStrategyPreset({ ...DEFAULT_STRATEGY_CONFIG, autoDeleteEntryMsgEnabled: false }, 'MAX_THROUGHPUT')
      .autoDeleteEntryMsgEnabled,
    false,
  );
});

test('v7 AI Token Intelligence calibrates probabilities and shrinks confidence on unverified data', () => {
  const bullRegime = detectMarketRegime({ regimeOverride: 'BULLISH' });
  assert.equal(bullRegime.recommendedStrategy, 'EARLY_MOMENTUM');

  const evalSafe = evaluateTokenCandidate(SAFE_TOKEN, DEFAULT_STRATEGY_CONFIG);
  const aiVerified = evaluateAiTokenCandidate(SAFE_TOKEN, DEFAULT_STRATEGY_CONFIG, evalSafe, {
    regime: bullRegime,
    dataConfidencePct: 95,
  });
  const aiUnverified = evaluateAiTokenCandidate(SAFE_TOKEN, DEFAULT_STRATEGY_CONFIG, evalSafe, {
    regime: bullRegime,
    dataConfidencePct: 35,
  });

  assert.equal(aiVerified.passed, true);
  assert.ok(aiVerified.tokenQualityScore >= 60);
  assert.ok(aiVerified.calibratedConfidence > aiUnverified.calibratedConfidence);
  assert.ok(
    Math.abs(aiUnverified.pumpProbability - 0.5) < Math.abs(aiVerified.pumpProbability - 0.5),
  );
  assert.equal(aiVerified.narrative, 'AI_AGENT');
  const dogAi = evaluateAiTokenCandidate(
    { ...SAFE_TOKEN, symbol: 'WIFCAT', name: 'Solana Doge Cat' },
    DEFAULT_STRATEGY_CONFIG,
    evalSafe,
    { regime: bullRegime },
  );
  assert.equal(dogAi.narrative, 'CAT_DOG');
});

test('v7 Market Regime Guard & Adaptive Entry Engine rank 5 strategies and block late-chase tops', () => {
  const bearRegime = detectMarketRegime({ regimeOverride: 'BEARISH' });
  const bullRegime = detectMarketRegime({ regimeOverride: 'BULLISH' });
  assert.ok(bearRegime.minAiScoreThreshold > bullRegime.minAiScoreThreshold);

  const evalSafe = evaluateTokenCandidate(SAFE_TOKEN, DEFAULT_STRATEGY_CONFIG);
  const aiSafe = evaluateAiTokenCandidate(SAFE_TOKEN, DEFAULT_STRATEGY_CONFIG, evalSafe, {
    regime: bullRegime,
  });
  const entrySafe = evaluateAdaptiveEntry(
    SAFE_TOKEN,
    aiSafe,
    evalSafe,
    bullRegime,
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(entrySafe.approved, true);
  assert.equal(Object.keys(entrySafe.strategyScores).length, 5);

  const lateToken: TokenCandidateInput = { ...SAFE_TOKEN, priceChangeM5Pct: 145 };
  const evalLate = evaluateTokenCandidate(lateToken, DEFAULT_STRATEGY_CONFIG);
  const aiLate = evaluateAiTokenCandidate(lateToken, DEFAULT_STRATEGY_CONFIG, evalLate, {
    regime: bullRegime,
  });
  const entryLate = evaluateAdaptiveEntry(
    lateToken,
    aiLate,
    evalLate,
    bullRegime,
    DEFAULT_STRATEGY_CONFIG,
  );
  assert.equal(aiLate.entryTiming, 'LATE_CHASE');
  assert.equal(entryLate.approved, false);
  assert.ok(entryLate.reasons.some((r) => r.includes('Late-chase')));
});

test('v7 Risk Sizing enforces liquidity-adjusted pool cap and weekly loss limit', () => {
  // Huge 200 SOL balance on tiny $6,000 pool should cap order to ~3% of pool depth (1.2 SOL)
  const liqCapped = computeDynamicPositionSize({
    availableBalanceSol: 200,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0,
    weeklyRealizedPnlSol: 0,
    securityScore: 100,
    liquidityUsd: 6000,
    cfg: DEFAULT_STRATEGY_CONFIG,
  });
  assert.equal(liqCapped.allowed, true);
  assert.equal(liqCapped.liquidityCapSol, 1.2);
  assert.ok(liqCapped.sizedBuySol <= 1.2);
  assert.ok(liqCapped.estimatedExitSlippagePct > liqCapped.estimatedPriceImpactPct);

  const weeklyBlocked = computeDynamicPositionSize({
    availableBalanceSol: 10,
    openExposureSol: 0,
    dailyRealizedPnlSol: -0.1,
    weeklyRealizedPnlSol: -1.25,
    securityScore: 100,
    liquidityUsd: 40_000,
    cfg: DEFAULT_STRATEGY_CONFIG,
  });
  assert.equal(weeklyBlocked.allowed, false);
  assert.equal(weeklyBlocked.weeklyLossHit, true);
});

test('v7 Walk-Forward Backtest & Monte Carlo runs deterministically with fees and slippage', () => {
  const report = runWalkForwardBacktestSimulation(DEFAULT_STRATEGY_CONFIG, {
    seed: 202607,
    sampleCount: 60,
  });
  assert.equal(report.sampleSize, 60);
  assert.ok(report.totalTrades > 0);
  assert.ok(report.totalFeesSol > 0);
  assert.ok(report.totalSlippageCostSol > 0);
  assert.ok(report.monteCarloWorstDdPct >= 0);
  assert.equal(Object.keys(report.byStrategy).length, 5);
});

test('balanced 5-buy Free Feed default estimate passes minUniqueBuyers=4 without dead zone', () => {
  const fiveBuyToken: TokenCandidateInput = {
    ...SAFE_TOKEN,
    buyCount: 5,
    sellCount: 1,
    uniqueBuyers: undefined,
    m5VolumeUsd: 1100,
    h1VolumeUsd: 2400,
  };
  const res = evaluateTokenCandidate(fiveBuyToken, DEFAULT_STRATEGY_CONFIG);
  assert.equal(res.orderflowPassed, true);
  assert.equal(res.overallApproved, true);
});

