import { Connection, Logs, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import {
  ApiResilienceClient,
  computeRandomJitterMs,
  extractRetryAfterFromError,
  GlobalCooldownError,
  isHttp429Error,
  SequentialApiQueue,
  sharedHttpClient,
} from '../core/httpClient';
import { DexSource, DiscoveryMode, PoolDiscoveryEvent } from '../core/types';
import { RpcManager } from '../core/rpc';

export const DEX_PROGRAMS = {
  RAYDIUM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  RAYDIUM_CPMM: new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
  PUMP_FUN: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
} as const;

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEDUP_TTL_MS = 15 * 60 * 1000;

interface StreamConfig {
  dex: DexSource;
  programId: PublicKey;
  matchLogs: (logs: string[]) => { matched: boolean; kind: 'NEW_POOL' | 'MIGRATION' };
}

interface GeckoPoolResource {
  id: string;
  attributes?: {
    address?: string;
    name?: string;
    pool_created_at?: string;
    reserve_in_usd?: string;
    fdv_usd?: string;
    base_token_price_native_currency?: string;
    price_change_percentage?: { m5?: string; h1?: string };
    volume_usd?: { m5?: string; h1?: string };
    transactions?: {
      m5?: { buys?: number; sells?: number };
    };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string };
  priceNative?: string;
  priceChange?: { m5?: number; h1?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  volume?: { m5?: number; h1?: number };
  txns?: { m5?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: {
    websites?: Array<{ url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
  boosts?: { active?: number };
}

export interface DiscoveredPoolRecord {
  mint: string;
  poolAddress: string;
  dex: DexSource;
  liquidityUsd: number;
  crossDexPoolCount: number;
  status: 'QUEUED' | 'REJECTED_INVALID';
  detectedAt: number;
}

export class MultiDexListeners extends EventEmitter {
  private readonly seenMints = new Map<string, number>();
  private readonly subscriptionIds = new Map<DexSource, number>();
  private readonly reconnectTimers = new Map<DexSource, NodeJS.Timeout>();
  private readonly poolHistory: DiscoveredPoolRecord[] = [];
  private freeFeedTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isPollingFreeFeed = false;
  private stopped = false;
  private freeFeedTick = 0;
  private geckoBackoffUntil = 0;
  private gecko429Streak = 0;
  private dexScreenerBackoffUntil = 0;
  private dexScreener429Streak = 0;
  private dexScreenerRotateIdx = 0;
  private geckoRotateIdx = 0;
  private readonly minDiscoveryLiquidityUsd: number;
  private readonly maxCandidatesPerPoll: number;
  private readonly freeFeedPollIntervalMs: number;
  private readonly httpClient: ApiResilienceClient;
  private readonly geckoQueue: SequentialApiQueue;
  private readonly scannerStats = {
    ticks: 0,
    dexScreenerRuns: 0,
    geckoRuns: 0,
    failovers: 0,
    prefilterJunkSkipped: 0,
    emittedPools: 0,
  };

  private readonly streams: StreamConfig[] = [
    {
      dex: 'RAYDIUM_V4',
      programId: DEX_PROGRAMS.RAYDIUM_V4,
      matchLogs: (logs) => ({
        matched: logs.some((l) => l.includes('initialize2') || l.includes('InitializeInstruction2')),
        kind: 'NEW_POOL',
      }),
    },
    {
      dex: 'RAYDIUM_CPMM',
      programId: DEX_PROGRAMS.RAYDIUM_CPMM,
      matchLogs: (logs) => ({
        matched: logs.some(
          (l) => l.includes('Instruction: Initialize') && !l.includes('InitializeAccount'),
        ),
        kind: 'NEW_POOL',
      }),
    },
    {
      dex: 'PUMP_FUN',
      programId: DEX_PROGRAMS.PUMP_FUN,
      matchLogs: (logs) => {
        const isCreate = logs.some((l) => l.includes('Instruction: Create'));
        const isWithdraw = logs.some(
          (l) => l.includes('Instruction: Withdraw') || l.includes('Migrate'),
        );
        if (isWithdraw) return { matched: true, kind: 'MIGRATION' };
        if (isCreate) return { matched: true, kind: 'NEW_POOL' };
        return { matched: false, kind: 'NEW_POOL' };
      },
    },
    {
      dex: 'METEORA_DLMM',
      programId: DEX_PROGRAMS.METEORA_DLMM,
      matchLogs: (logs) => ({
        matched: logs.some(
          (l) =>
            l.includes('Instruction: InitializeLbPair') ||
            l.includes('Instruction: InitializeCustomizablePermissionlessLbPair'),
        ),
        kind: 'NEW_POOL',
      }),
    },
  ];

  constructor(
    private readonly rpcManager: RpcManager,
    private readonly discoveryMode: DiscoveryMode = 'FREE_FEED',
    freeFeedPollMs = 8000,
    options?: {
      httpClient?: ApiResilienceClient;
      geckoMinSpacingMs?: number;
      sleepFn?: (ms: number) => Promise<void>;
      minDiscoveryLiquidityUsd?: number;
      maxCandidatesPerPoll?: number;
    },
  ) {
    super();
    this.freeFeedPollIntervalMs = Math.max(5_000, freeFeedPollMs);
    this.httpClient = options?.httpClient ?? sharedHttpClient;
    this.minDiscoveryLiquidityUsd = Math.max(0, options?.minDiscoveryLiquidityUsd ?? 2_500);
    this.maxCandidatesPerPoll = Math.max(1, options?.maxCandidatesPerPoll ?? 8);
    this.geckoQueue = new SequentialApiQueue(
      Math.max(2_500, options?.geckoMinSpacingMs ?? 2_500),
      options?.sleepFn,
    );
  }

  public getScannerStats() {
    return { ...this.scannerStats };
  }

  public getRecentDiscoveredPools(limit = 30): DiscoveredPoolRecord[] {
    return this.poolHistory.slice(-limit).reverse();
  }

  private recordPoolHistory(rec: DiscoveredPoolRecord): void {
    this.poolHistory.push(rec);
    if (this.poolHistory.length > 200) {
      this.poolHistory.shift();
    }
  }

  private isValidMintAndPool(mint: string, poolAddress: string): boolean {
    if (!BASE58_MINT_RE.test(mint) || mint === WSOL_MINT) return false;
    if (!poolAddress || poolAddress.length < 20) return false;
    try {
      new PublicKey(mint);
      return true;
    } catch {
      return false;
    }
  }

  public start(): void {
    this.stopped = false;

    if (this.discoveryMode === 'RPC_WSS' || this.discoveryMode === 'HYBRID') {
      for (const stream of this.streams) {
        this.subscribeStream(stream, 0);
      }
    }

    if (this.discoveryMode === 'FREE_FEED' || this.discoveryMode === 'HYBRID') {
      this.emit('listener_status', {
        dex: 'FREE_FEED (Rotating DexScreener + GeckoTerminal Queue + Per-Host 429 Failover)',
        status: `ACTIVE (${this.freeFeedPollIntervalMs}ms interval)`,
      });
      void this.pollFreeDiscoveryFeeds();
      this.freeFeedTimer = setInterval(() => {
        void this.pollFreeDiscoveryFeeds();
      }, this.freeFeedPollIntervalMs);
    }

    this.cleanupTimer = setInterval(() => this.pruneDedupMap(), 60_000);
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.freeFeedTimer) {
      clearInterval(this.freeFeedTimer);
      this.freeFeedTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    const conn = this.rpcManager.getConnection('processed');
    for (const [dex, subId] of this.subscriptionIds.entries()) {
      try {
        await conn.removeOnLogsListener(subId);
      } catch {
        // Ignore teardown errors
      }
      this.subscriptionIds.delete(dex);
    }
  }

  private isMintSeenActive(mint: string, now = Date.now()): boolean {
    const expiry = this.seenMints.get(mint);
    return Boolean(expiry && now < expiry);
  }

  public markMintSeen(mint: string, ttlMs = DEDUP_TTL_MS): boolean {
    const now = Date.now();
    const expiry = this.seenMints.get(mint);
    if (expiry && now < expiry) {
      return false;
    }
    this.seenMints.set(mint, now + ttlMs);
    return true;
  }

  public markMintCooldown(mint: string, cooldownMs = 60_000): void {
    this.seenMints.set(mint, Date.now() + cooldownMs);
  }

  public getFreeFeedBackoffStatus(): {
    geckoBackedOffMs: number;
    dexScreenerBackedOffMs: number;
    globalCooldownRemainingMs: number;
    dedupMapSize: number;
  } {
    const now = Date.now();
    return {
      geckoBackedOffMs: Math.max(
        Math.max(0, this.geckoBackoffUntil - now),
        this.httpClient.getHostCooldownRemainingMs('https://api.geckoterminal.com', now),
      ),
      dexScreenerBackedOffMs: Math.max(
        Math.max(0, this.dexScreenerBackoffUntil - now),
        this.httpClient.getHostCooldownRemainingMs('https://api.dexscreener.com', now),
      ),
      globalCooldownRemainingMs: this.httpClient.getGlobalCooldownRemainingMs(now),
      dedupMapSize: this.seenMints.size,
    };
  }

  private isRateLimitError(err: unknown): boolean {
    if (isHttp429Error(err)) return true;
    if (err && typeof err === 'object' && 'response' in err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 503) return true;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return msg.toLowerCase().includes('rate limit');
  }

  private pruneDedupMap(): void {
    const now = Date.now();
    for (const [mint, expiry] of this.seenMints.entries()) {
      if (now >= expiry) {
        this.seenMints.delete(mint);
      }
    }
  }

  private mapDexId(rawDexId: string | undefined): { dex: DexSource; kind: 'NEW_POOL' | 'MIGRATION' } {
    const id = (rawDexId ?? '').toLowerCase();
    if (id.includes('pumpswap')) return { dex: 'PUMPSWAP', kind: 'MIGRATION' };
    if (id.includes('pump')) return { dex: 'PUMP_FUN', kind: 'NEW_POOL' };
    if (id.includes('meteora')) return { dex: 'METEORA_DLMM', kind: 'NEW_POOL' };
    if (id.includes('cpmm')) return { dex: 'RAYDIUM_CPMM', kind: 'NEW_POOL' };
    return { dex: 'RAYDIUM_V4', kind: 'NEW_POOL' };
  }

  /**
   * Smart Rotating Feed Scheduler with Per-Host Failover:
   * - Alternates 1 upstream provider per poll tick (DexScreener <-> GeckoTerminal) so neither hits burst limits
   * - Automatically fails over to the healthy provider if the scheduled host is in 429 cooldown
   */
  private async pollFreeDiscoveryFeeds(): Promise<void> {
    if (this.stopped || this.isPollingFreeFeed) return;
    this.isPollingFreeFeed = true;
    this.freeFeedTick++;
    this.scannerStats.ticks++;
    const now = Date.now();

    const canUseDexScreener =
      now >= this.dexScreenerBackoffUntil &&
      !this.httpClient.isHostCooldownActive('https://api.dexscreener.com', now);
    const canUseGecko =
      now >= this.geckoBackoffUntil &&
      !this.httpClient.isHostCooldownActive('https://api.geckoterminal.com', now);

    try {
      const preferDexScreener = this.freeFeedTick % 2 === 1;

      if (preferDexScreener) {
        if (canUseDexScreener) {
          this.scannerStats.dexScreenerRuns++;
          await this.pollDexScreenerRotatingFeed();
          // If DexScreener just hit 429 on this tick and Gecko is healthy, fail over right away
          if (
            this.httpClient.isHostCooldownActive('https://api.dexscreener.com') &&
            canUseGecko &&
            !this.stopped
          ) {
            this.scannerStats.failovers++;
            await this.runSingleGeckoRotatingStep();
          }
        } else if (canUseGecko) {
          this.scannerStats.failovers++;
          await this.runSingleGeckoRotatingStep();
        }
      } else {
        if (canUseGecko) {
          await this.runSingleGeckoRotatingStep();
          if (
            this.httpClient.isHostCooldownActive('https://api.geckoterminal.com') &&
            canUseDexScreener &&
            !this.stopped
          ) {
            this.scannerStats.failovers++;
            this.scannerStats.dexScreenerRuns++;
            await this.pollDexScreenerRotatingFeed();
          }
        } else if (canUseDexScreener) {
          this.scannerStats.failovers++;
          this.scannerStats.dexScreenerRuns++;
          await this.pollDexScreenerRotatingFeed();
        }
      }
    } finally {
      this.isPollingFreeFeed = false;
    }
  }

  private async runSingleGeckoRotatingStep(): Promise<void> {
    this.scannerStats.geckoRuns++;
    const useNewPools = this.geckoRotateIdx % 2 === 0;
    this.geckoRotateIdx++;
    const endpoint = useNewPools
      ? 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools'
      : 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools';
    const tag = useNewPools ? 'GECKO_NEW' : 'GECKO_TREND';

    await this.geckoQueue.enqueue(async () => {
      if (
        this.stopped ||
        this.httpClient.isHostCooldownActive('https://api.geckoterminal.com')
      ) {
        return;
      }
      await this.pollGeckoTerminalEndpoint(endpoint, tag);
    });
  }

  private async pollGeckoTerminalEndpoint(url: string, tag: string): Promise<void> {
    try {
      const data = await this.httpClient.get<{ data?: GeckoPoolResource[] }>(url, {
        axiosConfig: {
          timeout: 4500,
          headers: { Accept: 'application/json' },
        },
        allowStaleOnCooldown: false,
      });
      this.gecko429Streak = 0;

      const pools = data?.data ?? [];
      const candidates: Array<{ score: number; event: PoolDiscoveryEvent; liqUsd: number }> = [];
      const now = Date.now();

      for (const pool of pools) {
        if (this.stopped) return;
        const baseId = pool.relationships?.base_token?.data?.id ?? '';
        const quoteId = pool.relationships?.quote_token?.data?.id ?? '';
        const mint = baseId.replace(/^solana_/, '');
        const quoteMint = quoteId.replace(/^solana_/, '') || WSOL_MINT;
        const poolAddress = pool.attributes?.address || pool.id.replace(/^solana_/, '');

        if (!mint || quoteMint !== WSOL_MINT) continue;
        if (!this.isValidMintAndPool(mint, poolAddress)) {
          this.recordPoolHistory({
            mint,
            poolAddress,
            dex: 'RAYDIUM_V4',
            liquidityUsd: 0,
            crossDexPoolCount: 1,
            status: 'REJECTED_INVALID',
            detectedAt: now,
          });
          continue;
        }

        if (this.isMintSeenActive(mint, now)) continue;

        const createdAtMs = pool.attributes?.pool_created_at
          ? Date.parse(pool.attributes.pool_created_at)
          : NaN;
        const ageMinutes = Number.isFinite(createdAtMs)
          ? Math.max(0.5, Number(((now - createdAtMs) / 60_000).toFixed(1)))
          : undefined;
        if (tag === 'GECKO_TREND' && ageMinutes !== undefined && ageMinutes > 720) {
          this.markMintSeen(mint);
          continue;
        }

        const liqUsd = Number(pool.attributes?.reserve_in_usd ?? 0);
        const m5Buys = Number(pool.attributes?.transactions?.m5?.buys ?? 0);
        const m5Sells = Number(pool.attributes?.transactions?.m5?.sells ?? 0);

        // Pre-filter junk/micro/dead pools BEFORE emitting into Stage 2 or permanently blocking mint
        if (
          (Number.isFinite(liqUsd) && liqUsd > 0 && liqUsd < this.minDiscoveryLiquidityUsd) ||
          (pool.attributes?.transactions?.m5 !== undefined && m5Buys + m5Sells === 0)
        ) {
          this.scannerStats.prefilterJunkSkipped++;
          this.markMintCooldown(mint, 60_000);
          continue;
        }

        const mapped = this.mapDexId(pool.relationships?.dex?.data?.id);
        const fdvUsd = Number(pool.attributes?.fdv_usd ?? 0);
        const priceSol = Number(pool.attributes?.base_token_price_native_currency ?? 0);
        const m5VolUsd = Number(pool.attributes?.volume_usd?.m5 ?? 0);
        const h1VolUsd = Number(pool.attributes?.volume_usd?.h1 ?? 0);
        const m5ChangePct = Number(pool.attributes?.price_change_percentage?.m5 ?? 0);
        const h1ChangePct = Number(pool.attributes?.price_change_percentage?.h1 ?? 0);
        const symbol = pool.attributes?.name?.split('/')[0]?.trim();

        const qualityRank =
          (Number.isFinite(liqUsd) ? liqUsd / 1000 : 0) +
          m5Buys * 3 +
          Math.min(20, (Number.isFinite(m5VolUsd) ? m5VolUsd : 0) / 500);

        candidates.push({
          score: qualityRank,
          liqUsd: Number.isFinite(liqUsd) ? liqUsd : 0,
          event: {
            mint,
            poolAddress,
            quoteMint: WSOL_MINT,
            dex: mapped.dex,
            signature: `FREE_${tag}_${now}_${mint.slice(0, 8)}`,
            slot: 0,
            detectedAt: now,
            eventKind: mapped.kind,
            mintVerified: true,
            prefetchedSymbol: symbol || undefined,
            prefetchedLiquidityUsd: Number.isFinite(liqUsd) && liqUsd > 0 ? liqUsd : undefined,
            prefetchedPriceSol: Number.isFinite(priceSol) && priceSol > 0 ? priceSol : undefined,
            prefetchedM5Buys: m5Buys,
            prefetchedM5Sells: m5Sells,
            prefetchedM5VolumeUsd: Number.isFinite(m5VolUsd) ? m5VolUsd : undefined,
            prefetchedH1VolumeUsd: Number.isFinite(h1VolUsd) && h1VolUsd > 0 ? h1VolUsd : undefined,
            prefetchedM5PriceChangePct: Number.isFinite(m5ChangePct) ? m5ChangePct : undefined,
            prefetchedH1PriceChangePct: Number.isFinite(h1ChangePct) ? h1ChangePct : undefined,
            prefetchedFdvUsd: Number.isFinite(fdvUsd) && fdvUsd > 0 ? fdvUsd : undefined,
            prefetchedAgeMinutes: ageMinutes,
            crossDexPoolCount: 1,
            crossDexTotalLiquidityUsd: Number.isFinite(liqUsd) && liqUsd > 0 ? liqUsd : undefined,
          },
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      for (const item of candidates.slice(0, this.maxCandidatesPerPoll)) {
        if (this.stopped) return;
        if (!this.markMintSeen(item.event.mint)) continue;
        this.recordPoolHistory({
          mint: item.event.mint,
          poolAddress: item.event.poolAddress,
          dex: item.event.dex,
          liquidityUsd: item.liqUsd,
          crossDexPoolCount: 1,
          status: 'QUEUED',
          detectedAt: Date.now(),
        });
        this.scannerStats.emittedPools++;
        this.emit('pool_discovered', item.event);
      }
    } catch (err) {
      if (
        err instanceof GlobalCooldownError &&
        !this.httpClient.isHostCooldownActive('https://api.geckoterminal.com')
      ) {
        return;
      }
      if (this.isRateLimitError(err) || err instanceof GlobalCooldownError) {
        this.gecko429Streak = Math.min(4, this.gecko429Streak + 1);
        const retryAfterMs = extractRetryAfterFromError(err);
        const jitter = computeRandomJitterMs(500, 2000);
        const baseBackoff = Math.min(240_000, 30_000 * Math.pow(2, this.gecko429Streak - 1));
        const backoffMs =
          retryAfterMs !== null && retryAfterMs > 0
            ? Math.max(retryAfterMs, 30_000) + jitter
            : baseBackoff + jitter;
        this.geckoBackoffUntil = Math.max(
          this.geckoBackoffUntil,
          Date.now() + backoffMs,
        );
      }
      this.emit('listener_error', {
        dex: `${tag}_FREE_FEED`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async pollDexScreenerRotatingFeed(): Promise<void> {
    const discoveryEndpoints = [
      { url: 'https://api.dexscreener.com/token-boosts/latest/v1', isBoostFeed: true },
      { url: 'https://api.dexscreener.com/token-profiles/latest/v1', isBoostFeed: false },
      { url: 'https://api.dexscreener.com/token-boosts/top/v1', isBoostFeed: true },
    ];
    const picked = discoveryEndpoints[this.dexScreenerRotateIdx % discoveryEndpoints.length];
    this.dexScreenerRotateIdx++;

    try {
      const rawItems = await this.httpClient.get<Array<{ chainId?: string; tokenAddress?: string }>>(
        picked.url,
        { axiosConfig: { timeout: 3500 }, allowStaleOnCooldown: false },
      );

      const boostedSet = new Set<string>(
        picked.isBoostFeed
          ? (rawItems ?? [])
              .filter((b) => b.chainId === 'solana' && b.tokenAddress)
              .map((b) => b.tokenAddress!)
          : [],
      );

      const now = Date.now();
      const solanaMints = Array.from(
        new Set(
          (rawItems ?? [])
            .filter((p) => p.chainId === 'solana' && p.tokenAddress)
            .map((p) => p.tokenAddress!)
            .filter((m) => m !== WSOL_MINT && !this.isMintSeenActive(m, now)),
        ),
      ).slice(0, 20);

      if (solanaMints.length === 0) return;

      const pairsPayload = await this.httpClient.get<{ pairs?: DexScreenerPair[] }>(
        `https://api.dexscreener.com/latest/dex/tokens/${solanaMints.join(',')}`,
        { axiosConfig: { timeout: 3500 }, allowStaleOnCooldown: false },
      );
      this.dexScreener429Streak = 0;

      // Cross-DEX Aggregation across all pools for each mint
      const poolsByMint = new Map<string, DexScreenerPair[]>();
      for (const pair of pairsPayload?.pairs ?? []) {
        const mint = pair.baseToken?.address;
        if (!mint || pair.chainId !== 'solana' || pair.quoteToken?.address !== WSOL_MINT) {
          continue;
        }
        const arr = poolsByMint.get(mint) ?? [];
        arr.push(pair);
        poolsByMint.set(mint, arr);
      }

      const candidates: Array<{ score: number; event: PoolDiscoveryEvent; liqUsd: number; count: number }> = [];

      for (const [mint, mintPairs] of poolsByMint.entries()) {
        if (this.stopped) return;
        // Prime shared 5-10s cache for downstream Orderflow / MarketSnapshot / Metadata consumers
        this.httpClient.primeCache(
          `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
          { pairs: mintPairs },
        );
        const sorted = [...mintPairs].sort(
          (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
        );
        const pair = sorted[0];
        if (!pair) continue;

        const poolAddress = pair.pairAddress ?? mint;
        if (!this.isValidMintAndPool(mint, poolAddress)) continue;
        if (this.isMintSeenActive(mint, now)) continue;

        const ageMinutes = pair.pairCreatedAt
          ? Math.max(0.5, Number(((now - pair.pairCreatedAt) / 60_000).toFixed(1)))
          : undefined;

        if (ageMinutes !== undefined && ageMinutes > 720) {
          this.markMintSeen(mint);
          continue;
        }

        const topLiq = Number(pair.liquidity?.usd ?? 0);
        const m5Buys = Number(pair.txns?.m5?.buys ?? 0);
        const m5Sells = Number(pair.txns?.m5?.sells ?? 0);

        // Pre-filter junk/micro/inactive pools before emitting or marking long 15m seen
        if (
          (Number.isFinite(topLiq) && topLiq > 0 && topLiq < this.minDiscoveryLiquidityUsd) ||
          (pair.txns?.m5 !== undefined && m5Buys + m5Sells === 0)
        ) {
          this.scannerStats.prefilterJunkSkipped++;
          this.markMintCooldown(mint, 60_000);
          continue;
        }

        const mapped = this.mapDexId(pair.dexId);
        const crossDexTotalLiquidityUsd = sorted.reduce(
          (acc, p) => acc + Number(p.liquidity?.usd ?? 0),
          0,
        );
        const prices = sorted
          .map((p) => Number(p.priceNative ?? 0))
          .filter((p) => p > 0);
        const crossDexPriceSpreadPct =
          prices.length >= 2
            ? Number((((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100).toFixed(2))
            : 0;

        const socials = pair.info?.socials ?? [];
        const twitterUrl = socials.find((s) => s.type?.toLowerCase() === 'twitter')?.url;
        const telegramUrl = socials.find((s) => s.type?.toLowerCase() === 'telegram')?.url;
        const websiteUrl = pair.info?.websites?.[0]?.url;
        const isBoosted = boostedSet.has(mint) || (pair.boosts?.active ?? 0) > 0;
        const qualityRank =
          topLiq / 1000 + m5Buys * 3 + (isBoosted ? 12 : 0) + Math.min(20, (pair.volume?.m5 ?? 0) / 500);

        candidates.push({
          score: qualityRank,
          liqUsd: topLiq,
          count: sorted.length,
          event: {
            mint,
            poolAddress,
            quoteMint: WSOL_MINT,
            dex: mapped.dex,
            signature: `FREE_DEXSCREENER_${now}_${mint.slice(0, 8)}`,
            slot: 0,
            detectedAt: now,
            eventKind: mapped.kind,
            mintVerified: true,
            prefetchedSymbol: pair.baseToken?.symbol,
            prefetchedName: pair.baseToken?.name,
            prefetchedLiquidityUsd: pair.liquidity?.usd,
            prefetchedPriceSol: pair.priceNative ? Number(pair.priceNative) : undefined,
            prefetchedM5Buys: pair.txns?.m5?.buys,
            prefetchedM5Sells: pair.txns?.m5?.sells,
            prefetchedM5VolumeUsd: pair.volume?.m5,
            prefetchedH1VolumeUsd: pair.volume?.h1,
            prefetchedM5PriceChangePct: pair.priceChange?.m5,
            prefetchedH1PriceChangePct: pair.priceChange?.h1,
            prefetchedFdvUsd: pair.fdv,
            prefetchedAgeMinutes: ageMinutes,
            crossDexPoolCount: sorted.length,
            crossDexTotalLiquidityUsd,
            crossDexPriceSpreadPct,
            dexBoosted: isBoosted,
            twitterUrl,
            telegramUrl,
            websiteUrl,
          },
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      for (const item of candidates.slice(0, this.maxCandidatesPerPoll)) {
        if (this.stopped) return;
        if (!this.markMintSeen(item.event.mint)) continue;
        this.recordPoolHistory({
          mint: item.event.mint,
          poolAddress: item.event.poolAddress,
          dex: item.event.dex,
          liquidityUsd: item.liqUsd,
          crossDexPoolCount: item.count,
          status: 'QUEUED',
          detectedAt: Date.now(),
        });
        this.scannerStats.emittedPools++;
        this.emit('pool_discovered', item.event);
      }
    } catch (err) {
      if (
        err instanceof GlobalCooldownError &&
        !this.httpClient.isHostCooldownActive('https://api.dexscreener.com')
      ) {
        return;
      }
      if (this.isRateLimitError(err) || err instanceof GlobalCooldownError) {
        this.dexScreener429Streak = Math.min(4, this.dexScreener429Streak + 1);
        const retryAfterMs = extractRetryAfterFromError(err);
        const jitter = computeRandomJitterMs(500, 2000);
        const backoffMs =
          retryAfterMs !== null && retryAfterMs > 0
            ? Math.max(retryAfterMs, 30_000) + jitter
            : Math.min(180_000, 30_000 * Math.pow(2, this.dexScreener429Streak - 1)) + jitter;
        this.dexScreenerBackoffUntil = Math.max(
          this.dexScreenerBackoffUntil,
          Date.now() + backoffMs,
        );
        this.emit('listener_error', {
          dex: 'DEXSCREENER_FREE_FEED',
          error: `DexScreener rate-limited (429/503) — backoff ${(backoffMs / 1000).toFixed(0)}s`,
        });
        return;
      }
      this.emit('listener_error', {
        dex: 'DEXSCREENER_FREE_FEED',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private subscribeStream(stream: StreamConfig, attempt: number): void {
    if (this.stopped) return;

    const conn: Connection = this.rpcManager.getConnection('processed');
    try {
      const subId = conn.onLogs(
        stream.programId,
        (logInfo: Logs, ctx) => {
          if (logInfo.err) return;
          const match = stream.matchLogs(logInfo.logs);
          if (!match.matched) return;

          void this.resolveAndEmitPool(stream.dex, logInfo.signature, ctx.slot, match.kind);
        },
        'processed',
      );

      this.subscriptionIds.set(stream.dex, subId);
      this.emit('listener_status', { dex: stream.dex, status: 'CONNECTED', subId });
    } catch (err) {
      this.emit('listener_error', {
        dex: stream.dex,
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleReconnect(stream, attempt + 1);
    }
  }

  private scheduleReconnect(stream: StreamConfig, attempt: number): void {
    if (this.stopped) return;
    const existing = this.reconnectTimers.get(stream.dex);
    if (existing) clearTimeout(existing);

    const delayMs = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt, 5)));
    const timer = setTimeout(() => {
      this.subscribeStream(stream, attempt);
    }, delayMs);
    this.reconnectTimers.set(stream.dex, timer);
  }

  private async resolveAndEmitPool(
    dex: DexSource,
    signature: string,
    slot: number,
    eventKind: 'NEW_POOL' | 'MIGRATION',
  ): Promise<void> {
    try {
      const tx = await this.rpcManager.withFallback((conn) =>
        conn.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }),
      );

      if (!tx || !tx.meta) return;

      const postBalances = tx.meta.postTokenBalances ?? [];
      const candidateMints = Array.from(
        new Set(
          postBalances
            .map((b) => b.mint)
            .filter((m) => m && m !== WSOL_MINT && !m.endsWith('1111111111111111111111111')),
        ),
      );

      if (candidateMints.length === 0) return;

      const mint = candidateMints[0];
      if (!this.markMintSeen(mint)) {
        return;
      }

      const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
      const creatorAddress = accountKeys[0];
      const poolAddress = accountKeys[1] ?? signature;

      if (!this.isValidMintAndPool(mint, poolAddress)) {
        this.recordPoolHistory({
          mint,
          poolAddress,
          dex,
          liquidityUsd: 0,
          crossDexPoolCount: 1,
          status: 'REJECTED_INVALID',
          detectedAt: Date.now(),
        });
        return;
      }

      const lpBalance = postBalances.find((b) => b.mint !== mint && b.mint !== WSOL_MINT);

      this.recordPoolHistory({
        mint,
        poolAddress,
        dex,
        liquidityUsd: 0,
        crossDexPoolCount: 1,
        status: 'QUEUED',
        detectedAt: Date.now(),
      });

      const event: PoolDiscoveryEvent = {
        mint,
        poolAddress,
        lpMint: lpBalance?.mint,
        quoteMint: WSOL_MINT,
        dex,
        signature,
        slot,
        creatorAddress,
        detectedAt: Date.now(),
        eventKind,
        mintVerified: true,
        crossDexPoolCount: 1,
      };

      this.emit('pool_discovered', event);
    } catch (err) {
      this.emit('listener_error', {
        dex,
        signature,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
