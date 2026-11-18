import { createJupiterApiClient } from '@jup-ag/api';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { EnvConfig, TradingMode } from '../config/env';
import { RuntimeConfig } from '../config/runtimeConfig';
import { extractRetryAfterFromError, isHttp429Error, sharedHttpClient } from '../core/httpClient';
import { JitoClient, TipUrgency } from '../core/jito';
import { RpcManager } from '../core/rpc';
import { TransactionSimulator } from '../core/simulation';
import { DexSource, ExecutionResult, MarketSnapshot } from '../core/types';
import { WalletManager } from '../core/wallet';
import { SniperDatabase } from '../analytics/database';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export interface ExecutionTelemetrySummary {
  totalAttempts: number;
  succeeded: number;
  failed: number;
  duplicateBlocked: number;
  avgLatencyMs: number;
  avgSlippageDiffPct: number;
  routeCounts: Record<string, number>;
}

export class SmartExecutionRouter {
  private readonly jupiterClient: ReturnType<typeof createJupiterApiClient>;
  private readonly jupiterFallbackClient: ReturnType<typeof createJupiterApiClient>;
  private raydiumSdk: Raydium | null = null;
  private readonly decimalsCache = new Map<string, number>();
  private readonly livePriceCache = new Map<string, { priceSol: number; cachedAt: number }>();
  private readonly inflightOrderLocks = new Set<string>();
  private readonly recentOrderLedger = new Map<string, number>();
  private readonly telemetry: ExecutionTelemetrySummary = {
    totalAttempts: 0,
    succeeded: 0,
    failed: 0,
    duplicateBlocked: 0,
    avgLatencyMs: 0,
    avgSlippageDiffPct: 0,
    routeCounts: {},
  };

  constructor(
    private readonly env: EnvConfig,
    private readonly rpcManager: RpcManager,
    private readonly wallet: WalletManager,
    private readonly jito: JitoClient,
    private readonly simulator: TransactionSimulator,
    private readonly db: SniperDatabase,
  ) {
    this.jupiterClient = createJupiterApiClient();
    this.jupiterFallbackClient = createJupiterApiClient({
      basePath: 'https://lite-api.jup.ag/swap/v1',
    });
  }

  public getTelemetrySummary(): ExecutionTelemetrySummary {
    return {
      ...this.telemetry,
      routeCounts: { ...this.telemetry.routeCounts },
    };
  }

  private recordExecutionTelemetry(res: ExecutionResult, latencyMs: number): void {
    this.telemetry.totalAttempts++;
    if (res.success) {
      this.telemetry.succeeded++;
      this.telemetry.routeCounts[res.dexRoute] = (this.telemetry.routeCounts[res.dexRoute] ?? 0) + 1;
      const n = this.telemetry.succeeded;
      this.telemetry.avgLatencyMs = Math.round(
        (this.telemetry.avgLatencyMs * (n - 1) + latencyMs) / n,
      );
      if (res.slippageDiffPct !== undefined) {
        this.telemetry.avgSlippageDiffPct = Number(
          ((this.telemetry.avgSlippageDiffPct * (n - 1) + Math.abs(res.slippageDiffPct)) / n).toFixed(2),
        );
      }
    } else {
      this.telemetry.failed++;
    }
  }

  private async ensureRaydiumSdk(): Promise<Raydium | null> {
    if (this.raydiumSdk) return this.raydiumSdk;
    try {
      this.raydiumSdk = await Raydium.load({
        owner: this.wallet.keypair,
        connection: this.rpcManager.getConnection('confirmed'),
        cluster: 'mainnet',
        disableFeatureCheck: true,
        blockhashCommitment: 'confirmed',
      });
      return this.raydiumSdk;
    } catch {
      return null;
    }
  }

  public computeEffectiveFees(
    cfg: RuntimeConfig,
    orderSizeSol = 0.05,
  ): {
    effectiveJitoTipSol: number;
    buyPrioritySol: number;
    sellPrioritySol: number;
    totalRoundTripFeeSol: number;
    feeRatioPct: number;
  } {
    const safeOrderSol = orderSizeSol > 0 ? orderSizeSol : 0.05;
    const buyPrioritySol = 0.0002;
    const sellPrioritySol = 0.0002;
    const basePriorityTotal = buyPrioritySol + sellPrioritySol;
    const maxBudgetSol = Math.max(0.0005, safeOrderSol * (cfg.maxFeeRatioPct / 100));
    const maxAllowedTipPerSide = Math.max(0.00005, (maxBudgetSol - basePriorityTotal) / 2);
    const effectiveJitoTipSol = Number(Math.min(cfg.jitoTipSol, maxAllowedTipPerSide).toFixed(6));
    const totalRoundTripFeeSol = Number(
      (effectiveJitoTipSol * 2 + basePriorityTotal).toFixed(6),
    );
    const feeRatioPct = Number(((totalRoundTripFeeSol / safeOrderSol) * 100).toFixed(2));

    return {
      effectiveJitoTipSol,
      buyPrioritySol,
      sellPrioritySol,
      totalRoundTripFeeSol,
      feeRatioPct,
    };
  }

  /**
   * Real-time Exit Route check used by PositionManager prior to triggering emergency exits
   */
  public async verifyExitRouteQuote(
    mint: string,
    tokenAmountUi: number,
  ): Promise<{ routable: boolean; expectedSolOut: number; priceSol: number | null; slippagePct: number | null }> {
    if (tokenAmountUi <= 0) {
      return { routable: false, expectedSolOut: 0, priceSol: null, slippagePct: null };
    }
    const decimals = await this.getMintDecimals(mint);
    const rawIn = Math.max(1, Math.floor(tokenAmountUi * Math.pow(10, decimals)));

    const candidates: Array<{
      url: string;
      client: ReturnType<typeof createJupiterApiClient>;
      slippageBps: number;
    }> = [
      { url: 'https://lite-api.jup.ag', client: this.jupiterFallbackClient, slippageBps: 2000 },
      { url: 'https://quote-api.jup.ag', client: this.jupiterClient, slippageBps: 1800 },
    ];

    for (const c of candidates) {
      if (sharedHttpClient.isHostCooldownActive(c.url)) continue;
      try {
        const quote = await c.client.quoteGet({
          inputMint: mint,
          outputMint: WSOL_MINT,
          amount: rawIn,
          slippageBps: c.slippageBps,
        });
        const outLamports = Number(quote.outAmount ?? 0);
        if (outLamports > 0) {
          const expectedSolOut = outLamports / LAMPORTS_PER_SOL;
          const impact = Math.abs(Number(quote.priceImpactPct ?? 0)) * 100;
          return {
            routable: true,
            expectedSolOut,
            priceSol: expectedSolOut / tokenAmountUi,
            slippagePct: Number.isFinite(impact) ? Number(impact.toFixed(2)) : null,
          };
        }
      } catch (err) {
        if (isHttp429Error(err)) {
          sharedHttpClient.triggerHostCooldown(
            c.url,
            `Jupiter exit quote HTTP 429`,
            extractRetryAfterFromError(err),
          );
        }
      }
    }
    return { routable: false, expectedSolOut: 0, priceSol: null, slippagePct: null };
  }

