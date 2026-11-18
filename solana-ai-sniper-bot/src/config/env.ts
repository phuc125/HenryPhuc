import dotenv from 'dotenv';
import path from 'path';
import { DiscoveryMode } from '../core/types';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export type TradingMode = 'PAPER' | 'LIVE';

const DEFAULT_PUBLIC_RPC_POOL = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];

export interface EnvConfig {
  privateKey: string;
  tradingMode: TradingMode;
  discoveryMode: DiscoveryMode;
  hasPaidRpcPlan: boolean;
  freeFeedPollMs: number;
  positionPollMs: number;
  apiInitialRetryDelayMs: number;
  apiMaxRetries: number;
  apiGlobalCooldownMs: number;
  apiCacheTtlMs: number;
  paperInitialBalanceSol: number;
  rpcHttpsUrl: string;
  rpcWssUrl: string;
  rpcFallbackUrl: string;
  rpcPoolUrls: string[];
  jitoBlockEngineUrl: string;
  jitoTipSol: number;
  appApiPort: number;
  wifiOnlyMode: boolean;
  lowData4gMode: boolean;
  lowData4gPollMs: number;
  openAiApiKey: string;
  openAiBaseUrl: string;
  twitterBearerToken: string;
  riskPerTradePct: number;
  slippageBps: number;
  maxPriorityFeeLamports: number;
  minLpBurnedPct: number;
  maxTop10HoldersPct: number;
  maxDevHoldPct: number;
  maxBundleSupplyPct: number;
  snipePumpCreate: boolean;
  observationDelayMs: number;
  minLiquidityUsd: number;
  minUniqueBuyers: number;
  minBuyCount: number;
  maxRoundtripSpreadPct: number;
  maxFeeRatioPct: number;
  entryCooldownMs: number;
  maxConsecutiveLosses: number;
  tp1Pct: number;
  tp1SellSharePct: number;
  tp2Pct: number;
  tp2SellSharePct: number;
  trailingTpEnabled: boolean;
  trailingTpCallbackPct: number;
  breakevenActivatePct: number;
  trailingActivatePct: number;
  trailingCallbackPct: number;
  hardSlPct: number;
  timeExitMinutes: number;
  maxSinglePositionPct: number;
  maxPortfolioHeatPct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  profitProtectionPct: number;
  rugDrainMissTicks: number;
  rugDrainLiqRatio: number;
  dynamicJitoTipEnabled: boolean;
  honeypotSimEnabled: boolean;
  lpLockCheckEnabled: boolean;
  antiBundleCheckEnabled: boolean;
  orderflowFilterEnabled: boolean;
  washTradeGuardEnabled: boolean;
  momentumFilterEnabled: boolean;
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
  minAiQualityScore: number;
  minEntryRankScore: number;
  maxPriceImpactPct: number;
  minVolumeSpikeRatio: number;
  autoRentReclaimEnabled: boolean;
  autoConsolidateEnabled: boolean;
  coldWalletAddress: string;
  consolidateThresholdSol: number;
  consolidateKeepSol: number;
  blacklistedCreators: string[];
  smartWalletsSeed: string[];
  sqliteDbPath: string;
}

function parseNum(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function parseTradingMode(value: string | undefined): TradingMode {
  return value?.toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER';
}

function isCustomPaidRpc(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes('your_helius_api_key') || lower.includes('your_api_key')) return false;
  if (
    lower === 'https://api.mainnet-beta.solana.com' ||
    lower === 'https://solana-rpc.publicnode.com'
  ) {
    return false;
  }
  return lower.startsWith('http://') || lower.startsWith('https://');
}

function parseDiscoveryMode(
  raw: string | undefined,
  hasPaidRpcPlan: boolean,
): DiscoveryMode {
  const upper = raw?.trim().toUpperCase();
  if (upper === 'FREE_FEED' || upper === 'RPC_WSS' || upper === 'HYBRID') {
    return upper;
  }
  return hasPaidRpcPlan ? 'HYBRID' : 'FREE_FEED';
}

