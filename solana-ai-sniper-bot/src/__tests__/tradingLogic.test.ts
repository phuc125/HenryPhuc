import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

interface StubControl {
  axiosGetMock: (url: string, config?: unknown) => Promise<{ data: unknown }>;
  axiosPostMock: (url: string, body?: unknown, config?: unknown) => Promise<{ data: unknown }>;
}

const stubControl: StubControl = {
  axiosGetMock: async () => ({ data: {} }),
  axiosPostMock: async () => ({ data: {} }),
};

// Install lightweight stubs ONLY for external packages not present in container test runs
const moduleApi = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
};

const originalLoad = moduleApi._load;
const originalResolve = moduleApi._resolveFilename;

const MOCKED_MODULES = new Set([
  'axios',
  '@solana/web3.js',
  '@solana/spl-token',
  '@jup-ag/api',
  '@raydium-io/raydium-sdk-v2',
  'better-sqlite3',
  'bs58',
  'dotenv',
]);

function hasPackageInstalled(name: string): boolean {
  try {
    originalResolve.call(Module, name, module, false);
    return true;
  } catch {
    return false;
  }
}

class StubPublicKey {
  private readonly addr: string;
  constructor(value: string | Uint8Array) {
    this.addr = typeof value === 'string' ? value : '11111111111111111111111111111111';
  }
  public toBase58(): string {
    return this.addr;
  }
  public equals(other: { toBase58?: () => string }): boolean {
    return other?.toBase58?.() === this.addr;
  }
}

const TOKEN_PROGRAM_ID = new StubPublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_ID = new StubPublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const stubModules: Record<string, unknown> = {
  axios: {
    default: {
      get: (url: string, config?: unknown) => stubControl.axiosGetMock(url, config),
      post: (url: string, body?: unknown, config?: unknown) => stubControl.axiosPostMock(url, body, config),
      isAxiosError: (err: unknown) =>
        Boolean(err && typeof err === 'object' && 'isAxiosError' in err),
    },
    get: (url: string, config?: unknown) => stubControl.axiosGetMock(url, config),
    post: (url: string, body?: unknown, config?: unknown) => stubControl.axiosPostMock(url, body, config),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && 'isAxiosError' in err),
  },
  '@solana/web3.js': {
    PublicKey: StubPublicKey,
    Connection: class StubConnection {},
    Keypair: {
      generate: () => ({
        publicKey: new StubPublicKey('HotWa11et1111111111111111111111111111111111'),
        secretKey: new Uint8Array(64),
      }),
    },
    SystemProgram: {
      transfer: (params: unknown) => ({ type: 'TRANSFER', params }),
    },
    Transaction: class StubTransaction {
      public instructions: unknown[] = [];
      public add(...ixs: unknown[]) {
        this.instructions.push(...ixs);
        return this;
      }
    },
    sendAndConfirmTransaction: async () => 'MockTreasuryTxSig111111111111111111111111111',
    VersionedTransaction: { deserialize: () => ({}) },
    TransactionMessage: class {},
    ComputeBudgetProgram: {},
    AddressLookupTableAccount: class {},
    LAMPORTS_PER_SOL: 1_000_000_000,
  },
  '@solana/spl-token': {
    ExtensionType: {
      PermanentDelegate: 1,
      NonTransferable: 2,
      TransferHook: 3,
      TransferFeeConfig: 4,
    },
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID: TOKEN_2022_ID,
    createCloseAccountInstruction: (
      account: unknown,
      destination: unknown,
      authority: unknown,
      _multiSigners: unknown,
      programId: unknown,
    ) => ({ type: 'CLOSE_ACCOUNT', account, destination, authority, programId }),
    MintLayout: {
      span: 82,
      decode: (buf: Buffer) => ({
        mintAuthorityOption: buf[0] ?? 0,
        freezeAuthorityOption: buf[1] ?? 0,
        decimals: buf[2] ?? 6,
        supply: BigInt(1_000_000_000) * BigInt(1_000_000),
      }),
    },
    unpackMint: () => ({
      mintAuthority: null,
      freezeAuthority: null,
      decimals: 6,
      supply: BigInt(1_000_000_000) * BigInt(1_000_000),
      tlvData: Buffer.alloc(0),
    }),
    getExtensionTypes: () => [],
  },
  'better-sqlite3': class StubDatabase {},
  bs58: { encode: () => '', decode: () => new Uint8Array() },
  dotenv: { config: () => ({}) },
};

