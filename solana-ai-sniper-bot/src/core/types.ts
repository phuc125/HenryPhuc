export type DexSource =
  | 'RAYDIUM_V4'
  | 'RAYDIUM_CPMM'
  | 'PUMP_FUN'
  | 'PUMPSWAP'
  | 'METEORA_DLMM'
  | 'MANUAL';

export type DiscoveryMode = 'FREE_FEED' | 'RPC_WSS' | 'HYBRID';

export type DataSourceReliability =
  | 'ONCHAIN_FULL_BALANCE'
  | 'HYBRID_VERIFIED'
  | 'FREE_FEED_AGGREGATED'
  | 'UNVERIFIED';

export type MarketRegimeType = 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'HIGH_VOLATILITY';

export type EntryStrategyId =
  | 'EARLY_MOMENTUM'
  | 'BREAKOUT'
  | 'PULLBACK'
  | 'LIQUIDITY_INFLOW'
  | 'SMART_MONEY';

export type TokenLifecycleStage =
  | 'BIRTH'
  | 'EARLY_ACCUMULATION'
  | 'EXPANSION'
  | 'DISTRIBUTION'
  | 'EXHAUSTION'
  | 'DEAD';

export type EntryTimingVerdict = 'OPTIMAL_NOW' | 'WAIT_PULLBACK' | 'LATE_CHASE' | 'AVOID';

export type NarrativeCategory =
  | 'AI_AGENT'
  | 'MEME_CULTURE'
  | 'POLITIFI'
  | 'DEFI_UTILITY'
  | 'GAMING'
  | 'UNKNOWN';

export interface PoolDiscoveryEvent {
  mint: string;
  poolAddress: string;
  lpMint?: string;
  quoteMint: string;
  dex: DexSource;
  signature: string;
  slot: number;
  creatorAddress?: string;
  detectedAt: number;
  eventKind: 'NEW_POOL' | 'MIGRATION' | 'MANUAL';
  prefetchedSymbol?: string;
  prefetchedName?: string;
  prefetchedLiquidityUsd?: number;
  prefetchedPriceSol?: number;
  prefetchedM5Buys?: number;
  prefetchedM5Sells?: number;
  prefetchedM5VolumeUsd?: number;
  prefetchedH1VolumeUsd?: number;
  prefetchedM5PriceChangePct?: number;
  prefetchedH1PriceChangePct?: number;
  prefetchedFdvUsd?: number;
  prefetchedAgeMinutes?: number;
  crossDexPoolCount?: number;
  crossDexTotalLiquidityUsd?: number;
  crossDexPriceSpreadPct?: number;
  dexBoosted?: boolean;
  twitterUrl?: string;
  telegramUrl?: string;
  websiteUrl?: string;
  mintVerified?: boolean;
}

export interface SecurityLayerResult {
  layer: string;
  passed: boolean;
  verified: boolean;
  detail: string;
  durationMs: number;
  critical: boolean;
}

export interface AntiRugReport {
  mint: string;
  overallSafe: boolean;
  securityScore: number;
  dataConfidencePct: number;
  unverifiedLayers: string[];
  elapsedMs: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpBurnedPct: number;
  lpBurnVerified: boolean;
  top10HoldersPct: number;
  devHoldPct: number;
  bundleSupplyPct: number;
  sybilScore: number;
  insiderWalletsCount: number;
  creatorReputationScore: number;
  liquidityWithdrawalRiskPct: number;
  rugcheckScore: number | null;
  rugcheckRiskLevel: string;
  honeypotPassed: boolean;
  roundTripLossPct?: number | null;
  creatorAddress?: string;
  creatorBlacklisted?: boolean;
  layers: SecurityLayerResult[];
}

export interface OrderflowTimeframeMetrics {
  windowLabel: '1m' | '5m' | '15m';
  buys: number;
  sells: number;
  buySolVolume: number;
  sellSolVolume: number;
  volumeDeltaSol: number;
  imbalanceRatio: number;
}

export interface OrderflowResult {
  passed: boolean;
  dataSource: DataSourceReliability;
  reliabilityScore: number;
  buyCount: number;
  sellCount: number;
  buyToSellRatio: number;
  devSold: boolean;
  uniqueBuyers: number;
  uniqueSellers: number;
  netSolInflow: number;
  buySolVolume: number;
  sellSolVolume: number;
  cvdSol: number;
  orderflowImbalance: number;
  whaleBuyCount: number;
  whaleSellCount: number;
  whaleNetSol: number;
  smartMoneyAccumulation: boolean;
  smartMoneyDistribution: boolean;
  sybilSuspected: boolean;
  sybilScore: number;
  coordinatedBuyDetected: boolean;
  avgBuySol: number;
  m5VolumeUsd?: number;
  h1VolumeUsd?: number;
  volumeSpikeRatio?: number;
  priceChangeM5Pct?: number;
  turnoverRatio?: number;
  washTradeSuspected?: boolean;
  largestBuyerSharePct?: number;
  participantWallets?: Array<{
    wallet: string;
    side: 'BUY' | 'SELL';
    solAmount: number;
    tokenAmount: number;
    slot: number;
  }>;
  timeframes?: OrderflowTimeframeMetrics[];
  reason: string;
}

