import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialDataUsage,
  decodeCompactLiveFeed,
  detectBrowserNetworkInterface,
  recordDataUsage,
  resolveEffectiveNetworkPolicy,
} from './networkPolicy';
import {
  applyPaperTradeOutcome,
  createInitialPaperAccount,
  encodeBase58,
  generateInAppSolanaWallet,
  isValidSolanaPublicKey,
  parseImportedSecretKey,
} from './walletManager';
import {
  createInitialRealtimeBacktestState,
  stepRealtimeBacktest,
} from './realtimeBacktest';
import {
  applyStrategyPreset,
  computeEffectiveFees,
  DEFAULT_STRATEGY_CONFIG,
  runWalkForwardBacktestSimulation,
} from './quantEngine';
import {
  DEFAULT_DATA_TRANSPORT_CONFIG,
  fetchDirectSolBalance,
  formatTransportErrorMessage,
  normalizeServerUrl,
  resolveEffectiveTransport,
  validateHttpEndpoint,
} from './dataTransport';
import { mapCapacitorNetworkStatus } from './nativeNetwork';
import {
  appendPriceTick,
  buildSparklineSeries,
  computePositionMetrics,
  createInitialSniperTerminalState,
  DEFAULT_SNIPE_SETTINGS,
  executeSnipeOrder,
  isPositionAdjusting,
  MAX_SPARKLINE_TICKS,
  panicSellAllPositions,
  SAMPLE_MEMPOOL_PAIRS,
  scanContractInfo,
  seedPositionPriceHistory,
  sellPositionFraction,
  stepPositionExecutionPhase,
  tickSniperPositions,
} from './sniperTerminal';
import { buildDefaultOtaBundle, validateOtaHotUpdate } from './otaHotUpdate';

test('Wi-Fi Only Lock pauses scanning when cellular/4G is detected or forced', () => {
  const detected = detectBrowserNetworkInterface({ type: 'cellular', effectiveType: '4g' });
  assert.equal(detected, 'CELLULAR_4G');

  const desktopChromeDefault = detectBrowserNetworkInterface({
    effectiveType: '4g',
    downlink: 10,
    saveData: false,
  });
  assert.equal(desktopChromeDefault, 'UNKNOWN');
  const desktopPolicy = resolveEffectiveNetworkPolicy({
    policyMode: 'WIFI_ONLY_LOCK',
    detectedKind: desktopChromeDefault,
    override: 'AUTO',
    isOnline: true,
  });
  assert.equal(desktopPolicy.effectiveKind, 'WIFI');
  assert.equal(desktopPolicy.scanningAllowed, true);

  assert.equal(detectBrowserNetworkInterface({ saveData: true }), 'CELLULAR_4G');
  assert.equal(detectBrowserNetworkInterface({ effectiveType: '4g', downlink: 2.2 }), 'CELLULAR_4G');

  const locked = resolveEffectiveNetworkPolicy({
    policyMode: 'WIFI_ONLY_LOCK',
    detectedKind: detected,
    override: 'AUTO',
    isOnline: true,
  });
  assert.equal(locked.effectiveKind, 'CELLULAR_4G');
  assert.equal(locked.scanningAllowed, false);
  assert.equal(locked.pollIntervalMs, 0);
  assert.equal(locked.prefetchHeavyAssets, false);

  const saver4g = resolveEffectiveNetworkPolicy({
    policyMode: 'ALLOW_4G_ULTRA_SAVER',
    detectedKind: 'UNKNOWN',
    override: 'FORCE_4G',
    isOnline: true,
  });
  assert.equal(saver4g.scanningAllowed, true);
  assert.equal(saver4g.useCompactPayload, true);
  assert.equal(saver4g.pollIntervalMs, 45_000);
  assert.equal(saver4g.feedLimit, 5);
  assert.equal(saver4g.prefetchHeavyAssets, false);
});