moduleApi._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options?: unknown) {
  if (MOCKED_MODULES.has(request) && !hasPackageInstalled(request)) {
    return request;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

moduleApi._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'axios') {
    return stubModules.axios;
  }
  if (MOCKED_MODULES.has(request) && !hasPackageInstalled(request)) {
    return stubModules[request] ?? {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

import type { OrderflowAnalyzer as OrderflowAnalyzerType } from '../filters/orderflow';
import type { AntiRugEngine as AntiRugEngineType } from '../security/antiRug';
import type { RuntimeConfig } from '../config/runtimeConfig';
import type { MarketRegimeSnapshot, PositionRecord } from '../core/types';
import type { RpcManager } from '../core/rpc';
import type { SniperDatabase } from '../analytics/database';
import type { SmartExecutionRouter } from '../execution/router';
import type { RuntimeConfigManager } from '../config/runtimeConfig';

import type { WalletManager } from '../core/wallet';

// Load modules under test dynamically via require() AFTER stubs are active
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  ApiResilienceClient,
  GlobalCooldownError,
  SequentialApiQueue,
  clampResilienceConfig,
  computeRandomJitterMs,
  computeRetryDelayMs,
  parseRetryAfterMs,
  sharedHttpClient,
} = require('../core/httpClient') as typeof import('../core/httpClient');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  TreasuryManager,
  calculateConsolidationPlan,
  filterClosableEmptyTokenAccounts,
} = require('../core/treasury') as typeof import('../core/treasury');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  detectSybilUniformBuys,
  estimateFreeFeedUniqueBuyers,
  OrderflowAnalyzer,
} = require('../filters/orderflow') as typeof import('../filters/orderflow');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AntiRugEngine } = require('../security/antiRug') as typeof import('../security/antiRug');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MultiDexListeners } = require('../listeners/dexListeners') as typeof import('../listeners/dexListeners');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AiIntelligenceEngine } = require('../ai/intelligenceEngine') as typeof import('../ai/intelligenceEngine');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdaptiveEntryEngine } = require('../strategy/entryEngine') as typeof import('../strategy/entryEngine');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { computeDynamicPositionSize } = require('../strategy/riskSizing') as typeof import('../strategy/riskSizing');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PositionManager } = require('../strategy/positionManager') as typeof import('../strategy/positionManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TransactionSimulator } = require('../core/simulation') as typeof import('../core/simulation');

test.beforeEach(() => {
  sharedHttpClient.resetStateForTests();
});

function makeBalancedConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    configVersion: 8,
    tradingMode: 'PAPER',
    discoveryMode: 'FREE_FEED',
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
    aiIntelligenceEnabled: true,
    smartMoneyFilterEnabled: true,
    marketRegimeGuardEnabled: true,
    adaptiveEntryEnabled: true,
    socialIntelligenceEnabled: true,
    continuousLearningEnabled: true,
    snipePumpCreate: false,
    observationDelayMs: 2500,
    minLiquidityUsd: 8000,
    minUniqueBuyers: 4,
    minBuyCount: 5,
    maxRoundtripSpreadPct: 12,
    maxFeeRatioPct: 6,
    entryCooldownMs: 60000,
    maxConsecutiveLosses: 4,
    riskPerTradePct: 1,
    slippageBps: 1200,
    jitoTipSol: 0.001,
    minLpBurnedPct: 90,
    maxTop10HoldersPct: 32,
    maxDevHoldPct: 6,
    maxBundleSupplyPct: 30,
    tp1Pct: 45,
    tp1SellSharePct: 50,
    tp2Pct: 120,
    tp2SellSharePct: 30,
    trailingTpCallbackPct: 8,
    breakevenActivatePct: 18,
    trailingActivatePct: 28,
    trailingCallbackPct: 12,
    hardSlPct: 25,
    timeExitMinutes: 12,
    maxOpenPositions: 6,
    maxSinglePositionPct: 15,
    maxPortfolioHeatPct: 35,
    maxDailyLossPct: 5,
    maxWeeklyLossPct: 12,
    profitProtectionPct: 40,
    rugDrainMissTicks: 5,
    rugDrainLiqRatio: 0.35,
    dynamicJitoTipEnabled: true,
    minVolumeSpikeRatio: 0.5,
    minAiQualityScore: 52,
    minEntryRankScore: 52,
    maxPriceImpactPct: 8.5,
    autoRentReclaimEnabled: true,
    autoConsolidateEnabled: false,
    coldWalletAddress: '',
    consolidateThresholdSol: 2.0,
    consolidateKeepSol: 1.0,
    ...overrides,
  };
}

function makeMintInfo(mintRevoked: boolean, freezeRevoked: boolean, decimals = 6) {
  const buf = Buffer.alloc(82);
  buf[0] = mintRevoked ? 0 : 1;
  buf[1] = freezeRevoked ? 0 : 1;
  buf[2] = decimals;
  return {
    owner: new StubPublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    data: buf,
  };
}

test('Orderflow: Free-Feed unique buyers formula removes 5-6 buy cliff', () => {
  assert.equal(estimateFreeFeedUniqueBuyers(0), 0);
  assert.equal(estimateFreeFeedUniqueBuyers(4), 3);
  assert.equal(estimateFreeFeedUniqueBuyers(5), 4);
  assert.equal(estimateFreeFeedUniqueBuyers(6), 5);
  assert.equal(estimateFreeFeedUniqueBuyers(10), 7);
});

test('Orderflow: Sybil detector avoids false positive on retail round sizes across distant slots', () => {
  const retailSeparated = [
    { wallet: 'W1', solAmount: 0.1, slot: 100 },
    { wallet: 'W2', solAmount: 0.1, slot: 112 },
    { wallet: 'W3', solAmount: 0.1, slot: 128 },
    { wallet: 'W4', solAmount: 0.1, slot: 145 },
  ];
  const retailRes = detectSybilUniformBuys(retailSeparated, false);
  assert.equal(retailRes.sybilSuspected, false);

  const clusteredRetail = [
    { wallet: 'W1', solAmount: 0.1, slot: 200 },
    { wallet: 'W2', solAmount: 0.1, slot: 201 },
    { wallet: 'W3', solAmount: 0.1, slot: 201 },
    { wallet: 'W4', solAmount: 0.1, slot: 202 },
  ];
  const clusterRes = detectSybilUniformBuys(clusteredRetail, true);
  assert.equal(clusterRes.sybilSuspected, true);

  const oddDecimalSybil = [
    { wallet: 'S1', solAmount: 0.137, slot: 300 },
    { wallet: 'S2', solAmount: 0.137, slot: 315 },
    { wallet: 'S3', solAmount: 0.137, slot: 325 },
    { wallet: 'S4', solAmount: 0.137, slot: 340 },
  ];
  const oddRes = detectSybilUniformBuys(oddDecimalSybil, false);
  assert.equal(oddRes.sybilSuspected, true);
});

test('OrderflowAnalyzer reuses fresh prefetch without redundant DexScreener HTTP call & uses live SOL price', async () => {
  let httpCalls = 0;
  stubControl.axiosGetMock = async () => {
    httpCalls++;
    return { data: {} };
  };

  const fakeRpc = { isPaidPlan: () => false } as unknown as RpcManager;
  const fakeDb = {
    getOrderflowHistory: () => [],
    saveOrderflowSnapshot: () => {},
  } as unknown as SniperDatabase;

  const analyzer = new OrderflowAnalyzer(fakeRpc, undefined, fakeDb);
  const res = await analyzer.analyzeEarlyMomentum('Mint1111111111111111111111111111111111111111', undefined, {
    minBuyCount: 5,
    minUniqueBuyers: 4,
    minVolumeSpikeRatio: 0.5,
    prefetchedM5Buys: 5,
    prefetchedM5Sells: 1,
    prefetchedM5VolumeUsd: 1200,
    prefetchedH1VolumeUsd: 2400,
    prefetchedM5PriceChangePct: 18,
    prefetchedLiquidityUsd: 16000,
    prefetchedAtMs: Date.now(),
    solPriceUsd: 200,
  });

  assert.equal(httpCalls, 0);
  assert.equal(res.passed, true);
  assert.equal(res.uniqueBuyers, 4);
  // 1200 * (5/6) = 1000 USD / 200 SOLUSD = 5.0 SOL buy volume
  assert.equal(res.buySolVolume, 5);
});