export interface MarketSnapshot {
  mint: string;
  priceSol: number | null;
  liquidityUsd: number | null;
  roundTripLossPct: number | null;
  buyPriceImpactPct: number | null;
  estimatedExitSlippagePct: number | null;
  canBuyOnJupiter: boolean;
  canSellOnJupiter: boolean;
  decimals: number;
  source: 'JUPITER_V6' | 'DEXSCREENER' | 'NONE';
}

export interface SmartWalletProfile {
  wallet: string;
  tier: 'WHALE' | 'SMART_ALPHA' | 'SNIPER' | 'SYBIL' | 'CREATOR' | 'UNKNOWN';
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  realizedPnlSol: number;
  avgRoiPct: number;
  reputationScore: number;
  clusterId?: string | null;
  isInsider: boolean;
  isWhale: boolean;
  lastActiveAt: number;
}

export interface SmartMoneyAnalysis {
  smartMoneyScore: number;
  smartBuyersCount: number;
  smartSellersCount: number;
  whaleEntriesCount: number;
  whaleExitsCount: number;
  insiderAlert: boolean;
  coordinatedClusterDetected: boolean;
  creatorReputationScore: number;
  netSmartSolFlow: number;
  topMatchedWallets: SmartWalletProfile[];
  reason: string;
}

export interface SocialIntelligenceResult {
  socialScore: number;
  narrative: NarrativeCategory;
  twitterPresent: boolean;
  telegramPresent: boolean;
  websitePresent: boolean;
  mentionVelocityPerHr: number;
  fakeEngagementSuspected: boolean;
  influencerSignalScore: number;
  narrativeGrowthScore: number;
  sentimentScore: number;
  reason: string;
}

export interface MarketRegimeSnapshot {
  regime: MarketRegimeType;
  solPriceUsd: number;
  solChange1hPct: number;
  solChange24hPct: number;
  dexVolume24hUsd: number;
  breadthAdvancingPct: number;
  liquidityFlowRatio: number;
  memecoinSentimentScore: number;
  volatilityScore: number;
  recommendedStrategy: EntryStrategyId;
  riskMultiplier: number;
  minAiScoreThreshold: number;
  updatedAt: number;
  reason: string;
}

export interface AiPredictionResult {
  passed: boolean;
  tokenQualityScore: number;
  score: number;
  pumpProbability: number;
  rugProbability: number;
  rawLogit: number;
  calibratedConfidence: number;
  priceMomentumPrediction: 'SURGING' | 'BULLISH' | 'NEUTRAL' | 'FADING' | 'DUMPING';
  expectedReturn15mPct: number;
  liquidityGrowthPrediction: 'EXPANDING' | 'STABLE' | 'DRAINING';
  entryTiming: EntryTimingVerdict;
  lifecycleStage: TokenLifecycleStage;
  socialScore: number;
  holderGrowthScore: number;
  modelVersion: string;
  featureContributions: Record<string, number>;
  reason: string;
  latencyMs: number;
  skipped: boolean;
}

export type AiNarrativeResult = AiPredictionResult;

export interface AdaptiveEntryDecision {
  approved: boolean;
  selectedStrategy: EntryStrategyId;
  entryRankScore: number;
  dynamicThreshold: number;
  multiTimeframeConfirmed: boolean;
  estimatedEntrySlippagePct: number;
  strategyScores: Record<EntryStrategyId, number>;
  reasons: string[];
  urgency: 'NORMAL' | 'HIGH_CONVICTION';
}

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  socialCount?: number;
  dexBoosted?: boolean;
  holderCount?: number | null;
  holderGrowthPerMin?: number | null;
  ageMinutes?: number | null;
  m5Buys?: number;
  h1Buys?: number;
  m5VolumeUsd?: number;
  liquidityUsd?: number;
}

export interface ExecutionResult {
  success: boolean;
  mode: 'PAPER' | 'LIVE';
  side: 'BUY' | 'SELL';
  mint: string;
  dexRoute: 'DIRECT_DEX' | 'JUPITER_V6' | 'JUPITER_LITE' | 'PAPER_SIM';
  signature: string;
  solAmount: number;
  tokenAmountRaw: string;
  tokenAmountUi: number;
  executionPriceSol: number;
  expectedPriceSol?: number;
  priorityFeeSol: number;
  jitoTipSol: number;
  bundleId?: string;
  latencyMs?: number;
  balanceVerified?: boolean;
  reconciled?: boolean;
  slippageDiffPct?: number;
  error?: string;
}

