import { sharedHttpClient } from '../core/httpClient';
import {
  EntryStrategyId,
  MarketRegimeSnapshot,
  MarketRegimeType,
} from '../core/types';

interface ObservedPoolSample {
  liquidityUsd: number;
  priceChange5mPct: number;
  observedAt: number;
}

/**
 * Module 4: Market Regime Detection Engine
 * Tracks SOL spot trend (1h/24h), realized volatility, DEX memecoin breadth & liquidity velocity
 * to classify BULLISH / BEARISH / SIDEWAYS / HIGH_VOLATILITY and select optimal strategy.
 */
export class MarketRegimeDetector {
  private currentSnapshot: MarketRegimeSnapshot = {
    regime: 'SIDEWAYS',
    solPriceUsd: 165,
    solChange1hPct: 0,
    solChange24hPct: 0,
    dexVolume24hUsd: 0,
    breadthAdvancingPct: 50,
    liquidityFlowRatio: 1.0,
    memecoinSentimentScore: 55,
    volatilityScore: 35,
    recommendedStrategy: 'EARLY_MOMENTUM',
    riskMultiplier: 1.0,
    minAiScoreThreshold: 52,
    updatedAt: Date.now(),
    reason: 'Initial neutral regime baseline',
  };

  private recentPoolSamples: ObservedPoolSample[] = [];
  private lastRefreshAt = 0;

  public getCurrentRegime(): MarketRegimeSnapshot {
    return { ...this.currentSnapshot };
  }

  public observeDiscoveredPool(liquidityUsd: number, priceChange5mPct: number): void {
    const now = Date.now();
    this.recentPoolSamples.push({
      liquidityUsd: Math.max(0, liquidityUsd),
      priceChange5mPct,
      observedAt: now,
    });
    const cutoff = now - 30 * 60_000;
    this.recentPoolSamples = this.recentPoolSamples.filter((s) => s.observedAt >= cutoff).slice(-120);
  }

  public async refreshRegime(force = false): Promise<MarketRegimeSnapshot> {
    if (!force && Date.now() - this.lastRefreshAt < 45_000) {
      return this.getCurrentRegime();
    }
    this.lastRefreshAt = Date.now();

    let solPriceUsd = this.currentSnapshot.solPriceUsd;
    let solChange1hPct = this.currentSnapshot.solChange1hPct;
    let solChange24hPct = this.currentSnapshot.solChange24hPct;
    let dexVolume24hUsd = this.currentSnapshot.dexVolume24hUsd;

    try {
      const data = await sharedHttpClient.get<{
        pairs?: Array<{
          chainId?: string;
          priceUsd?: string;
          volume?: { h24?: number };
          priceChange?: { h1?: number; h24?: number };
          liquidity?: { usd?: number };
        }>;
      }>(
        'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
        { axiosConfig: { timeout: 2200 }, maxRetries: 1 },
      );

      const solPairs = (data?.pairs ?? [])
        .filter((p) => p.chainId === 'solana' && (p.liquidity?.usd ?? 0) > 500_000)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

      const topSol = solPairs[0];
      if (topSol) {
        const px = Number(topSol.priceUsd ?? 0);
        if (px > 10) solPriceUsd = Number(px.toFixed(2));
        solChange1hPct = Number((topSol.priceChange?.h1 ?? 0).toFixed(2));
        solChange24hPct = Number((topSol.priceChange?.h24 ?? 0).toFixed(2));
        dexVolume24hUsd = Math.round(
          solPairs.slice(0, 6).reduce((acc, p) => acc + (p.volume?.h24 ?? 0), 0),
        );
      }
    } catch {
      // Retain previous SOL spot telemetry on transient API timeout
    }

    // Compute internal memecoin breadth & liquidity flow from observed pools
    const samples = this.recentPoolSamples;
    const advancingCount = samples.filter((s) => s.priceChange5mPct > 2).length;
    const breadthAdvancingPct =
      samples.length >= 4 ? Number(((advancingCount / samples.length) * 100).toFixed(1)) : 52;

    const avgLiq =
      samples.length > 0
        ? samples.reduce((acc, s) => acc + s.liquidityUsd, 0) / samples.length
        : 12_000;
    const liquidityFlowRatio = Number(Math.max(0.4, Math.min(2.2, avgLiq / 12_000)).toFixed(2));

    const dispersion =
      samples.length >= 3
        ? Math.sqrt(
            samples.reduce((acc, s) => acc + Math.pow(s.priceChange5mPct, 2), 0) / samples.length,
          )
        : Math.abs(solChange1hPct) * 6;
    const volatilityScore = Number(
      Math.max(10, Math.min(100, Math.abs(solChange1hPct) * 12 + Math.abs(solChange24hPct) * 2.2 + dispersion * 0.5)).toFixed(1),
    );

    const memecoinSentimentScore = Number(
      Math.max(
        10,
        Math.min(
          98,
          50 + solChange1hPct * 4.5 + solChange24hPct * 1.4 + (breadthAdvancingPct - 50) * 0.45,
        ),
      ).toFixed(1),
    );

    let regime: MarketRegimeType = 'SIDEWAYS';
    let recommendedStrategy: EntryStrategyId = 'EARLY_MOMENTUM';
    let riskMultiplier = 1.0;
    let minAiScoreThreshold = 52;

    if (volatilityScore >= 68 || Math.abs(solChange1hPct) >= 3.2) {
      regime = 'HIGH_VOLATILITY';
      recommendedStrategy = 'PULLBACK';
      riskMultiplier = 0.72;
      minAiScoreThreshold = 60;
    } else if (solChange24hPct >= 2.2 && solChange1hPct >= -0.4 && breadthAdvancingPct >= 48) {
      regime = 'BULLISH';
      recommendedStrategy = solChange1hPct >= 0.6 ? 'BREAKOUT' : 'EARLY_MOMENTUM';
      riskMultiplier = 1.12;
      minAiScoreThreshold = 48;
    } else if (solChange24hPct <= -3.5 || (solChange1hPct <= -1.8 && breadthAdvancingPct < 42)) {
      regime = 'BEARISH';
      recommendedStrategy = 'SMART_MONEY';
      riskMultiplier = 0.65;
      minAiScoreThreshold = 64;
    } else {
      regime = 'SIDEWAYS';
      recommendedStrategy = breadthAdvancingPct >= 55 ? 'LIQUIDITY_INFLOW' : 'EARLY_MOMENTUM';
      riskMultiplier = 0.95;
      minAiScoreThreshold = 52;
    }

    this.currentSnapshot = {
      regime,
      solPriceUsd,
      solChange1hPct,
      solChange24hPct,
      dexVolume24hUsd,
      breadthAdvancingPct,
      liquidityFlowRatio,
      memecoinSentimentScore,
      volatilityScore,
      recommendedStrategy,
      riskMultiplier,
      minAiScoreThreshold,
      updatedAt: Date.now(),
      reason: `SOL $${solPriceUsd} (1h ${solChange1hPct >= 0 ? '+' : ''}${solChange1hPct}%, 24h ${solChange24hPct >= 0 ? '+' : ''}${solChange24hPct}%) | Breadth=${breadthAdvancingPct}% | Vol=${volatilityScore} -> ${regime} (${recommendedStrategy})`,
    };

    return this.getCurrentRegime();
  }
}