test('AntiRug: excludes unflagged largest pool vault PDA in RPC fallback & passes fresh pool when L1 is revoked on-chain', async () => {
  stubControl.axiosGetMock = async () => {
    const err = new Error('HTTP 404 RugCheck unindexed') as Error & { response: { status: number } };
    err.response = { status: 404 };
    throw err;
  };

  const fakeConn = {
    getAccountInfo: async () => makeMintInfo(true, true, 6),
    getTokenLargestAccounts: async () => ({
      value: [
        // Holder #0 is a Raydium CPMM/Meteora vault PDA holding 68% with owner != poolAddress
        { address: new StubPublicKey('VaultATA11111111111111111111111111111111111'), uiAmount: 680_000_000 },
        { address: new StubPublicKey('HolderATA1111111111111111111111111111111111'), uiAmount: 35_000_000 },
        { address: new StubPublicKey('HolderATA2222222222222222222222222222222222'), uiAmount: 25_000_000 },
      ],
    }),
    getMultipleParsedAccounts: async () => ({
      value: [
        { data: { parsed: { info: { owner: 'CpmmVaultAuthorityPDA1111111111111111111111' } } } },
        { data: { parsed: { info: { owner: 'UserWallet111111111111111111111111111111111' } } } },
        { data: { parsed: { info: { owner: 'UserWallet222222222222222222222222222222222' } } } },
      ],
    }),
  };

  const fakeRpc = {
    isPaidPlan: () => false,
    getConnection: () => fakeConn,
    withFallback: async <T>(fn: (c: unknown) => Promise<T>) => fn(fakeConn),
  } as unknown as RpcManager;

  const engine = new AntiRugEngine(fakeRpc, new TransactionSimulator());
  const report = await engine.runFiveLayerAudit(
    {
      mint: 'Mint1111111111111111111111111111111111111111',
      dex: 'RAYDIUM_CPMM',
      poolAddress: 'PoolAddress11111111111111111111111111111111',
      creatorAddress: 'CreatorWallet111111111111111111111111111111',
      payerPublicKey: 'PayerWallet11111111111111111111111111111111',
    },
    makeBalancedConfig(),
  );

  assert.equal(report.mintAuthorityRevoked, true);
  assert.equal(report.freezeAuthorityRevoked, true);
  // Vault 68% excluded -> Top10 = (35M + 25M) / 1B = 6%
  assert.equal(report.top10HoldersPct, 6);
  assert.equal(report.overallSafe, true);
  assert.ok(report.dataConfidencePct >= 40);

  // Active MintAuthority MUST always fail strictly
  const unsafeConn = {
    ...fakeConn,
    getAccountInfo: async () => makeMintInfo(false, true, 6),
  };
  const unsafeRpc = {
    isPaidPlan: () => false,
    getConnection: () => unsafeConn,
    withFallback: async <T>(fn: (c: unknown) => Promise<T>) => fn(unsafeConn),
  } as unknown as RpcManager;
  const unsafeEngine = new AntiRugEngine(unsafeRpc, new TransactionSimulator());
  const rugReport = await unsafeEngine.runFiveLayerAudit(
    {
      mint: 'Mint1111111111111111111111111111111111111111',
      dex: 'RAYDIUM_V4',
      payerPublicKey: 'PayerWallet11111111111111111111111111111111',
    },
    makeBalancedConfig(),
  );
  assert.equal(rugReport.overallSafe, false);
  assert.ok(rugReport.securityScore <= 25);
});