export interface PositionRecord {
  id: number;
  mint: string;
  symbol: string;
  dex: DexSource;
  poolAddress?: string;
  creatorAddress?: string;
  mode: 'PAPER' | 'LIVE';
  status: 'OPEN' | 'CLOSED';
  entryStrategy?: EntryStrategyId;
  marketRegime?: MarketRegimeType;
  aiScoreAtEntry?: number;
  entryPriceSol: number;
  highestPriceSol: number;
  currentPriceSol: number;
  entryLiquidityUsd: number;
  initialSolSpent: number;
  remainingSolCostBasis: number;
  initialTokenAmount: number;
  remainingTokenAmount: number;
  realizedSol: number;
  tp1Hit: boolean;
  tp1TrailingArmed: boolean;
  tp1PeakPriceSol: number | null;
  tp2Hit: boolean;
  tp2TrailingArmed: boolean;
  tp2PeakPriceSol: number | null;
  breakevenArmed: boolean;
  trailingActive: boolean;
  trailingStopPriceSol: number | null;
  openedAt: number;
  closedAt: number | null;
  closeReason: string | null;
  buyChatId?: number | null;
  buyMessageId?: number | null;
}

export interface TradeLogRecord {
  id: number;
  positionId: number;
  mint: string;
  symbol: string;
  mode: 'PAPER' | 'LIVE';
  side: 'BUY' | 'SELL';
  dexRoute: string;
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  feeSol: number;
  pnlSol: number;
  signature: string;
  reason: string;
  reconciled?: boolean;
  slippageDiffPct?: number;
  latencyMs?: number;
  createdAt: number;
}

export interface TokenSnapshotRecord {
  id?: number;
  mint: string;
  symbol: string;
  dex: DexSource;
  poolAddress?: string;
  creatorAddress?: string;
  marketRegime: MarketRegimeType;
  entryStrategy?: EntryStrategyId;
  actionTaken: 'BOUGHT' | 'REJECTED';
  rejectionStage?: string;
  rejectionReason?: string;
  securityScore: number;
  aiQualityScore: number;
  pumpProbability: number;
  rugProbability: number;
  smartMoneyScore: number;
  socialScore: number;
  orderflowImbalance: number;
  cvdSol: number;
  liquidityUsd: number;
  priceSolAtDiscovery: number;
  price1mSol?: number | null;
  price5mSol?: number | null;
  price15mSol?: number | null;
  price1hSol?: number | null;
  price24hSol?: number | null;
  realizedPnlPct?: number | null;
  createdAt: number;
}

export interface PnlSummary {
  mode: 'PAPER' | 'LIVE' | 'ALL';
  totalTrades: number;
  closedPositions: number;
  winningPositions: number;
  losingPositions: number;
  winRatePct: number;
  profitFactor: number;
  expectancySol: number;
  maxDrawdownSol: number;
  maxDrawdownPct: number;
  startingBalanceSol: number;
  currentBalanceSol: number;
  peakBalanceSol: number;
  netReturnPct: number;
  totalNetPnlSol: number;
  totalFeesSol: number;
  avgSlippageDiffPct: number;
  grossProfitSol: number;
  grossLossSol: number;
  equityCurve: Array<{
    timestamp: number;
    cumulativePnlSol: number;
    balanceSol: number;
    symbol: string;
  }>;
}

export interface PipelineStats {
  startedAt: number;
  lastResetAt: number;
  discovered: number;
  blockedCooldownOrCap: number;
  blockedAntiRug: number;
  blockedMarket: number;
  blockedOrderflow: number;
  blockedAiOrEntry: number;
  blockedRisk: number;
  executedBuys: number;
}

export interface BacktestTradeOutcome {
  mint: string;
  symbol: string;
  dex: DexSource;
  strategy: EntryStrategyId;
  regime: MarketRegimeType;
  entrySol: number;
  netPnlSol: number;
  netPnlPct: number;
  feesSol: number;
  slippageCostSol: number;
  exitReason: string;
  timestamp: number;
}

export interface BacktestReport {
  sampleSize: number;
  totalTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancySol: number;
  netPnlAfterFeesSol: number;
  totalFeesSol: number;
  totalSlippageCostSol: number;
  maxDrawdownPct: number;
  monteCarloMedianReturnPct: number;
  monteCarloP05ReturnPct: number;
  monteCarloWorstDdPct: number;
  walkForwardOosWinRatePct: number;
  walkForwardOosProfitFactor: number;
  rejectedPumpedPct: number;
  byDex: Record<string, { trades: number; winRatePct: number; netPnlSol: number }>;
  byStrategy: Record<string, { trades: number; winRatePct: number; netPnlSol: number }>;
  trades: BacktestTradeOutcome[];
}

export interface AiModelVersionRecord {
  version: string;
  createdAt: number;
  sampleSize: number;
  inSampleAccuracyPct: number;
  oosAccuracyPct: number;
  brierScore: number;
  status: 'ACTIVE' | 'CANDIDATE' | 'APPROVED' | 'REJECTED';
  weightsJson: string;
  featureImportanceJson: string;
  notes: string;
}