test('Compact 4G feed decoder & byte savings tracker work accurately', () => {
  const decoded = decodeCompactLiveFeed({
    c: 1,
    src: 1,
    r: [
      [
        '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        'SOLCAT',
        0,
        46000,
        36,
        10,
        14.5,
        0.000028,
        12000,
      ],
    ],
  });
  assert.equal(decoded.source, '4G_COMPACT_LIVE');
  assert.equal(decoded.tokens.length, 1);
  assert.equal(decoded.tokens[0].dex, 'RAYDIUM_V4');
  assert.equal(decoded.tokens[0].liquidityUsd, 46000);

  let stats = createInitialDataUsage();
  stats = recordDataUsage(stats, 420, 4200, false);
  stats = recordDataUsage(stats, 0, 4200, true);
  assert.equal(stats.bytesUsed, 420);
  assert.equal(stats.bytesSaved, 7980);
  assert.equal(stats.notModified304Count, 1);
});

test('Wallet manager parses Base58/JSON secret keys, generates burner wallet, and resets paper state', async () => {
  const generated = await generateInAppSolanaWallet();
  assert.equal(isValidSolanaPublicKey(generated.publicKey), true);

  const parsedB58 = parseImportedSecretKey(generated.secretKeyBase58);
  assert.equal(parsedB58.valid, true);
  assert.equal(parsedB58.publicKey, generated.publicKey);

  // Test 64-byte JSON array import
  const pubBytes = new Uint8Array(32).fill(7);
  const fullBytes = new Uint8Array(64).fill(3);
  fullBytes.set(pubBytes, 32);
  const parsedJson = parseImportedSecretKey(JSON.stringify(Array.from(fullBytes)));
  assert.equal(parsedJson.valid, true);
  assert.equal(parsedJson.publicKey, encodeBase58(pubBytes));

  const bad = parseImportedSecretKey('invalid-not-base58-0OIl');
  assert.equal(bad.valid, false);

  let paper = createInitialPaperAccount(10);
  paper = applyPaperTradeOutcome(paper, 0.8);
  paper = applyPaperTradeOutcome(paper, -1.2);
  assert.equal(paper.balanceSol, 9.6);
  assert.equal(paper.maxDrawdownSol, 1.2);
  assert.equal(paper.wins, 1);
  assert.equal(paper.losses, 1);

  const reset = createInitialPaperAccount(10);
  assert.equal(reset.realizedPnlSol, 0);
  assert.equal(reset.maxDrawdownSol, 0);
  assert.equal(reset.balanceSol, 10);
});

test('Realtime backtest opens live position, fires TP1, and auto-deletes entry alert', () => {
  let state = createInitialRealtimeBacktestState(10);
  const cleanSnap = {
    mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'SOLCAT',
    name: 'Solana Quant Cat',
    dex: 'RAYDIUM_V4' as const,
    poolAddress: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
    priceUsd: 0.0042,
    priceSol: 0.000028,
    liquidityUsd: 48000,
    fdvUsd: 420000,
    m5Buys: 34,
    m5Sells: 8,
    m5VolumeUsd: 14000,
    h1VolumeUsd: 52000,
    priceChangeM5Pct: 16,
    ageMinutes: 12,
    updatedAt: Date.now(),
  };

  state = stepRealtimeBacktest(state, [cleanSnap], DEFAULT_STRATEGY_CONFIG, {
    regimeOverride: 'BULLISH',
    feedSource: 'TEST_LIVE',
  });
  assert.equal(state.openPositions.length, 1);
  assert.equal(state.entryOrderAlerts.length, 1);

  // Pump +55% -> TP1 hits and autoDeleteEntryMsgEnabled deletes entry alert
  state = stepRealtimeBacktest(
    state,
    [{ ...cleanSnap, priceSol: 0.0000435, priceUsd: 0.0065 }],
    { ...DEFAULT_STRATEGY_CONFIG, autoDeleteEntryMsgEnabled: true },
    { regimeOverride: 'BULLISH', feedSource: 'TEST_LIVE' },
  );
  assert.equal(state.openPositions[0].tp1Hit, true);
  assert.equal(state.entryOrderAlerts.length, 0);

  // Drop -40% below entry on remaining share -> HARD_SL closes position cleanly
  state = stepRealtimeBacktest(
    state,
    [{ ...cleanSnap, priceSol: 0.000016, priceUsd: 0.0024 }],
    DEFAULT_STRATEGY_CONFIG,
    { regimeOverride: 'BULLISH', feedSource: 'TEST_LIVE' },
  );
  assert.equal(state.openPositions.length, 0);
  assert.equal(state.closedTrades.length, 1);
  assert.equal(state.equityCurve.length, 4);
});