  public async fetchMarketSnapshot(
    mint: string,
    buyAmountSol = 0.05,
    fallback?: {
      priceSol?: number;
      liquidityUsd?: number;
      solPriceUsd?: number;
      roundTripLossPct?: number | null;
    },
  ): Promise<MarketSnapshot> {
    const decimals = await this.getMintDecimals(mint);
    const testSol = Math.max(0.01, Math.min(0.25, buyAmountSol));
    const testLamports = Math.floor(testSol * LAMPORTS_PER_SOL);

    const prefetchedPrice =
      fallback?.priceSol && fallback.priceSol > 0 ? fallback.priceSol : null;
    const prefetchedLiq =
      fallback?.liquidityUsd && fallback.liquidityUsd > 0 ? fallback.liquidityUsd : null;

    // Fast path: if Stage 1 + Stage 2 already verified price, liquidity, and round-trip spread, zero extra HTTP calls needed
    if (
      prefetchedPrice !== null &&
      prefetchedLiq !== null &&
      fallback?.roundTripLossPct !== undefined &&
      fallback.roundTripLossPct !== null
    ) {
      const solUsdEst = fallback.solPriceUsd && fallback.solPriceUsd > 10 ? fallback.solPriceUsd : 165;
      const orderUsd = testSol * solUsdEst;
      const estSlippage = Number(
        Math.min(25, Math.max(0.5, (orderUsd / (prefetchedLiq * 2)) * 100 + 0.6)).toFixed(2),
      );
      return {
        mint,
        priceSol: prefetchedPrice,
        liquidityUsd: prefetchedLiq,
        roundTripLossPct: fallback.roundTripLossPct,
        buyPriceImpactPct: Number((fallback.roundTripLossPct * 0.45).toFixed(2)),
        estimatedExitSlippagePct: estSlippage,
        canBuyOnJupiter: true,
        canSellOnJupiter: true,
        decimals,
        source: 'DEXSCREENER',
      };
    }

    let jupPriceSol: number | null = null;
    let roundTripLossPct: number | null = fallback?.roundTripLossPct ?? null;
    let buyPriceImpactPct: number | null = null;
    let estimatedExitSlippagePct: number | null = null;
    let canBuyOnJupiter = fallback?.roundTripLossPct !== undefined && fallback.roundTripLossPct !== null;
    let canSellOnJupiter = canBuyOnJupiter;

    const jupPromise = (async () => {
      if (roundTripLossPct !== null) return;
      const jupRoutes: Array<{ url: string; client: ReturnType<typeof createJupiterApiClient> }> = [
        { url: 'https://lite-api.jup.ag', client: this.jupiterFallbackClient },
        { url: 'https://quote-api.jup.ag', client: this.jupiterClient },
      ];

      for (const route of jupRoutes) {
        if (sharedHttpClient.isHostCooldownActive(route.url)) continue;
        try {
          const buyQuote = await route.client.quoteGet({
            inputMint: WSOL_MINT,
            outputMint: mint,
            amount: testLamports,
            slippageBps: 1200,
          });

          const outAmt = Number(buyQuote.outAmount);
          if (outAmt > 0) {
            canBuyOnJupiter = true;
            const uiTokens = outAmt / Math.pow(10, decimals);
            if (uiTokens > 0) {
              jupPriceSol = testSol / uiTokens;
            }
            const impact = Number(buyQuote.priceImpactPct ?? 0);
            if (Number.isFinite(impact)) {
              buyPriceImpactPct = Number((Math.abs(impact) * 100).toFixed(2));
            }

            const sellQuote = await route.client.quoteGet({
              inputMint: mint,
              outputMint: WSOL_MINT,
              amount: Math.floor(outAmt),
              slippageBps: 1200,
            });
            const returnedLamports = Number(sellQuote.outAmount ?? 0);
            if (returnedLamports > 0) {
              canSellOnJupiter = true;
              roundTripLossPct = Number(
                Math.max(0, ((testLamports - returnedLamports) / testLamports) * 100).toFixed(2),
              );
              const sellImpact = Number(sellQuote.priceImpactPct ?? 0);
              estimatedExitSlippagePct = Number.isFinite(sellImpact)
                ? Number((Math.abs(sellImpact) * 100).toFixed(2))
                : Number((roundTripLossPct * 0.55).toFixed(2));
            }
            return;
          }
        } catch (err) {
          if (isHttp429Error(err)) {
            sharedHttpClient.triggerHostCooldown(
              route.url,
              `Jupiter quoteGet HTTP 429`,
              extractRetryAfterFromError(err),
            );
          }
        }
      }
    })();

    let dexPriceSol: number | null = null;
    let liquidityUsd: number | null = null;

    // Skip redundant DexScreener lookup when Stage 1 discovery already provided valid price + liquidity
    const dexPromise =
      prefetchedPrice !== null && prefetchedLiq !== null
        ? Promise.resolve()
        : sharedHttpClient
            .get<{
              pairs?: Array<{ priceNative?: string; liquidity?: { usd?: number } }>;
            }>(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
              axiosConfig: { timeout: 1500 },
              maxRetries: 1,
            })
            .then((data) => {
              const sorted = (data?.pairs ?? []).sort(
                (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
              );
              const top = sorted[0];
              if (top) {
                const nativePrice = Number(top.priceNative ?? 0);
                if (nativePrice > 0) dexPriceSol = nativePrice;
                const liq = Number(top.liquidity?.usd ?? 0);
                if (liq > 0) liquidityUsd = liq;
              }
            })
            .catch(() => {});

    await Promise.all([jupPromise, dexPromise]);

    const priceSol = jupPriceSol ?? dexPriceSol ?? prefetchedPrice;
    const effectiveLiquidityUsd = liquidityUsd ?? prefetchedLiq;

    if (estimatedExitSlippagePct === null && effectiveLiquidityUsd && effectiveLiquidityUsd > 0) {
      const solUsdEst = fallback?.solPriceUsd && fallback.solPriceUsd > 10 ? fallback.solPriceUsd : 165;
      const orderUsd = testSol * solUsdEst;
      estimatedExitSlippagePct = Number(
        Math.min(25, Math.max(0.5, (orderUsd / (effectiveLiquidityUsd * 2)) * 100 + 0.6)).toFixed(2),
      );
    }

    const source: MarketSnapshot['source'] =
      jupPriceSol !== null
        ? 'JUPITER_V6'
        : dexPriceSol !== null || prefetchedPrice !== null
          ? 'DEXSCREENER'
          : 'NONE';

    return {
      mint,
      priceSol,
      liquidityUsd: effectiveLiquidityUsd,
      roundTripLossPct,
      buyPriceImpactPct,
      estimatedExitSlippagePct,
      canBuyOnJupiter,
      canSellOnJupiter,
      decimals,
      source,
    };
  }