test('MultiDexListeners rotates Free Feeds, enforces >=2.5s Gecko spacing, pre-filters junk pools & fails over on 429', async () => {
  const sleepCalls: number[] = [];
  const urlsCalled: string[] = [];
  let activeRequests = 0;
  let maxConcurrentGecko = 0;

  const isoClient = new ApiResilienceClient(
    { initialRetryDelayMs: 5000, maxRetries: 2, globalCooldownMs: 45_000, cacheTtlMs: 8000 },
    async (ms) => {
      sleepCalls.push(ms);
    },
    () => 0.5,
  );

  const mintGood = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const mintJunk = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

  stubControl.axiosGetMock = async (url: string) => {
    urlsCalled.push(url);
    if (url.includes('geckoterminal.com')) {
      activeRequests++;
      maxConcurrentGecko = Math.max(maxConcurrentGecko, activeRequests);
      await new Promise((r) => setTimeout(r, 10));
      activeRequests--;
      return {
        data: {
          data: [
            {
              id: `solana_PoolJunk1111111111111111111111111111111`,
              attributes: {
                address: 'PoolJunk11111111111111111111111111111111111',
                name: 'JUNK / SOL',
                reserve_in_usd: '650',
                transactions: { m5: { buys: 2, sells: 0 } },
              },
              relationships: {
                base_token: { data: { id: `solana_${mintJunk}` } },
                quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } },
                dex: { data: { id: 'raydium' } },
              },
            },
            {
              id: `solana_PoolGood1111111111111111111111111111111`,
              attributes: {
                address: 'PoolGood11111111111111111111111111111111111',
                name: 'GOOD / SOL',
                reserve_in_usd: '14500',
                base_token_price_native_currency: '0.00012',
                transactions: { m5: { buys: 9, sells: 2 } },
                volume_usd: { m5: '3400' },
              },
              relationships: {
                base_token: { data: { id: `solana_${mintGood}` } },
                quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } },
                dex: { data: { id: 'raydium' } },
              },
            },
          ],
        },
      };
    }
    return { data: [] };
  };

  const fakeRpc = { isPaidPlan: () => false } as unknown as RpcManager;
  const listeners = new MultiDexListeners(fakeRpc, 'FREE_FEED', 1200, {
    httpClient: isoClient,
    geckoMinSpacingMs: 2500,
    minDiscoveryLiquidityUsd: 2500,
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
    },
  });
  const emitted: string[] = [];
  listeners.on('listener_error', () => {});
  listeners.on('pool_discovered', (ev) => emitted.push(ev.mint));

  // Polling interval below 5000ms must be clamped to >= 5000ms
  assert.ok(
    (listeners as unknown as { freeFeedPollIntervalMs: number }).freeFeedPollIntervalMs >= 5000,
  );

  // Tick 1 prefers DexScreener, Tick 2 prefers GECKO_NEW, Tick 3 DexScreener, Tick 4 GECKO_TREND
  for (let t = 0; t < 4; t++) {
    await (listeners as unknown as { pollFreeDiscoveryFeeds: () => Promise<void> }).pollFreeDiscoveryFeeds();
  }
  assert.equal(maxConcurrentGecko, 1);
  const newIdx = urlsCalled.findIndex((u) => u.includes('new_pools'));
  const trendIdx = urlsCalled.findIndex((u) => u.includes('trending_pools'));
  assert.ok(newIdx >= 0 && trendIdx > newIdx);
  // Junk ($650) pre-filtered; ONLY valid pool ($14,500) emitted
  assert.deepEqual(emitted, [mintGood]);
  assert.ok(listeners.getScannerStats().prefilterJunkSkipped >= 1);

  // Explicit geckoQueue spacing >= 2500ms check
  await Promise.all([
    (listeners as unknown as { geckoQueue: { enqueue: (fn: () => Promise<void>) => Promise<void> } }).geckoQueue.enqueue(async () => {}),
    (listeners as unknown as { geckoQueue: { enqueue: (fn: () => Promise<void>) => Promise<void> } }).geckoQueue.enqueue(async () => {}),
  ]);
  assert.ok(sleepCalls.some((ms) => ms >= 2400));

  // Simulate 429 on GeckoTerminal -> MUST cool down ONLY GeckoTerminal and FAIL OVER immediately to DexScreener
  isoClient.resetStateForTests();
  urlsCalled.length = 0;
  stubControl.axiosGetMock = async (url: string) => {
    urlsCalled.push(url);
    if (url.includes('geckoterminal.com')) {
      const err = new Error('Request failed with status code 429') as Error & {
        isAxiosError: boolean;
        response: { status: number; headers: Record<string, string> };
      };
      err.isAxiosError = true;
      err.response = { status: 429, headers: { 'retry-after': '42' } };
      throw err;
    }
    return { data: [] };
  };

  // Next tick (tick 5 -> DexScreener, tick 6 -> Gecko which hits 429 & fails over to DexScreener)
  await (listeners as unknown as { pollFreeDiscoveryFeeds: () => Promise<void> }).pollFreeDiscoveryFeeds();
  await (listeners as unknown as { pollFreeDiscoveryFeeds: () => Promise<void> }).pollFreeDiscoveryFeeds();
  const status = listeners.getFreeFeedBackoffStatus();
  assert.ok(status.geckoBackedOffMs >= 30_000);
  assert.equal(status.dexScreenerBackedOffMs, 0);
  assert.ok(urlsCalled.some((u) => u.includes('api.dexscreener.com')));
  assert.ok(listeners.getScannerStats().failovers >= 1);

  // Cooldown test
  assert.equal(listeners.markMintSeen('TokenA'), true);
  assert.equal(listeners.markMintSeen('TokenA'), false);
  listeners.markMintCooldown('TokenA', 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(listeners.markMintSeen('TokenA'), true);
});