test('Hybrid transport resolves WEB_ORIGIN, DIRECT_ONCHAIN, and CUSTOM_SERVER cleanly for IPA', async () => {
  assert.equal(normalizeServerUrl('https://my-bot.run.app/'), 'https://my-bot.run.app');
  assert.equal(normalizeServerUrl('my-bot.run.app'), 'https://my-bot.run.app');
  assert.equal(normalizeServerUrl('wss://my-bot.run.app/ws/'), 'https://my-bot.run.app/ws');
  assert.equal(normalizeServerUrl('http:// bad host'), '');
  assert.equal(normalizeServerUrl('http://invalid:port'), '');

  assert.equal(validateHttpEndpoint('').valid, true);
  assert.equal(validateHttpEndpoint('https://bad url.com').valid, false);
  assert.equal(validateHttpEndpoint('https://solana-rpc.publicnode.com/').normalized, 'https://solana-rpc.publicnode.com');

  assert.ok(
    formatTransportErrorMessage(new Error('The string did not match the expected pattern.')).includes(
      'URL hoặc phản hồi JSON không hợp lệ',
    ),
  );

  const webAuto = resolveEffectiveTransport(DEFAULT_DATA_TRANSPORT_CONFIG, false);
  assert.equal(webAuto.resolvedMode, 'WEB_ORIGIN');

  const ipaAutoNoServer = resolveEffectiveTransport(DEFAULT_DATA_TRANSPORT_CONFIG, true);
  assert.equal(ipaAutoNoServer.resolvedMode, 'DIRECT_ONCHAIN');

  const ipaCustom = resolveEffectiveTransport(
    { ...DEFAULT_DATA_TRANSPORT_CONFIG, mode: 'CUSTOM_SERVER', serverUrl: 'https://bot.example.com/' },
    true,
  );
  assert.equal(ipaCustom.resolvedMode, 'CUSTOM_SERVER');
  assert.equal(ipaCustom.baseUrl, 'https://bot.example.com');

  const mockRpcFetch = (async () =>
    new Response(JSON.stringify({ jsonrpc: '2.0', result: { value: 2_500_000_000 }, id: 1 }), {
      status: 200,
    })) as unknown as typeof fetch;

  const bal = await fetchDirectSolBalance(
    '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    'https://solana-rpc.publicnode.com',
    mockRpcFetch,
  );
  assert.equal(bal.sol, 2.5);
  assert.equal(bal.source, 'DIRECT_PUBLICNODE_RPC');
});

test('Native Capacitor network mapper translates iOS wifi/cellular/none states accurately', () => {
  assert.deepEqual(mapCapacitorNetworkStatus({ connected: true, connectionType: 'wifi' }), {
    isOnline: true,
    detectedKind: 'WIFI',
  });
  assert.deepEqual(mapCapacitorNetworkStatus({ connected: true, connectionType: 'cellular' }), {
    isOnline: true,
    detectedKind: 'CELLULAR_4G',
  });
  assert.deepEqual(mapCapacitorNetworkStatus({ connected: false, connectionType: 'none' }), {
    isOnline: false,
    detectedKind: 'UNKNOWN',
  });
});