  public async fetchLiveTokenPriceInSol(mint: string): Promise<number | null> {
    const cached = this.livePriceCache.get(mint);
    if (cached && Date.now() - cached.cachedAt < 5_000) {
      return cached.priceSol;
    }

    const jupRoutes: Array<{ url: string; client: ReturnType<typeof createJupiterApiClient> }> = [
      { url: 'https://lite-api.jup.ag', client: this.jupiterFallbackClient },
      { url: 'https://quote-api.jup.ag', client: this.jupiterClient },
    ];

    for (const route of jupRoutes) {
      if (sharedHttpClient.isHostCooldownActive(route.url)) continue;
      try {
        const testLamports = 10_000_000;
        const quote = await route.client.quoteGet({
          inputMint: WSOL_MINT,
          outputMint: mint,
          amount: testLamports,
          slippageBps: 800,
        });

        const outAmt = Number(quote.outAmount);
        if (outAmt > 0) {
          const decimals = await this.getMintDecimals(mint);
          const uiTokens = outAmt / Math.pow(10, decimals);
          if (uiTokens > 0) {
            const px = 0.01 / uiTokens;
            this.livePriceCache.set(mint, { priceSol: px, cachedAt: Date.now() });
            return px;
          }
        }
      } catch (err) {
        if (isHttp429Error(err)) {
          sharedHttpClient.triggerHostCooldown(
            route.url,
            'Jupiter quoteGet HTTP 429',
            extractRetryAfterFromError(err),
          );
        }
      }
    }

    try {
      const data = await sharedHttpClient.get<{
        pairs?: Array<{ priceNative?: string; liquidity?: { usd?: number } }>;
      }>(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
        axiosConfig: { timeout: 1400 },
        maxRetries: 1,
      });

      const sorted = (data?.pairs ?? []).sort(
        (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
      );
      const nativePrice = Number(sorted[0]?.priceNative ?? 0);
      if (nativePrice > 0) {
        this.livePriceCache.set(mint, { priceSol: nativePrice, cachedAt: Date.now() });
        return nativePrice;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async executeBuy(params: {
    mint: string;
    dex: DexSource;
    poolAddress?: string;
    buyAmountSolOverride: number;
    urgency?: TipUrgency;
    cfg: RuntimeConfig;
    snapshot?: MarketSnapshot;
    solPriceUsd?: number;
  }): Promise<ExecutionResult> {
    const t0 = Date.now();
    const lockKey = `BUY:${params.cfg.tradingMode}:${params.mint}`;
    const lastOrderAt = this.recentOrderLedger.get(lockKey);
    if (this.inflightOrderLocks.has(lockKey) || (lastOrderAt && Date.now() - lastOrderAt < 10_000)) {
      this.telemetry.duplicateBlocked++;
      return {
        success: false,
        mode: params.cfg.tradingMode,
        side: 'BUY',
        mint: params.mint,
        dexRoute: params.cfg.tradingMode === 'PAPER' ? 'PAPER_SIM' : 'JUPITER_V6',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'Duplicate BUY blocked by idempotency guard (inflight or <10s)',
      };
    }

    this.inflightOrderLocks.add(lockKey);
    try {
      const orderSizeSol = Math.max(0.005, params.buyAmountSolOverride);
      const res =
        params.cfg.tradingMode === 'PAPER'
          ? await this.executePaperBuy(
              params.mint,
              orderSizeSol,
              params.cfg,
              params.snapshot,
              params.solPriceUsd,
            )
          : await this.executeLiveBuy(
              params.mint,
              params.dex,
              params.poolAddress,
              orderSizeSol,
              params.cfg,
              params.urgency ?? 'NORMAL',
              params.snapshot?.priceSol ?? undefined,
            );

      const latencyMs = Date.now() - t0;
      res.latencyMs = latencyMs;
      if (res.success) {
        this.recentOrderLedger.set(lockKey, Date.now());
      }
      this.recordExecutionTelemetry(res, latencyMs);
      return res;
    } finally {
      this.inflightOrderLocks.delete(lockKey);
    }
  }

  public async executeSell(params: {
    mint: string;
    dex: DexSource;
    poolAddress?: string;
    tokenAmountUi: number;
    decimals?: number;
    cfg: RuntimeConfig;
    modeOverride?: TradingMode;
    fallbackPriceSol?: number;
    isRugDrain?: boolean;
    isEmergencyExit?: boolean;
  }): Promise<ExecutionResult> {
    const t0 = Date.now();
    const activeMode = params.modeOverride ?? params.cfg.tradingMode;
    const lockKey = `SELL:${activeMode}:${params.mint}`;
    if (this.inflightOrderLocks.has(lockKey)) {
      this.telemetry.duplicateBlocked++;
      return {
        success: false,
        mode: activeMode,
        side: 'SELL',
        mint: params.mint,
        dexRoute: activeMode === 'PAPER' ? 'PAPER_SIM' : 'JUPITER_V6',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'Duplicate SELL blocked (inflight sell lock active)',
      };
    }

    this.inflightOrderLocks.add(lockKey);
    try {
      const res =
        activeMode === 'PAPER'
          ? await this.executePaperSell(
              params.mint,
              params.tokenAmountUi,
              params.cfg,
              params.fallbackPriceSol,
              params.isRugDrain,
            )
          : await this.executeLiveSell(
              params.mint,
              params.dex,
              params.poolAddress,
              params.tokenAmountUi,
              params.decimals ?? 6,
              params.cfg,
              Boolean(params.isEmergencyExit || params.isRugDrain),
              params.fallbackPriceSol,
            );

      const latencyMs = Date.now() - t0;
      res.latencyMs = latencyMs;
      this.recordExecutionTelemetry(res, latencyMs);
      return res;
    } finally {
      this.inflightOrderLocks.delete(lockKey);
    }
  }

  private async executePaperBuy(
    mint: string,
    orderSizeSol: number,
    cfg: RuntimeConfig,
    preloadedSnapshot?: MarketSnapshot,
    solPriceUsd = 165,
  ): Promise<ExecutionResult> {
    const feePlan = this.computeEffectiveFees(cfg, orderSizeSol);
    const paperWallet = this.db.getPaperBalance();
    const totalCostSol = orderSizeSol + feePlan.effectiveJitoTipSol + feePlan.buyPrioritySol;

    if (paperWallet.balanceSol < totalCostSol) {
      return {
        success: false,
        mode: 'PAPER',
        side: 'BUY',
        mint,
        dexRoute: 'PAPER_SIM',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: `Insufficient paper SOL balance (${paperWallet.balanceSol.toFixed(4)} SOL < ${totalCostSol.toFixed(4)} SOL)`,
      };
    }

    const snapshot =
      preloadedSnapshot ?? (await this.fetchMarketSnapshot(mint, orderSizeSol));

    if (!snapshot.priceSol || snapshot.priceSol <= 0) {
      return {
        success: false,
        mode: 'PAPER',
        side: 'BUY',
        mint,
        dexRoute: 'PAPER_SIM',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'Rejected: No verified live Jupiter/DexScreener price',
      };
    }

    if (
      cfg.minLiquidityUsd > 0 &&
      snapshot.liquidityUsd !== null &&
      snapshot.liquidityUsd < cfg.minLiquidityUsd
    ) {
      return {
        success: false,
        mode: 'PAPER',
        side: 'BUY',
        mint,
        dexRoute: 'PAPER_SIM',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: `Rejected: Liquidity $${snapshot.liquidityUsd.toFixed(0)} < $${cfg.minLiquidityUsd}`,
      };
    }

    if (
      cfg.spreadGuardEnabled &&
      snapshot.roundTripLossPct !== null &&
      snapshot.roundTripLossPct > cfg.maxRoundtripSpreadPct
    ) {
      return {
        success: false,
        mode: 'PAPER',
        side: 'BUY',
        mint,
        dexRoute: 'PAPER_SIM',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: `Rejected: Round-trip spread ${snapshot.roundTripLossPct}% > ${cfg.maxRoundtripSpreadPct}%`,
      };
    }

    const solUsdEst = solPriceUsd > 10 ? solPriceUsd : 165;
    const tradeUsdEst = orderSizeSol * solUsdEst;
    const depthImpact =
      snapshot.liquidityUsd && snapshot.liquidityUsd > 0
        ? tradeUsdEst / (snapshot.liquidityUsd * 2)
        : 0.005;
    const simulatedSlippage =
      1 + Math.min(0.025, Math.max(0.0025, depthImpact + (snapshot.roundTripLossPct ?? 1) / 400));
    const fillPriceSol = snapshot.priceSol * simulatedSlippage;
    const slippageDiffPct = Number(((simulatedSlippage - 1) * 100).toFixed(2));
    const tokensReceived = orderSizeSol / fillPriceSol;
    const scale = Math.pow(10, snapshot.decimals);

    this.db.adjustPaperBalance(-totalCostSol);

    return {
      success: true,
      mode: 'PAPER',
      side: 'BUY',
      mint,
      dexRoute: 'PAPER_SIM',
      signature: `PAPER_BUY_${Date.now()}_${mint.slice(0, 8)}`,
      solAmount: orderSizeSol,
      tokenAmountRaw: Math.floor(tokensReceived * scale).toString(),
      tokenAmountUi: tokensReceived,
      executionPriceSol: fillPriceSol,
      expectedPriceSol: snapshot.priceSol,
      priorityFeeSol: feePlan.buyPrioritySol,
      jitoTipSol: feePlan.effectiveJitoTipSol,
      reconciled: true,
      slippageDiffPct,
    };
  }

  private async executePaperSell(
    mint: string,
    tokenAmountUi: number,
    cfg: RuntimeConfig,
    fallbackPriceSol?: number,
    isRugDrain?: boolean,
  ): Promise<ExecutionResult> {
    const estOrderSol =
      fallbackPriceSol && fallbackPriceSol > 0 ? Math.max(0.01, tokenAmountUi * fallbackPriceSol) : 0.05;
    const feePlan = this.computeEffectiveFees(cfg, estOrderSol);
    const decimals = await this.getMintDecimals(mint);
    const scale = Math.pow(10, decimals);

    const liveMarketPrice = await this.fetchLiveTokenPriceInSol(mint);
    const effectiveMarketPrice = isRugDrain
      ? 0
      : liveMarketPrice ?? (fallbackPriceSol && fallbackPriceSol > 0 ? fallbackPriceSol : null);

    if (effectiveMarketPrice === null) {
      return {
        success: false,
        mode: 'PAPER',
        side: 'SELL',
        mint,
        dexRoute: 'PAPER_SIM',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'Live price temporarily unavailable during sell check',
      };
    }

    const slipFrac = Math.min(0.025, (cfg.slippageBps / 10000) * 0.08);
    const simulatedSlippage = 1 - slipFrac;
    const fillPriceSol = Math.max(0, effectiveMarketPrice * simulatedSlippage);
    const grossSolOut = tokenAmountUi * fillPriceSol;
    const fees = isRugDrain ? 0 : feePlan.effectiveJitoTipSol + feePlan.sellPrioritySol;
    const netSolOut = Math.max(0, grossSolOut - fees);

    this.db.adjustPaperBalance(netSolOut);

    return {
      success: true,
      mode: 'PAPER',
      side: 'SELL',
      mint,
      dexRoute: 'PAPER_SIM',
      signature: `PAPER_SELL_${Date.now()}_${mint.slice(0, 8)}`,
      solAmount: netSolOut,
      tokenAmountRaw: Math.floor(tokenAmountUi * scale).toString(),
      tokenAmountUi,
      executionPriceSol: fillPriceSol,
      expectedPriceSol: effectiveMarketPrice,
      priorityFeeSol: isRugDrain ? 0 : feePlan.sellPrioritySol,
      jitoTipSol: isRugDrain ? 0 : feePlan.effectiveJitoTipSol,
      reconciled: true,
      slippageDiffPct: Number((-slipFrac * 100).toFixed(2)),
    };
  }

  private async verifyLiveBuyBalance(params: {
    mint: string;
    signature: string;
    preUiAmount: number;
    expectedDecimals: number;
  }): Promise<{
    verified: boolean;
    deltaUi: number;
    deltaRaw: string;
    decimals: number;
    revertedOnChain: boolean;
    error?: string;
  }> {
    const backoffMs = [0, 500, 1000, 1500];
    let latestBalance = { rawAmount: '0', uiAmount: params.preUiAmount, decimals: params.expectedDecimals };

    for (const delay of backoffMs) {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      try {
        latestBalance = await this.rpcManager.withFallback((conn) =>
          this.wallet.getTokenBalanceUi(conn, params.mint),
        );
        const deltaUi = latestBalance.uiAmount - params.preUiAmount;
        if (deltaUi > 0) {
          const decimals = latestBalance.decimals || params.expectedDecimals;
          const deltaRaw = Math.floor(deltaUi * Math.pow(10, decimals)).toString();
          return {
            verified: true,
            deltaUi,
            deltaRaw,
            decimals,
            revertedOnChain: false,
          };
        }
      } catch {
        // Retry on transient RPC lag
      }
    }

    let revertedOnChain = false;
    try {
      const tx = await this.rpcManager.withFallback((conn) =>
        conn.getTransaction(params.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }),
      );
      if (tx?.meta?.err) {
        revertedOnChain = true;
      }
    } catch {
      // Ignore secondary lookup error
    }

    return {
      verified: false,
      deltaUi: 0,
      deltaRaw: '0',
      decimals: latestBalance.decimals || params.expectedDecimals,
      revertedOnChain,
      error: revertedOnChain
        ? `Tx ${params.signature.slice(0, 10)} reverted on-chain (0 tokens credited)`
        : `Post-buy balance verification failed: 0 tokens credited after 4 RPC checks`,
    };
  }

  private async reconcileLiveTransaction(params: {
    signature: string;
    mint: string;
    side: 'BUY' | 'SELL';
    expectedSolUi: number;
    tipSol: number;
  }): Promise<{
    reconciled: boolean;
    actualSolUi: number | null;
    actualTokenDeltaUi: number | null;
    actualFeeSol: number | null;
    slippageDiffPct: number;
  }> {
    if (!params.signature) {
      return {
        reconciled: false,
        actualSolUi: null,
        actualTokenDeltaUi: null,
        actualFeeSol: null,
        slippageDiffPct: 0,
      };
    }

    const walletStr = this.wallet.publicKey.toBase58();
    const retryDelays = [300, 900];
    for (const delay of retryDelays) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const tx = await this.rpcManager.withFallback((conn) =>
          conn.getTransaction(params.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          }),
        );
        if (!tx?.meta || tx.meta.err) continue;

        const msgKeys = tx.meta.loadedAddresses
          ? tx.transaction.message.getAccountKeys({
              accountKeysFromLookups: tx.meta.loadedAddresses,
            })
          : tx.transaction.message.getAccountKeys();
        let walletIdx = -1;
        for (let i = 0; i < msgKeys.length; i++) {
          if (msgKeys.get(i)?.toBase58() === walletStr) {
            walletIdx = i;
            break;
          }
        }
        if (walletIdx < 0) continue;

        const preLamports = tx.meta.preBalances[walletIdx] ?? 0;
        const postLamports = tx.meta.postBalances[walletIdx] ?? 0;
        const feeSol = (tx.meta.fee ?? 0) / LAMPORTS_PER_SOL;
        const netWalletSolDelta = (postLamports - preLamports) / LAMPORTS_PER_SOL;

        let preToken = 0;
        let postToken = 0;
        for (const b of tx.meta.preTokenBalances ?? []) {
          if (b.mint === params.mint && b.owner === walletStr) {
            preToken += Number(b.uiTokenAmount.uiAmount ?? 0);
          }
        }
        for (const b of tx.meta.postTokenBalances ?? []) {
          if (b.mint === params.mint && b.owner === walletStr) {
            postToken += Number(b.uiTokenAmount.uiAmount ?? 0);
          }
        }
        const tokenDelta = Math.abs(postToken - preToken);

        let actualSolUi: number;
        if (params.side === 'BUY') {
          const totalOut = Math.max(0, -netWalletSolDelta - feeSol - params.tipSol);
          actualSolUi = totalOut > 0 ? Number(totalOut.toFixed(6)) : params.expectedSolUi;
        } else {
          const netReceived = Math.max(0, netWalletSolDelta);
          actualSolUi = Number(netReceived.toFixed(6));
        }

        const slippageDiffPct =
          params.expectedSolUi > 0
            ? Number((((actualSolUi - params.expectedSolUi) / params.expectedSolUi) * 100).toFixed(2))
            : 0;

        return {
          reconciled: true,
          actualSolUi,
          actualTokenDeltaUi: tokenDelta > 0 ? tokenDelta : null,
          actualFeeSol: Number(feeSol.toFixed(6)),
          slippageDiffPct,
        };
      } catch {
        // Retry once on transient RPC fetch lag
      }
    }