test('AI + AdaptiveEntry + RiskSizing: eliminates Free Feed double penalty and sizes using live SOL price', async () => {
  const fakeDb = {
    getActiveAiModel: () => ({
      version: 'v7.0-baseline',
      weightsJson: '{}',
    }),
    logAiDecision: () => {},
  } as unknown as SniperDatabase;

  const aiEngine = new AiIntelligenceEngine(fakeDb);
  const entryEngine = new AdaptiveEntryEngine();
  const cfg = makeBalancedConfig();

  const regime: MarketRegimeSnapshot = {
    regime: 'SIDEWAYS',
    solPriceUsd: 200,
    solChange1hPct: 0.4,
    solChange24hPct: 1.5,
    dexVolume24hUsd: 50_000_000,
    breadthAdvancingPct: 55,
    liquidityFlowRatio: 1.1,
    memecoinSentimentScore: 58,
    volatilityScore: 30,
    recommendedStrategy: 'EARLY_MOMENTUM',
    riskMultiplier: 1.0,
    minAiScoreThreshold: 52,
    updatedAt: Date.now(),
    reason: 'Sideways steady',
  };

  const aiRes = await aiEngine.evaluateCandidate({
    metadata: {
      mint: 'MintAiTest1111111111111111111111111111111111',
      name: 'Solana Quant Cat',
      symbol: 'QCAT',
      decimals: 6,
      description: '',
      twitter: 'https://x.com/test',
      ageMinutes: 4,
    },
    audit: {
      mint: 'MintAiTest1111111111111111111111111111111111',
      overallSafe: true,
      securityScore: 80,
      dataConfidencePct: 80,
      unverifiedLayers: ['L2_LP_BURN'],
      elapsedMs: 120,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      lpBurnedPct: 0,
      lpBurnVerified: false,
      top10HoldersPct: 14,
      devHoldPct: 2,
      bundleSupplyPct: 8,
      sybilScore: 10,
      insiderWalletsCount: 0,
      creatorReputationScore: 78,
      liquidityWithdrawalRiskPct: 25,
      rugcheckScore: 100,
      rugcheckRiskLevel: 'Good',
      honeypotPassed: true,
      layers: [],
    },
    flow: {
      passed: true,
      dataSource: 'FREE_FEED_AGGREGATED',
      reliabilityScore: 0.62,
      buyCount: 14,
      sellCount: 3,
      buyToSellRatio: 4.67,
      devSold: false,
      uniqueBuyers: 10,
      uniqueSellers: 2,
      netSolInflow: 4.5,
      buySolVolume: 5.5,
      sellSolVolume: 1.0,
      cvdSol: 4.5,
      orderflowImbalance: 0.69,
      whaleBuyCount: 1,
      whaleSellCount: 0,
      whaleNetSol: 1.8,
      smartMoneyAccumulation: true,
      smartMoneyDistribution: false,
      sybilSuspected: false,
      sybilScore: 15,
      coordinatedBuyDetected: false,
      avgBuySol: 0.39,
      priceChangeM5Pct: 18,
      volumeSpikeRatio: 2.1,
      reason: 'Healthy FreeFeed Flow',
    },
    smartMoney: {
      smartMoneyScore: 68,
      smartBuyersCount: 1,
      smartSellersCount: 0,
      whaleEntriesCount: 1,
      whaleExitsCount: 0,
      insiderAlert: false,
      coordinatedClusterDetected: false,
      creatorReputationScore: 75,
      netSmartSolFlow: 1.8,
      topMatchedWallets: [],
      reason: 'Smart inflow',
    },
    social: {
      socialScore: 66,
      narrative: 'AI_AGENT',
      twitterPresent: true,
      telegramPresent: false,
      websitePresent: false,
      mentionVelocityPerHr: 12,
      fakeEngagementSuspected: false,
      influencerSignalScore: 40,
      narrativeGrowthScore: 68,
      sentimentScore: 66,
      reason: 'Positive',
    },
    regime,
    liquidityUsd: 24000,
    cfg,
  });

  assert.equal(aiRes.passed, true);
  assert.ok(aiRes.calibratedConfidence >= 0.48);

  const entryDecision = entryEngine.evaluateEntry({
    audit: {
      mint: 'MintAiTest1111111111111111111111111111111111',
      overallSafe: true,
      securityScore: 80,
      dataConfidencePct: 80,
      unverifiedLayers: ['L2_LP_BURN'],
      elapsedMs: 120,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      lpBurnedPct: 0,
      lpBurnVerified: false,
      top10HoldersPct: 14,
      devHoldPct: 2,
      bundleSupplyPct: 8,
      sybilScore: 10,
      insiderWalletsCount: 0,
      creatorReputationScore: 78,
      liquidityWithdrawalRiskPct: 25,
      rugcheckScore: 100,
      rugcheckRiskLevel: 'Good',
      honeypotPassed: true,
      layers: [],
    },
    flow: {
      passed: true,
      dataSource: 'FREE_FEED_AGGREGATED',
      reliabilityScore: 0.62,
      buyCount: 14,
      sellCount: 3,
      buyToSellRatio: 4.67,
      devSold: false,
      uniqueBuyers: 10,
      uniqueSellers: 2,
      netSolInflow: 4.5,
      buySolVolume: 5.5,
      sellSolVolume: 1.0,
      cvdSol: 4.5,
      orderflowImbalance: 0.69,
      whaleBuyCount: 1,
      whaleSellCount: 0,
      whaleNetSol: 1.8,
      smartMoneyAccumulation: true,
      smartMoneyDistribution: false,
      sybilSuspected: false,
      sybilScore: 15,
      coordinatedBuyDetected: false,
      avgBuySol: 0.39,
      priceChangeM5Pct: 18,
      volumeSpikeRatio: 2.1,
      reason: 'Healthy',
    },
    smartMoney: {
      smartMoneyScore: 68,
      smartBuyersCount: 1,
      smartSellersCount: 0,
      whaleEntriesCount: 1,
      whaleExitsCount: 0,
      insiderAlert: false,
      coordinatedClusterDetected: false,
      creatorReputationScore: 75,
      netSmartSolFlow: 1.8,
      topMatchedWallets: [],
      reason: 'OK',
    },
    social: {
      socialScore: 66,
      narrative: 'AI_AGENT',
      twitterPresent: true,
      telegramPresent: false,
      websitePresent: false,
      mentionVelocityPerHr: 12,
      fakeEngagementSuspected: false,
      influencerSignalScore: 40,
      narrativeGrowthScore: 68,
      sentimentScore: 66,
      reason: 'OK',
    },
    ai: aiRes,
    regime,
    snapshot: {
      mint: 'MintAiTest1111111111111111111111111111111111',
      priceSol: 0.0001,
      liquidityUsd: 24000,
      roundTripLossPct: 2.5,
      buyPriceImpactPct: 1.2,
      estimatedExitSlippagePct: 1.5,
      canBuyOnJupiter: true,
      canSellOnJupiter: true,
      decimals: 6,
      source: 'JUPITER_V6',
    },
    liquidityUsd: 24000,
    cfg,
  });

  assert.equal(entryDecision.approved, true);

  // RiskSizing uses live solPriceUsd=200 (10000 * 0.015 / 200 = 0.75 SOL pool cap vs 0.909 at $165)
  const sizingHighSol = computeDynamicPositionSize({
    availableBalanceSol: 500,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0,
    securityScore: 95,
    liquidityUsd: 10_000,
    solPriceUsd: 200,
    cfg,
  });
  assert.equal(sizingHighSol.allowed, true);
  assert.ok(sizingHighSol.sizedBuySol <= 0.75);
});