test('SMALL_CAP_HIGH_PF strategy preset improves Profit Factor & lowers fee drag for small accounts', () => {
  const baseSmall = { ...DEFAULT_STRATEGY_CONFIG, accountBalanceSol: 1.5 };
  const highPfSmall = applyStrategyPreset(baseSmall, 'SMALL_CAP_HIGH_PF');

  assert.equal(highPfSmall.smallCapEdgeMode, true);
  assert.ok(highPfSmall.hardSlPct <= 12);
  assert.ok(highPfSmall.tp1Pct <= 35);
  assert.ok(highPfSmall.minAiQualityScore >= 65);

  const feeBase = computeEffectiveFees(0.1, baseSmall.jitoTipSol, baseSmall.maxFeeRatioPct);
  const feeSmallCap = computeEffectiveFees(0.1, highPfSmall.jitoTipSol, highPfSmall.maxFeeRatioPct);
  assert.ok(feeSmallCap.feeRatioPct < feeBase.feeRatioPct);

  const reportBase = runWalkForwardBacktestSimulation(baseSmall, { seed: 202607, sampleCount: 60 });
  const reportHighPf = runWalkForwardBacktestSimulation(highPfSmall, { seed: 202607, sampleCount: 60 });
  assert.ok(reportHighPf.winRatePct >= reportBase.winRatePct);
  assert.ok(reportHighPf.expectancySol > reportBase.expectancySol);
  assert.ok(reportHighPf.netPnlAfterFeesSol > reportBase.netPnlAfterFeesSol);
  assert.ok(reportHighPf.maxDrawdownPct <= reportBase.maxDrawdownPct);
  assert.ok(reportHighPf.profitFactor >= 9.99);
});

test('Sniper terminal handles CA scan, Instant/Auto/Limit orders, partial 50%/100% sells, and Panic Sell All', () => {
  let state = createInitialSniperTerminalState(1_700_000_000_000);
  const initialCount = state.activePositions.length;

  const scanned = scanContractInfo(SAMPLE_MEMPOOL_PAIRS[1].mint, SAMPLE_MEMPOOL_PAIRS);
  assert.ok(scanned);
  assert.equal(scanned.symbol, '$SOLCAT');
  assert.equal(scanned.mintDisabled, true);

  // Instant Snipe
  const buyRes = executeSnipeOrder(state, scanned, { ...DEFAULT_SNIPE_SETTINGS, amountSol: 0.5 }, 1_700_000_005_000);
  state = buyRes.nextState;
  assert.equal(state.activePositions.length, initialCount + 1);
  assert.equal(buyRes.solSpent > 0.5, true);

  // Limit Order
  const limRes = executeSnipeOrder(
    state,
    scanned,
    { ...DEFAULT_SNIPE_SETTINGS, mode: 'LIMIT', amountSol: 0.25, limitTriggerChangePct: -10 },
    1_700_000_006_000,
  );
  state = limRes.nextState;
  assert.equal(limRes.solSpent, 0);
  assert.equal(state.pendingOrders.length, 2);

  // Sell 50%
  const targetPosId = state.activePositions[0].id;
  const sell50 = sellPositionFraction(state, targetPosId, 0.5, 1_700_000_007_000);
  state = sell50.nextState;
  const afterHalf = state.activePositions.find((p) => p.id === targetPosId);
  assert.ok(afterHalf);
  assert.equal(afterHalf.remainingShare, 0.5);
  assert.ok(computePositionMetrics(afterHalf).remainingSolBasis > 0);

  // Panic Sell All closes every open position & pending order
  const panic = panicSellAllPositions(state, 1_700_000_008_000);
  assert.equal(panic.nextState.activePositions.length, 0);
  assert.equal(panic.nextState.pendingOrders.length, 0);
  assert.ok(panic.totalRecoveredSol > 0);
  assert.ok(panic.nextState.logs[0].message.includes('PANIC SELL ALL'));
});