    return {
      reconciled: false,
      actualSolUi: null,
      actualTokenDeltaUi: null,
      actualFeeSol: null,
      slippageDiffPct: 0,
    };
  }

  private async executeLiveBuy(
    mint: string,
    dex: DexSource,
    poolAddress: string | undefined,
    orderSizeSol: number,
    cfg: RuntimeConfig,
    urgency: TipUrgency = 'NORMAL',
    expectedPriceSol?: number,
  ): Promise<ExecutionResult> {
    if (this.wallet.isEphemeralPaperWallet) {
      return {
        success: false,
        mode: 'LIVE',
        side: 'BUY',
        mint,
        dexRoute: 'JUPITER_V6',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'Cannot execute LIVE trade without PRIVATE_KEY configured in .env',
      };
    }

    const lamportsIn = Math.floor(orderSizeSol * LAMPORTS_PER_SOL);
    const decimals = await this.getMintDecimals(mint);
    const preBalance = await this.rpcManager
      .withFallback((conn) => this.wallet.getTokenBalanceUi(conn, mint))
      .catch(() => ({ rawAmount: '0', uiAmount: 0, decimals }));

    const errors: string[] = [];

    if ((dex === 'RAYDIUM_CPMM' || dex === 'RAYDIUM_V4') && poolAddress) {
      const directAttempt = await this.tryDirectRaydiumSwap({
        side: 'BUY',
        mint,
        dex,
        poolAddress,
        amountRaw: lamportsIn.toString(),
        decimalsOut: decimals,
        solEquivalent: orderSizeSol,
        preTokenUi: preBalance.uiAmount,
        expectedPriceSol,
        cfg,
      });
      if (directAttempt.success) {
        return directAttempt;
      }
      if (directAttempt.error) errors.push(`DirectRaydium: ${directAttempt.error}`);
    }

    const jupPrimary = await this.executeJupiterSwapWithJito({
      client: this.jupiterClient,
      dexRouteLabel: 'JUPITER_V6',
      inputMint: WSOL_MINT,
      outputMint: mint,
      amountRaw: lamportsIn.toString(),
      side: 'BUY',
      decimalsOut: decimals,
      solEquivalent: orderSizeSol,
      preTokenUi: preBalance.uiAmount,
      expectedPriceSol,
      urgency,
      cfg,
    });
    if (jupPrimary.success) {
      return jupPrimary;
    }
    if (jupPrimary.error) errors.push(`JupiterPrimary: ${jupPrimary.error}`);

    const fallbackCfg: RuntimeConfig = {
      ...cfg,
      slippageBps: Math.min(2000, cfg.slippageBps + 300),
    };
    const jupFallback = await this.executeJupiterSwapWithJito({
      client: this.jupiterFallbackClient,
      dexRouteLabel: 'JUPITER_LITE',
      inputMint: WSOL_MINT,
      outputMint: mint,
      amountRaw: lamportsIn.toString(),
      side: 'BUY',
      decimalsOut: decimals,
      solEquivalent: orderSizeSol,
      preTokenUi: preBalance.uiAmount,
      expectedPriceSol,
      restrictIntermediateTokens: false,
      urgency,
      cfg: fallbackCfg,
    });
    if (jupFallback.success) {
      return jupFallback;
    }
    if (jupFallback.error) errors.push(`JupiterFallback: ${jupFallback.error}`);

    return {
      ...jupFallback,
      error: errors.join(' | ') || 'All live buy routes failed',
    };
  }

  private async executeLiveSell(
    mint: string,
    dex: DexSource,
    poolAddress: string | undefined,
    tokenAmountUi: number,
    decimals: number,
    cfg: RuntimeConfig,
    isEmergencyExit = false,
    expectedPriceSol?: number,
  ): Promise<ExecutionResult> {
    if (this.wallet.isEphemeralPaperWallet) {
      return {
        success: false,
        mode: 'LIVE',
        side: 'SELL',
        mint,
        dexRoute: 'JUPITER_V6',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'Cannot execute LIVE sell without PRIVATE_KEY configured in .env',
      };
    }

    const liveBalance = await this.rpcManager.withFallback((conn) =>
      this.wallet.getTokenBalanceUi(conn, mint),
    );
    const actualDecimals = liveBalance.decimals || decimals;
    const rawToSell = Math.min(
      Number(liveBalance.rawAmount),
      Math.floor(tokenAmountUi * Math.pow(10, actualDecimals)),
    );

    if (rawToSell <= 0) {
      return {
        success: false,
        mode: 'LIVE',
        side: 'SELL',
        mint,
        dexRoute: 'JUPITER_V6',
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: 'On-chain token balance is 0',
      };
    }

    const sellAmountRaw = Math.floor(rawToSell).toString();
    const sellUiIn = rawToSell / Math.pow(10, actualDecimals);
    const errors: string[] = [];

    const sellUrgency: TipUrgency = isEmergencyExit ? 'EMERGENCY' : 'NORMAL';
    const primaryCfg = isEmergencyExit
      ? { ...cfg, slippageBps: Math.min(2500, Math.max(cfg.slippageBps, 1800)) }
      : cfg;
    const jupPrimary = await this.executeJupiterSwapWithJito({
      client: this.jupiterClient,
      dexRouteLabel: 'JUPITER_V6',
      inputMint: mint,
      outputMint: WSOL_MINT,
      amountRaw: sellAmountRaw,
      side: 'SELL',
      decimalsOut: 9,
      solEquivalent: expectedPriceSol ? sellUiIn * expectedPriceSol : 0,
      tokenUiIn: sellUiIn,
      expectedPriceSol,
      urgency: sellUrgency,
      cfg: primaryCfg,
    });
    if (jupPrimary.success) {
      return jupPrimary;
    }
    if (jupPrimary.error) errors.push(`JupiterPrimary: ${jupPrimary.error}`);

    const jupFallback = await this.executeJupiterSwapWithJito({
      client: this.jupiterFallbackClient,
      dexRouteLabel: 'JUPITER_LITE',
      inputMint: mint,
      outputMint: WSOL_MINT,
      amountRaw: sellAmountRaw,
      side: 'SELL',
      decimalsOut: 9,
      solEquivalent: expectedPriceSol ? sellUiIn * expectedPriceSol : 0,
      tokenUiIn: sellUiIn,
      expectedPriceSol,
      restrictIntermediateTokens: false,
      urgency: sellUrgency,
      cfg: { ...cfg, slippageBps: Math.min(3000, cfg.slippageBps + (isEmergencyExit ? 1200 : 500)) },
    });
    if (jupFallback.success) {
      return jupFallback;
    }
    if (jupFallback.error) errors.push(`JupiterFallback: ${jupFallback.error}`);

    if ((dex === 'RAYDIUM_CPMM' || dex === 'RAYDIUM_V4') && poolAddress) {
      const directSell = await this.tryDirectRaydiumSwap({
        side: 'SELL',
        mint,
        dex,
        poolAddress,
        amountRaw: sellAmountRaw,
        decimalsOut: 9,
        solEquivalent: expectedPriceSol ? sellUiIn * expectedPriceSol : 0,
        tokenUiIn: sellUiIn,
        expectedPriceSol,
        cfg: primaryCfg,
      });
      if (directSell.success) {
        return directSell;
      }
      if (directSell.error) errors.push(`DirectRaydium: ${directSell.error}`);
    }

    return {
      ...jupFallback,
      error: errors.join(' | ') || 'All live sell routes failed',
    };
  }

  private async tryDirectRaydiumSwap(params: {
    side: 'BUY' | 'SELL';
    mint: string;
    dex: 'RAYDIUM_CPMM' | 'RAYDIUM_V4';
    poolAddress: string;
    amountRaw: string;
    decimalsOut: number;
    solEquivalent: number;
    tokenUiIn?: number;
    preTokenUi?: number;
    expectedPriceSol?: number;
    cfg: RuntimeConfig;
  }): Promise<ExecutionResult> {
    const baseFail = (error: string): ExecutionResult => ({
      success: false,
      mode: 'LIVE',
      side: params.side,
      mint: params.mint,
      dexRoute: 'DIRECT_DEX',
      signature: '',
      solAmount: 0,
      tokenAmountRaw: '0',
      tokenAmountUi: 0,
      executionPriceSol: 0,
      priorityFeeSol: 0,
      jitoTipSol: 0,
      error,
    });

    try {
      const raydium = await this.ensureRaydiumSdk();
      if (!raydium) {
        return baseFail('Raydium SDK initialization failed');
      }

      const inputMint = params.side === 'BUY' ? WSOL_MINT : params.mint;
      const outputMint = params.side === 'BUY' ? params.mint : WSOL_MINT;
      const amountInBn = new BN(params.amountRaw);
      const slippage = params.cfg.slippageBps / 10_000;
      const microLamports = await this.rpcManager.getDynamicPriorityFeeMicroLamports(
        this.env.maxPriorityFeeLamports,
      );

      let txId = '';
      let expectedOutRaw = '0';

      if (params.dex === 'RAYDIUM_CPMM') {
        const data = await raydium.cpmm.getPoolInfoFromRpc(params.poolAddress);
        if (!data?.poolInfo) {
          return baseFail('CPMM pool info unavailable');
        }
        const baseIn = inputMint === data.poolInfo.mintA.address;
        const swapCalc = raydium.cpmm.computeSwapAmount({
          pool: data.computePoolInfo,
          amountIn: amountInBn,
          outputMint,
          slippage,
          swapBaseIn: true,
        });
        expectedOutRaw = swapCalc.minAmountOut.toString();

        const { execute } = await raydium.cpmm.swap({
          poolInfo: data.poolInfo,
          poolKeys: data.poolKeys,
          inputAmount: amountInBn,
          swapResult: swapCalc.swapResult,
          slippage,
          baseIn,
          txVersion: TxVersion.V0,
          computeBudgetConfig: {
            units: 250_000,
            microLamports,
          },
        });
        const res = await execute({ sendAndConfirm: true });
        txId = res.txId;
      } else {
        const { poolInfo, poolKeys } = await raydium.liquidity.getPoolInfoFromRpc({
          poolId: params.poolAddress,
        });
        const out = raydium.liquidity.computeAmountOut({
          poolInfo,
          amountIn: amountInBn,
          mintIn: inputMint,
          mintOut: outputMint,
          slippage,
        });
        expectedOutRaw = out.minAmountOut.toString();

        const { execute } = await raydium.liquidity.swap({
          poolInfo,
          poolKeys,
          amountIn: amountInBn,
          amountOut: out.minAmountOut,
          fixedSide: 'in',
          inputMint,
          txVersion: TxVersion.V0,
          computeBudgetConfig: {
            units: 250_000,
            microLamports,
          },
        });
        const res = await execute({ sendAndConfirm: true });
        txId = res.txId;
      }

      if (params.side === 'BUY') {
        const verify = await this.verifyLiveBuyBalance({
          mint: params.mint,
          signature: txId,
          preUiAmount: params.preTokenUi ?? 0,
          expectedDecimals: params.decimalsOut,
        });
        if (!verify.verified) {
          return baseFail(verify.error ?? 'Balance verification failed');
        }

        const expectedSol = Number(params.amountRaw) / LAMPORTS_PER_SOL;
        const recon = await this.reconcileLiveTransaction({
          signature: txId,
          mint: params.mint,
          side: 'BUY',
          expectedSolUi: expectedSol,
          tipSol: 0,
        });
        const solSpent = recon.actualSolUi ?? expectedSol;
        const tokensReceived = recon.actualTokenDeltaUi ?? verify.deltaUi;

        return {
          success: true,
          mode: 'LIVE',
          side: 'BUY',
          mint: params.mint,
          dexRoute: 'DIRECT_DEX',
          signature: txId,
          solAmount: solSpent,
          tokenAmountRaw: verify.deltaRaw,
          tokenAmountUi: tokensReceived,
          executionPriceSol: tokensReceived > 0 ? solSpent / tokensReceived : 0,
          expectedPriceSol: params.expectedPriceSol,
          priorityFeeSol: recon.actualFeeSol ?? 0.0002,
          jitoTipSol: 0,
          balanceVerified: true,
          reconciled: recon.reconciled,
          slippageDiffPct: recon.slippageDiffPct,
        };
      }

      const expectedSolOut = Number(expectedOutRaw) / Math.pow(10, params.decimalsOut);
      const recon = await this.reconcileLiveTransaction({
        signature: txId,
        mint: params.mint,
        side: 'SELL',
        expectedSolUi: expectedSolOut,
        tipSol: 0,
      });
      const solOutUi = recon.actualSolUi ?? expectedSolOut;
      const tokenInUi = recon.actualTokenDeltaUi ?? (params.tokenUiIn ?? 0);
      return {
        success: true,
        mode: 'LIVE',
        side: 'SELL',
        mint: params.mint,
        dexRoute: 'DIRECT_DEX',
        signature: txId,
        solAmount: solOutUi,
        tokenAmountRaw: expectedOutRaw,
        tokenAmountUi: tokenInUi,
        executionPriceSol: tokenInUi > 0 ? solOutUi / tokenInUi : 0,
        expectedPriceSol: params.expectedPriceSol,
        priorityFeeSol: recon.actualFeeSol ?? 0.0002,
        jitoTipSol: 0,
        reconciled: recon.reconciled,
        slippageDiffPct: recon.slippageDiffPct,
      };
    } catch (err) {
      return baseFail(err instanceof Error ? err.message : String(err));
    }
  }

  private async executeJupiterSwapWithJito(params: {
    client: ReturnType<typeof createJupiterApiClient>;
    dexRouteLabel: 'JUPITER_V6' | 'JUPITER_LITE';
    inputMint: string;
    outputMint: string;
    amountRaw: string;
    side: 'BUY' | 'SELL';
    decimalsOut: number;
    solEquivalent: number;
    tokenUiIn?: number;
    preTokenUi?: number;
    expectedPriceSol?: number;
    restrictIntermediateTokens?: boolean;
    urgency?: TipUrgency;
    cfg: RuntimeConfig;
  }): Promise<ExecutionResult> {
    const conn = this.rpcManager.getConnection('confirmed');
    const targetMint = params.side === 'BUY' ? params.outputMint : params.inputMint;
    const orderSizeSol = params.solEquivalent > 0 ? params.solEquivalent : 0.05;
    const feePlan = this.computeEffectiveFees(params.cfg, orderSizeSol);
    const dynamicTip = await this.jito.computeDynamicTip({
      baseTipSol: feePlan.effectiveJitoTipSol,
      buyAmountSol: orderSizeSol,
      maxFeeRatioPct: params.cfg.maxFeeRatioPct,
      dynamicEnabled: params.cfg.dynamicJitoTipEnabled,
      urgency: params.urgency ?? 'NORMAL',
    });
    const activeJitoTipSol = dynamicTip.tipSol;

    try {
      const quote = await params.client.quoteGet({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: Number(params.amountRaw),
        slippageBps: params.cfg.slippageBps,
        restrictIntermediateTokens: params.restrictIntermediateTokens ?? true,
      });

      const impactPct = Math.abs(Number(quote.priceImpactPct ?? 0)) * 100;
      if (
        params.side === 'BUY' &&
        params.cfg.spreadGuardEnabled &&
        impactPct > params.cfg.maxPriceImpactPct
      ) {
        return {
          success: false,
          mode: 'LIVE',
          side: 'BUY',
          mint: targetMint,
          dexRoute: params.dexRouteLabel,
          signature: '',
          solAmount: 0,
          tokenAmountRaw: '0',
          tokenAmountUi: 0,
          executionPriceSol: 0,
          priorityFeeSol: 0,
          jitoTipSol: 0,
          error: `Rejected: Jupiter price impact ${impactPct.toFixed(1)}% > ${params.cfg.maxPriceImpactPct}%`,
        };
      }

      const dynamicMicroLamports = await this.rpcManager.getDynamicPriorityFeeMicroLamports(
        this.env.maxPriorityFeeLamports,
        params.urgency ?? 'NORMAL',
      );

      const swapRes = await params.client.swapPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: dynamicMicroLamports,
              priorityLevel: 'veryHigh',
            },
          },
        },
      });

      const rawTx = VersionedTransaction.deserialize(
        Buffer.from(swapRes.swapTransaction, 'base64'),
      );

      const lookupTableAccounts = await Promise.all(
        rawTx.message.addressTableLookups.map(async (lookup) => {
          const res = await this.rpcManager.withFallback((c) =>
            c.getAddressLookupTable(lookup.accountKey),
          );
          return res.value;
        }),
      );
      const validAlts = lookupTableAccounts.filter(
        (a): a is AddressLookupTableAccount => a !== null,
      );

      const decompiled = TransactionMessage.decompile(rawTx.message, {
        addressLookupTableAccounts: validAlts,
      });

      decompiled.instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: dynamicMicroLamports }),
        this.jito.createTipInstruction(this.wallet.publicKey, activeJitoTipSol),
      );

      const { blockhash, lastValidBlockHeight } = await this.rpcManager.withFallback((c) =>
        c.getLatestBlockhash('confirmed'),
      );
      decompiled.recentBlockhash = blockhash;

      const finalTx = new VersionedTransaction(decompiled.compileToV0Message(validAlts));
      finalTx.sign([this.wallet.keypair]);

      const sim = await this.simulator.simulateVersioned(conn, finalTx);
      if (!sim.ok) {
        return {
          success: false,
          mode: 'LIVE',
          side: params.side,
          mint: targetMint,
          dexRoute: params.dexRouteLabel,
          signature: '',
          solAmount: 0,
          tokenAmountRaw: '0',
          tokenAmountUi: 0,
          executionPriceSol: 0,
          priorityFeeSol: 0,
          jitoTipSol: 0,
          error: `Simulation rejected transaction: ${sim.error}`,
        };
      }

      const bundle = await this.jito.sendBundle([finalTx]);
      let signature = '';

      if (bundle.submitted) {
        const bs58Module = await import('bs58');
        signature = bs58Module.default.encode(finalTx.signatures[0]);
        // Monitor bundle landing status briefly; fall back to direct RPC broadcast if Jito drops
        await new Promise((r) => setTimeout(r, 900));
        const bundleStatus = bundle.bundleId
          ? await this.jito.getBundleStatus(bundle.bundleId)
          : 'Pending';
        if (bundleStatus === 'Failed') {
          signature = await this.rpcManager.withFallback((c) =>
            c.sendRawTransaction(finalTx.serialize(), {
              skipPreflight: true,
              maxRetries: 3,
            }),
          );
        }
      } else {
        signature = await this.rpcManager.withFallback((c) =>
          c.sendRawTransaction(finalTx.serialize(), {
            skipPreflight: true,
            maxRetries: 3,
          }),
        );
      }

      await this.rpcManager.withFallback((c) =>
        c.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed'),
      );

      if (params.side === 'BUY') {
        const verify = await this.verifyLiveBuyBalance({
          mint: targetMint,
          signature,
          preUiAmount: params.preTokenUi ?? 0,
          expectedDecimals: params.decimalsOut,
        });
        if (!verify.verified) {
          return {
            success: false,
            mode: 'LIVE',
            side: 'BUY',
            mint: targetMint,
            dexRoute: params.dexRouteLabel,
            signature,
            solAmount: 0,
            tokenAmountRaw: '0',
            tokenAmountUi: 0,
            executionPriceSol: 0,
            priorityFeeSol: 0,
            jitoTipSol: 0,
            balanceVerified: false,
            error: verify.error ?? 'Post-buy balance verification failed',
          };
        }

        const recon = await this.reconcileLiveTransaction({
          signature,
          mint: targetMint,
          side: 'BUY',
          expectedSolUi: params.solEquivalent,
          tipSol: activeJitoTipSol,
        });
        const solAmount = recon.actualSolUi ?? params.solEquivalent;
        const tokenAmountUi = recon.actualTokenDeltaUi ?? verify.deltaUi;

        return {
          success: true,
          mode: 'LIVE',
          side: 'BUY',
          mint: targetMint,
          dexRoute: params.dexRouteLabel,
          signature,
          solAmount,
          tokenAmountRaw: verify.deltaRaw,
          tokenAmountUi,
          executionPriceSol: tokenAmountUi > 0 ? solAmount / tokenAmountUi : 0,
          expectedPriceSol: params.expectedPriceSol,
          priorityFeeSol: recon.actualFeeSol ?? (dynamicMicroLamports * sim.unitsConsumed) / 1e15,
          jitoTipSol: activeJitoTipSol,
          bundleId: bundle.bundleId,
          balanceVerified: true,
          reconciled: recon.reconciled,
          slippageDiffPct: recon.slippageDiffPct,
        };
      }

      const expectedSolOut = Number(quote.outAmount) / Math.pow(10, params.decimalsOut);
      const recon = await this.reconcileLiveTransaction({
        signature,
        mint: targetMint,
        side: 'SELL',
        expectedSolUi: expectedSolOut,
        tipSol: activeJitoTipSol,
      });
      const solAmount = recon.actualSolUi ?? expectedSolOut;
      const tokenAmountUi = recon.actualTokenDeltaUi ?? (params.tokenUiIn ?? 0);
      const executionPriceSol = tokenAmountUi > 0 ? solAmount / tokenAmountUi : 0;

      return {
        success: true,
        mode: 'LIVE',
        side: 'SELL',
        mint: targetMint,
        dexRoute: params.dexRouteLabel,
        signature,
        solAmount,
        tokenAmountRaw: quote.outAmount,
        tokenAmountUi,
        executionPriceSol,
        expectedPriceSol: params.expectedPriceSol,
        priorityFeeSol: recon.actualFeeSol ?? (dynamicMicroLamports * sim.unitsConsumed) / 1e15,
        jitoTipSol: activeJitoTipSol,
        bundleId: bundle.bundleId,
        reconciled: recon.reconciled,
        slippageDiffPct: recon.slippageDiffPct,
      };
    } catch (err) {
      return {
        success: false,
        mode: 'LIVE',
        side: params.side,
        mint: targetMint,
        dexRoute: params.dexRouteLabel,
        signature: '',
        solAmount: 0,
        tokenAmountRaw: '0',
        tokenAmountUi: 0,
        executionPriceSol: 0,
        priorityFeeSol: 0,
        jitoTipSol: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async getMintDecimals(mintAddress: string): Promise<number> {
    const cached = this.decimalsCache.get(mintAddress);
    if (cached !== undefined) return cached;
    try {
      const info = await this.rpcManager.withFallback((conn) =>
        conn.getParsedAccountInfo(new PublicKey(mintAddress)),
      );
      if (info.value?.data && 'parsed' in info.value.data) {
        const dec = (info.value.data.parsed as { info?: { decimals?: number } }).info?.decimals;
        if (typeof dec === 'number') {
          this.decimalsCache.set(mintAddress, dec);
          return dec;
        }
      }
      return 6;
    } catch {
      return 6;
    }
  }
}