test('PositionManager reacts to lpDropAlert/dangerAlert, early whale distribution cut at -8%, and post-TP1 floor', async () => {
  const cfg = makeBalancedConfig({ trailingStopEnabled: false });
  const actions: string[] = [];

  const basePos: PositionRecord = {
    id: 1,
    mint: 'MintExitTest11111111111111111111111111111111',
    symbol: 'EXIT',
    dex: 'RAYDIUM_V4',
    poolAddress: 'PoolExit1111111111111111111111111111111111',
    creatorAddress: 'Creator11111111111111111111111111111111111',
    mode: 'PAPER',
    status: 'OPEN',
    entryStrategy: 'EARLY_MOMENTUM',
    marketRegime: 'SIDEWAYS',
    aiScoreAtEntry: 68,
    entryPriceSol: 0.001,
    highestPriceSol: 0.001,
    currentPriceSol: 0.001,
    entryLiquidityUsd: 20_000,
    initialSolSpent: 0.4,
    remainingSolCostBasis: 0.4,
    initialTokenAmount: 400,
    remainingTokenAmount: 400,
    realizedSol: 0,
    tp1Hit: false,
    tp1TrailingArmed: false,
    tp1PeakPriceSol: null,
    tp2Hit: false,
    tp2TrailingArmed: false,
    tp2PeakPriceSol: null,
    breakevenArmed: false,
    trailingActive: false,
    trailingStopPriceSol: null,
    openedAt: Date.now() - 120_000, // 2 minutes old
    closedAt: null,
    closeReason: null,
  };

  // Scenario 1: lpDropAlert triggers RUG_DRAIN at tick 8
  let currentPos = { ...basePos };
  const mockDb = {
    getOpenPositions: () => (currentPos.status === 'OPEN' ? [currentPos] : []),
    updatePositionState: (_id: number, patch: Partial<PositionRecord>) => {
      currentPos = { ...currentPos, ...patch };
    },
    logTrade: () => {},
    blacklistCreator: () => {},
    recordStrategyOutcome: () => {},
    getConsecutiveLossCount: () => 0,
  } as unknown as SniperDatabase;

  let mockPrice = 0.00095;
  const mockRouter = {
    fetchLiveTokenPriceInSol: async () => mockPrice,
    fetchMarketSnapshot: async () => ({ liquidityUsd: 18_000, priceSol: mockPrice }),
    verifyExitRouteQuote: async () => ({ routable: true, expectedSolOut: 0.35, priceSol: mockPrice, slippagePct: 2 }),
    executeSell: async () => ({
      success: true,
      mode: 'PAPER',
      side: 'SELL',
      mint: currentPos.mint,
      dexRoute: 'PAPER_SIM',
      signature: 'SIM_SELL',
      solAmount: 0.35,
      tokenAmountRaw: '400',
      tokenAmountUi: 400,
      executionPriceSol: mockPrice,
      priorityFeeSol: 0.0002,
      jitoTipSol: 0.0005,
    }),
  } as unknown as SmartExecutionRouter;

  const mockCfgMgr = {
    get: () => cfg,
    update: () => cfg,
  } as unknown as RuntimeConfigManager;

  const mockAntiRugLpDrop = {
    reassessOpenPositionSecurity: async () => ({
      safe: false,
      top10HoldersPct: 18,
      lpBurnedPct: 25,
      lpDropAlert: true,
      concentrationSpikeAlert: false,
      mintOrFreezeChangedAlert: false,
      dangerAlert: false,
      reason: 'LP Lock dropped to 25%',
    }),
  } as unknown as AntiRugEngineType;

  const pm1 = new PositionManager(mockDb, mockRouter, mockCfgMgr, undefined, mockAntiRugLpDrop);
  pm1.on('strategy_action', (ev) => actions.push(ev.action));
  for (let t = 0; t < 8; t++) {
    await pm1.evaluateAllOnce();
  }
  assert.equal(actions[0], 'RUG_DRAIN');

  // Scenario 2: Early Whale Distribution cut at -8% PnL (ticks === 6) before -25% Hard SL
  actions.length = 0;
  currentPos = { ...basePos, id: 2, openedAt: Date.now() - 180_000 };
  mockPrice = 0.00092; // -8% PnL
  const mockOrderflowWhaleDump = {
    analyzeEarlyMomentum: async () => ({
      passed: false,
      whaleSellCount: 3,
      whaleNetSol: -7.5,
      smartMoneyDistribution: true,
      orderflowImbalance: -0.65,
    }),
  } as unknown as OrderflowAnalyzerType;

  const pm2 = new PositionManager(mockDb, mockRouter, mockCfgMgr, mockOrderflowWhaleDump);
  pm2.on('strategy_action', (ev) => actions.push(ev.action));
  for (let t = 0; t < 6; t++) {
    await pm2.evaluateAllOnce();
  }
  assert.equal(actions[0], 'WHALE_DISTRIBUTION');

  // Scenario 3: Post-TP1 floor locks BREAKEVEN_SL when trailing is disabled and price pulls back to +2%
  actions.length = 0;
  currentPos = {
    ...basePos,
    id: 3,
    tp1Hit: true,
    breakevenArmed: true,
    trailingActive: false,
    remainingTokenAmount: 200,
    remainingSolCostBasis: 0.2,
    realizedSol: 0.3,
  };
  mockPrice = 0.00102; // +2.0% <= +2.5% floor
  const pm3 = new PositionManager(mockDb, mockRouter, mockCfgMgr);
  pm3.on('strategy_action', (ev) => actions.push(ev.action));
  await pm3.evaluateAllOnce();
  assert.equal(actions[0], 'BREAKEVEN_SL');
});