export function loadEnvConfig(): EnvConfig {
  const rawRpc = process.env.RPC_HTTPS_URL?.trim() || '';
  const hasPaidRpcPlan = isCustomPaidRpc(rawRpc);
  const rpcHttpsUrl = hasPaidRpcPlan ? rawRpc : DEFAULT_PUBLIC_RPC_POOL[0];
  const rpcWssUrl =
    process.env.RPC_WSS_URL?.trim() && !process.env.RPC_WSS_URL.includes('YOUR_HELIUS_API_KEY')
      ? process.env.RPC_WSS_URL.trim()
      : rpcHttpsUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');

  const rpcFallbackUrl =
    process.env.RPC_FALLBACK_URL?.trim() || DEFAULT_PUBLIC_RPC_POOL[1];

  const customPool = (process.env.RPC_POOL_URLS?.trim() || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http'));

  const rpcPoolUrls = Array.from(
    new Set([rpcHttpsUrl, rpcFallbackUrl, ...customPool, ...DEFAULT_PUBLIC_RPC_POOL]),
  );

  const discoveryMode = parseDiscoveryMode(process.env.DISCOVERY_MODE, hasPaidRpcPlan);

  const appApiPort = Math.max(1024, parseNum(process.env.APP_API_PORT, 3100));
  const wifiOnlyMode = parseBool(process.env.WIFI_ONLY_MODE, true);
  const lowData4gMode = parseBool(process.env.LOW_DATA_4G_MODE, false);
  const lowData4gPollMs = Math.max(30_000, parseNum(process.env.LOW_DATA_4G_POLL_MS, 45_000));

  const tradingMode = parseTradingMode(process.env.TRADING_MODE);
  const privateKey = process.env.PRIVATE_KEY?.trim() || '';

  if (tradingMode === 'LIVE' && !privateKey) {
    throw new Error('PRIVATE_KEY is strictly required when TRADING_MODE=LIVE');
  }

  return {
    privateKey,
    tradingMode,
    discoveryMode,
    hasPaidRpcPlan,
    freeFeedPollMs: Math.max(5000, parseNum(process.env.FREE_FEED_POLL_MS, 8000)),
    positionPollMs: Math.max(5000, parseNum(process.env.POSITION_POLL_MS, 5000)),
    apiInitialRetryDelayMs: Math.max(5000, parseNum(process.env.API_INITIAL_RETRY_DELAY_MS, 5000)),
    apiMaxRetries: Math.max(1, Math.min(3, Math.round(parseNum(process.env.API_MAX_RETRIES, 2)))),
    apiGlobalCooldownMs: Math.max(
      30_000,
      Math.min(60_000, parseNum(process.env.API_GLOBAL_COOLDOWN_MS, 45_000)),
    ),
    apiCacheTtlMs: Math.max(5000, Math.min(10_000, parseNum(process.env.API_CACHE_TTL_MS, 8000))),
    paperInitialBalanceSol: parseNum(process.env.PAPER_INITIAL_BALANCE_SOL, 10),
    rpcHttpsUrl,
    rpcWssUrl,
    rpcFallbackUrl,
    rpcPoolUrls,
    jitoBlockEngineUrl:
      process.env.JITO_BLOCK_ENGINE_URL?.trim() ||
      'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
    jitoTipSol: parseNum(process.env.JITO_TIP_SOL, 0.001),
    appApiPort,
    wifiOnlyMode,
    lowData4gMode,
    lowData4gPollMs,
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || '',
    openAiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    twitterBearerToken: process.env.TWITTER_BEARER_TOKEN?.trim() || '',
    riskPerTradePct: parseNum(process.env.RISK_PER_TRADE_PCT, 1),
    slippageBps: parseNum(process.env.SLIPPAGE_BPS, 1200),
    maxPriorityFeeLamports: parseNum(process.env.MAX_PRIORITY_FEE_LAMPORTS, 100000),
    minLpBurnedPct: parseNum(process.env.MIN_LP_BURNED_PCT, 90),
    maxTop10HoldersPct: parseNum(process.env.MAX_TOP10_HOLDERS_PCT, 32),
    maxDevHoldPct: parseNum(process.env.MAX_DEV_HOLD_PCT, 6),
    maxBundleSupplyPct: parseNum(process.env.MAX_BUNDLE_SUPPLY_PCT, 30),
    snipePumpCreate: parseBool(process.env.SNIPE_PUMP_CREATE, false),
    observationDelayMs: parseNum(process.env.OBSERVATION_DELAY_MS, 4000),
    minLiquidityUsd: parseNum(process.env.MIN_LIQUIDITY_USD, 8000),
    minUniqueBuyers: parseNum(process.env.MIN_UNIQUE_BUYERS, 4),
    minBuyCount: parseNum(process.env.MIN_BUY_COUNT, 5),
    maxRoundtripSpreadPct: parseNum(process.env.MAX_ROUNDTRIP_SPREAD_PCT, 12),
    maxFeeRatioPct: parseNum(process.env.MAX_FEE_RATIO_PCT, 6),
    entryCooldownMs: parseNum(process.env.ENTRY_COOLDOWN_MS, 4000),
    maxConsecutiveLosses: parseNum(process.env.MAX_CONSECUTIVE_LOSSES, 4),
    tp1Pct: parseNum(process.env.TP1_PCT, 45),
    tp1SellSharePct: parseNum(process.env.TP1_SELL_SHARE_PCT, 50),
    tp2Pct: parseNum(process.env.TP2_PCT, 120),
    tp2SellSharePct: parseNum(process.env.TP2_SELL_SHARE_PCT, 30),
    trailingTpEnabled: parseBool(process.env.TRAILING_TP_ENABLED, true),
    trailingTpCallbackPct: parseNum(process.env.TRAILING_TP_CALLBACK_PCT, 8),
    breakevenActivatePct: parseNum(process.env.BREAKEVEN_ACTIVATE_PCT, 18),
    trailingActivatePct: parseNum(process.env.TRAILING_ACTIVATE_PCT, 28),
    trailingCallbackPct: parseNum(process.env.TRAILING_CALLBACK_PCT, 12),
    hardSlPct: parseNum(process.env.HARD_SL_PCT, 25),
    timeExitMinutes: parseNum(process.env.TIME_EXIT_MINUTES, 12),
    maxSinglePositionPct: parseNum(process.env.MAX_SINGLE_POSITION_PCT, 15),
    maxPortfolioHeatPct: parseNum(process.env.MAX_PORTFOLIO_HEAT_PCT, 35),
    maxDailyLossPct: parseNum(process.env.MAX_DAILY_LOSS_PCT, 5),
    maxWeeklyLossPct: parseNum(process.env.MAX_WEEKLY_LOSS_PCT, 12),
    profitProtectionPct: parseNum(process.env.PROFIT_PROTECTION_PCT, 40),
    rugDrainMissTicks: parseNum(process.env.RUG_DRAIN_MISS_TICKS, 5),
    rugDrainLiqRatio: parseNum(process.env.RUG_DRAIN_LIQ_RATIO, 0.35),
    dynamicJitoTipEnabled: parseBool(process.env.DYNAMIC_JITO_TIP_ENABLED, true),
    honeypotSimEnabled: parseBool(process.env.HONEYPOT_SIM_ENABLED, true),
    lpLockCheckEnabled: parseBool(process.env.LP_LOCK_CHECK_ENABLED, true),
    antiBundleCheckEnabled: parseBool(process.env.ANTI_BUNDLE_CHECK_ENABLED, true),
    orderflowFilterEnabled: parseBool(process.env.ORDERFLOW_FILTER_ENABLED, true),
    washTradeGuardEnabled: parseBool(process.env.WASH_TRADE_GUARD_ENABLED, true),
    momentumFilterEnabled: parseBool(process.env.MOMENTUM_FILTER_ENABLED, true),
    spreadGuardEnabled: parseBool(process.env.SPREAD_GUARD_ENABLED, true),
    cooldownGuardEnabled: parseBool(process.env.COOLDOWN_GUARD_ENABLED, true),
    breakevenLockEnabled: parseBool(process.env.BREAKEVEN_LOCK_ENABLED, true),
    earlyMomentumCutEnabled: parseBool(process.env.EARLY_MOMENTUM_CUT_ENABLED, true),
    timeExitEnabled: parseBool(process.env.TIME_EXIT_ENABLED, true),
    circuitBreakerEnabled: parseBool(process.env.CIRCUIT_BREAKER_ENABLED, true),
    autoDeleteEntryMsgEnabled: parseBool(process.env.AUTO_DELETE_ENTRY_MSG_ENABLED, true),
    aiIntelligenceEnabled: parseBool(process.env.AI_INTELLIGENCE_ENABLED, true),
    smartMoneyFilterEnabled: parseBool(process.env.SMART_MONEY_FILTER_ENABLED, true),
    marketRegimeGuardEnabled: parseBool(process.env.MARKET_REGIME_GUARD_ENABLED, true),
    adaptiveEntryEnabled: parseBool(process.env.ADAPTIVE_ENTRY_ENABLED, true),
    socialIntelligenceEnabled: parseBool(process.env.SOCIAL_INTELLIGENCE_ENABLED, true),
    continuousLearningEnabled: parseBool(process.env.CONTINUOUS_LEARNING_ENABLED, true),
    minAiQualityScore: parseNum(process.env.MIN_AI_QUALITY_SCORE, 52),
    minEntryRankScore: parseNum(process.env.MIN_ENTRY_RANK_SCORE, 54),
    maxPriceImpactPct: parseNum(process.env.MAX_PRICE_IMPACT_PCT, 7.5),
    minVolumeSpikeRatio: parseNum(process.env.MIN_VOLUME_SPIKE_RATIO, 0.5),
    autoRentReclaimEnabled: parseBool(process.env.AUTO_RENT_RECLAIM_ENABLED, true),
    autoConsolidateEnabled: parseBool(process.env.AUTO_CONSOLIDATE_ENABLED, false),
    coldWalletAddress: process.env.COLD_WALLET_ADDRESS?.trim() || '',
    consolidateThresholdSol: Math.max(0.1, parseNum(process.env.CONSOLIDATE_THRESHOLD_SOL, 2.0)),
    consolidateKeepSol: Math.max(0.05, parseNum(process.env.CONSOLIDATE_KEEP_SOL, 1.0)),
    blacklistedCreators: (process.env.BLACKLISTED_CREATORS?.trim() || '')
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length >= 32),
    smartWalletsSeed: (process.env.SMART_WALLETS_SEED?.trim() || '')
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length >= 32),
    sqliteDbPath: process.env.SQLITE_DB_PATH?.trim() || './data/sniper.db',
  };
}