test('Active Positions track slippage & fee-adjustment phases and settle cleanly across ticks', () => {
  const t0 = 1_700_000_000_000;
  let state = createInitialSniperTerminalState(t0);
  const adjustingInit = state.activePositions.find((p) => isPositionAdjusting(p));
  assert.ok(adjustingInit);
  assert.equal(adjustingInit.executionPhase, 'FEE_ADJUSTING');

  const scanned = scanContractInfo(SAMPLE_MEMPOOL_PAIRS[0].mint, SAMPLE_MEMPOOL_PAIRS);
  assert.ok(scanned);

  // Higher priority tip starts in SLIPPAGE_CHECK
  const exec = executeSnipeOrder(
    state,
    scanned,
    { ...DEFAULT_SNIPE_SETTINGS, priorityFeeSol: 0.0005, slippagePct: 10 },
    t0,
  );
  state = exec.nextState;
  const newest = state.activePositions[0];
  assert.equal(newest.executionPhase, 'SLIPPAGE_CHECK');
  assert.equal(isPositionAdjusting(newest), true);

  // Advance +5.5s -> moves from SLIPPAGE_CHECK to FEE_ADJUSTING
  const step1 = stepPositionExecutionPhase(newest, newest.currentPriceSol, t0 + 5_500);
  assert.equal(step1.executionPhase, 'FEE_ADJUSTING');

  // Advance +13s in tickSniperPositions -> transitions to FEE_ADJUSTING
  state = tickSniperPositions(state, SAMPLE_MEMPOOL_PAIRS, undefined, t0 + 13_000);
  assert.equal(state.activePositions[0].executionPhase, 'FEE_ADJUSTING');
  // Advance +26s total -> settles cleanly to CONFIRMED
  state = tickSniperPositions(state, SAMPLE_MEMPOOL_PAIRS, undefined, t0 + 26_000);
  assert.equal(state.activePositions[0].executionPhase, 'CONFIRMED');
  assert.equal(isPositionAdjusting(state.activePositions[0]), false);
});

test('Active Position 10-tick priceHistory seeds accurately and caps rolling window at 10 ticks', () => {
  const seeded = seedPositionPriceHistory(0.004, 0.005, MAX_SPARKLINE_TICKS);
  assert.equal(seeded.length, 10);
  assert.equal(seeded[9], 0.005);

  let state = createInitialSniperTerminalState(1_700_000_000_000);
  for (const pos of state.activePositions) {
    const series = buildSparklineSeries(pos);
    assert.equal(series.length, 10);
    assert.equal(series[9].label, 'Now');
  }

  for (let i = 1; i <= 6; i++) {
    state = tickSniperPositions(state, [], undefined, 1_700_000_000_000 + i * 4_000);
  }
  for (const pos of state.activePositions) {
    assert.equal(pos.priceHistory?.length, 10);
  }

  const appended = appendPriceTick(seeded, 0.006, 0.004);
  assert.equal(appended.length, 10);
  assert.equal(appended[9], 0.006);
  assert.equal(appended[0], seeded[1]);
});

test('OTA Hot-Update validator accepts valid bundle, clamps risk bounds, and rejects invalid schemas', () => {
  const bundle = buildDefaultOtaBundle();
  const ok = validateOtaHotUpdate(bundle);
  assert.equal(ok.valid, true);
  assert.equal(ok.bundle?.strategyPatch.smallCapEdgeMode, true);

  const clamped = validateOtaHotUpdate({
    ...bundle,
    strategyPatch: { ...bundle.strategyPatch, riskPerTradePct: 99, hardSlPct: 1 },
  });
  assert.equal(clamped.valid, true);
  assert.equal(clamped.bundle?.strategyPatch.riskPerTradePct, 5);
  assert.equal(clamped.bundle?.strategyPatch.hardSlPct, 5);

  const bad = validateOtaHotUpdate({ schema: 'wrong', version: '1.0' });
  assert.equal(bad.valid, false);
});