test('HttpResilience: clamps config, parses Retry-After + 500–2000ms jitter, caps retries, shares 5–10s cache & global 429 cooldown', async () => {
  const clamped = clampResilienceConfig({
    initialRetryDelayMs: 500,
    maxRetries: 9,
    globalCooldownMs: 5_000,
    cacheTtlMs: 1_000,
  });
  assert.equal(clamped.initialRetryDelayMs, 5_000);
  assert.equal(clamped.maxRetries, 3);
  assert.equal(clamped.globalCooldownMs, 30_000);
  assert.equal(clamped.cacheTtlMs, 5_000);

  assert.equal(parseRetryAfterMs({ 'Retry-After': '15' }), 15_000);
  const now = 1_700_000_000_000;
  const httpDate = new Date(now + 20_000).toUTCString();
  assert.equal(parseRetryAfterMs({ 'retry-after': httpDate }, now), 20_000);

  const minJitter = computeRandomJitterMs(500, 2000, () => 0);
  const maxJitter = computeRandomJitterMs(500, 2000, () => 1);
  assert.equal(minJitter, 500);
  assert.equal(maxJitter, 2000);

  const delayWithRetryAfter = computeRetryDelayMs({
    attemptIndex: 0,
    initialRetryDelayMs: 5000,
    retryAfterMs: 12_000,
    rng: () => 0.5,
  });
  assert.equal(delayWithRetryAfter, 13_250); // 12000 + 1250 jitter

  // Bounded retries (maxRetries = 2 -> 3 total attempts) & 5000+ jitter waits
  const retryWaits: number[] = [];
  const client = new ApiResilienceClient(
    { initialRetryDelayMs: 5000, maxRetries: 2, globalCooldownMs: 45_000, cacheTtlMs: 8000 },
    async (ms) => {
      retryWaits.push(ms);
    },
    () => 0.5,
  );

  let transientCalls = 0;
  stubControl.axiosGetMock = async () => {
    transientCalls++;
    const err = new Error('503 Service Unavailable') as Error & { response: { status: number } };
    err.response = { status: 503 };
    throw err;
  };
  await assert.rejects(() => client.get('https://api.example.com/transient'));
  assert.equal(transientCalls, 3); // 1 initial + 2 retries
  assert.equal(retryWaits.length, 2);
  assert.ok(retryWaits[0] >= 5_500 && retryWaits[0] <= 7_000);

  // Shared cache (5-10s) & in-flight deduplication
  let cacheHttpCalls = 0;
  stubControl.axiosGetMock = async () => {
    cacheHttpCalls++;
    await new Promise((r) => setTimeout(r, 15));
    return { data: { price: 1.23 } };
  };
  const [a, b] = await Promise.all([
    client.get<{ price: number }>('https://api.example.com/cached'),
    client.get<{ price: number }>('https://api.example.com/cached'),
  ]);
  const c = await client.get<{ price: number }>('https://api.example.com/cached');
  assert.equal(cacheHttpCalls, 1);
  assert.equal(a.price, 1.23);
  assert.equal(b.price, 1.23);
  assert.equal(c.price, 1.23);

  // Per-host 429 cooldown blocks same host immediately WITHOUT blocking unrelated providers
  stubControl.axiosGetMock = async () => {
    const err = new Error('429 Too Many Requests') as Error & {
      response: { status: number; headers: Record<string, string> };
    };
    err.response = { status: 429, headers: { 'retry-after': '35' } };
    throw err;
  };
  await assert.rejects(() => client.get('https://api.example.com/streamA'));
  assert.equal(client.isGlobalCooldownActive(), true);
  assert.equal(client.isHostCooldownActive('https://api.example.com'), true);
  assert.equal(client.isHostCooldownActive('https://api.other-provider.com'), false);
  assert.ok(client.getGlobalCooldownRemainingMs() >= 30_000);

  let streamBHits = 0;
  let otherHostHits = 0;
  stubControl.axiosGetMock = async (url: string) => {
    if (url.includes('other-provider.com')) {
      otherHostHits++;
      return { data: { ok: true } };
    }
    streamBHits++;
    return { data: {} };
  };
  await assert.rejects(
    () => client.get('https://api.example.com/streamB'),
    (e: unknown) => e instanceof GlobalCooldownError,
  );
  assert.equal(streamBHits, 0);

  const otherRes = await client.get<{ ok: boolean }>('https://api.other-provider.com/health');
  assert.equal(otherRes.ok, true);
  assert.equal(otherHostHits, 1);

  // Sequential queue never overlaps tasks & enforces >= 2500ms wait
  const queueWaits: number[] = [];
  const seq = new SequentialApiQueue(2500, async (ms) => {
    queueWaits.push(ms);
  });
  const order: string[] = [];
  await Promise.all([
    seq.enqueue(async () => {
      order.push('first');
    }),
    seq.enqueue(async () => {
      order.push('second');
    }),
  ]);
  assert.deepEqual(order, ['first', 'second']);
  assert.ok(queueWaits.some((w) => w >= 2450));
});

test('TreasuryManager: reclaims empty SPL/Token-2022 accounts, consolidates surplus to cold wallet & auto-hooks PositionManager full exit', async () => {
  const coldAddr = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const hotAddr = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

  const accounts = [
    {
      pubkey: 'AtaEmptySpl',
      mint: 'ClosedMint111111111111111111111111111111111',
      rawAmount: '0',
      uiAmount: 0,
      lamports: 2_039_280,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    {
      pubkey: 'AtaWsolKeep',
      mint: 'So11111111111111111111111111111111111111112',
      rawAmount: '0',
      uiAmount: 0,
      lamports: 2_039_280,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    {
      pubkey: 'AtaOpenPosition',
      mint: 'OpenMint111111111111111111111111111111111111',
      rawAmount: '0',
      uiAmount: 0,
      lamports: 2_039_280,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    {
      pubkey: 'AtaNonZero',
      mint: 'HeldMint111111111111111111111111111111111111',
      rawAmount: '500000',
      uiAmount: 0.5,
      lamports: 2_039_280,
      programId: TOKEN_2022_ID.toBase58(),
    },
    {
      pubkey: 'AtaEmptyToken2022',
      mint: 'ClosedT22Mint1111111111111111111111111111111',
      rawAmount: '0',
      uiAmount: 0,
      lamports: 2_074_080,
      programId: TOKEN_2022_ID.toBase58(),
    },
  ];

  const closable = filterClosableEmptyTokenAccounts(
    accounts,
    new Set(['OpenMint111111111111111111111111111111111111']),
  );
  assert.deepEqual(
    closable.map((c) => c.mint),
    [
      'ClosedT22Mint1111111111111111111111111111111',
      'ClosedMint111111111111111111111111111111111',
    ],
  );

  // Consolidation plan check
  const invalidPlan = calculateConsolidationPlan({
    liveBalanceSol: 3.5,
    coldWalletAddress: 'bad',
    hotWalletAddress: hotAddr,
    thresholdSol: 2.0,
    keepReserveSol: 1.0,
  });
  assert.equal(invalidPlan.shouldConsolidate, false);

  const validPlan = calculateConsolidationPlan({
    liveBalanceSol: 3.5,
    coldWalletAddress: coldAddr,
    hotWalletAddress: hotAddr,
    thresholdSol: 2.0,
    keepReserveSol: 1.0,
  });
  assert.equal(validPlan.shouldConsolidate, true);
  assert.ok(validPlan.transferSol > 2.49 && validPlan.transferSol < 2.5);

  // TreasuryManager LIVE execution check
  const fakeConn = {
    getParsedTokenAccountsByOwner: async (_owner: unknown, filter: { programId: { toBase58: () => string } }) => ({
      value: accounts
        .filter((a) => a.programId === filter.programId.toBase58())
        .map((a) => ({
          pubkey: new StubPublicKey(a.pubkey),
          account: {
            lamports: a.lamports,
            data: {
              parsed: {
                info: {
                  mint: a.mint,
                  tokenAmount: { amount: a.rawAmount, uiAmount: a.uiAmount },
                },
              },
            },
          },
        })),
    }),
  };

  const fakeRpc = {
    withFallback: async <T>(fn: (c: unknown) => Promise<T>) => fn(fakeConn),
  } as unknown as RpcManager;

  const fakeWallet = {
    isEphemeralPaperWallet: false,
    publicKey: new StubPublicKey(hotAddr),
    keypair: { publicKey: new StubPublicKey(hotAddr), secretKey: new Uint8Array(64) },
    getLiveSolBalance: async () => 3.5,
  } as unknown as WalletManager;

  const treasury = new TreasuryManager(fakeRpc, fakeWallet);
  const reclaimRes = await treasury.reclaimEmptyTokenAccounts({
    mode: 'LIVE',
    openMints: new Set(['OpenMint111111111111111111111111111111111111']),
  });
  assert.equal(reclaimRes.closedCount, 2);
  assert.ok(reclaimRes.reclaimedSol > 0.004);
  assert.equal(reclaimRes.signatures.length, 1);

  const sweepRes = await treasury.consolidateProfitToColdWallet({
    cfg: makeBalancedConfig({
      tradingMode: 'LIVE',
      autoConsolidateEnabled: true,
      coldWalletAddress: coldAddr,
      consolidateThresholdSol: 2.0,
      consolidateKeepSol: 1.0,
    }),
  });
  assert.equal(sweepRes.executed, true);
  assert.ok(sweepRes.transferredSol > 2.49);
  assert.equal(sweepRes.coldWalletAddress, coldAddr);

  // PositionManager automatic treasury hook on full exit
  const cfg = makeBalancedConfig({ autoRentReclaimEnabled: true });
  let openPos: PositionRecord | null = {
    id: 99,
    mint: 'PaperExitMint1111111111111111111111111111111',
    symbol: 'PRNT',
    dex: 'RAYDIUM_V4',
    mode: 'PAPER',
    status: 'OPEN',
    entryPriceSol: 0.001,
    highestPriceSol: 0.001,
    currentPriceSol: 0.001,
    entryLiquidityUsd: 20_000,
    initialSolSpent: 0.2,
    remainingSolCostBasis: 0.2,
    initialTokenAmount: 200,
    remainingTokenAmount: 200,
    realizedSol: 0,
    tp1Hit: false,
    tp1TrailingArmed: false,
    tp1PeakPriceSol: null,
    tp2Hit: false,
    tp2TrailingArmed: false,
    tp2PeakPriceSol: null,
    breakevenArmed: false,
    trailingActive: false,
    trailingStopPriceSol: null,
    openedAt: Date.now() - 60_000,
    closedAt: null,
    closeReason: null,
  };
  const mockDb = {
    getOpenPositions: () => (openPos && openPos.status === 'OPEN' ? [openPos] : []),
    updatePositionState: (_id: number, patch: Partial<PositionRecord>) => {
      if (openPos) openPos = { ...openPos, ...patch };
    },
    logTrade: () => {},
    blacklistCreator: () => {},
    recordStrategyOutcome: () => {},
    getConsecutiveLossCount: () => 0,
    getOpenExposureSol: () => 0,
  } as unknown as SniperDatabase;
  const mockRouter = {
    fetchLiveTokenPriceInSol: async () => 0.0005, // hits Hard SL (-50% <= -25%)
    fetchMarketSnapshot: async () => ({ liquidityUsd: 18_000, priceSol: 0.0005 }),
    verifyExitRouteQuote: async () => ({ routable: true, expectedSolOut: 0.1, priceSol: 0.0005, slippagePct: 2 }),
    executeSell: async () => ({
      success: true,
      mode: 'PAPER',
      side: 'SELL',
      mint: 'PaperExitMint1111111111111111111111111111111',
      dexRoute: 'PAPER_SIM',
      signature: 'SIM_SELL_99',
      solAmount: 0.1,
      tokenAmountRaw: '200',
      tokenAmountUi: 200,
      executionPriceSol: 0.0005,
      priorityFeeSol: 0.0002,
      jitoTipSol: 0.0005,
    }),
  } as unknown as SmartExecutionRouter;
  const pmTreasuryEvents: unknown[] = [];
  const pmHooked = new PositionManager(
    mockDb,
    mockRouter,
    { get: () => cfg, update: () => cfg } as unknown as RuntimeConfigManager,
    undefined,
    undefined,
    treasury,
  );
  pmHooked.on('treasury_action', (ev) => pmTreasuryEvents.push(ev));
  await pmHooked.evaluateAllOnce();
  assert.equal(pmTreasuryEvents.length, 1);
  assert.equal(treasury.getTelemetry().paperAccountsClosed, 1);
});

test('RiskSizing Small-Cap Edge Gate blocks high cost/slippage entries when equity <= 5 SOL', () => {
  const smallCfg = makeBalancedConfig({
    smallCapEdgeMode: true,
    tp1Pct: 25,
    hardSlPct: 12,
    riskPerTradePct: 2,
    jitoTipSol: 0.004,
    maxFeeRatioPct: 10,
    maxPriceImpactPct: 15,
  });
  // Very shallow pool ($1,500) + high fee drag triggers Small-Cap Fee/Slippage Edge Gate
  const blocked = computeDynamicPositionSize({
    availableBalanceSol: 1.2,
    openExposureSol: 0,
    dailyRealizedPnlSol: 0,
    securityScore: 95,
    liquidityUsd: 1_500,
    roundTripSpreadPct: 8,
    solPriceUsd: 165,
    cfg: smallCfg,
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reason.includes('Small-Cap'));
});
