import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { sharedHttpClient } from '../core/httpClient';
import { RpcManager } from '../core/rpc';
import { OrderflowResult, OrderflowTimeframeMetrics } from '../core/types';
import { SniperDatabase } from '../analytics/database';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const WHALE_TX_SOL_THRESHOLD = 2.0;

const COMMON_RETAIL_SOL_SIZES = new Set([
  '0.05',
  '0.10',
  '0.15',
  '0.20',
  '0.25',
  '0.30',
  '0.40',
  '0.50',
  '0.75',
  '1.00',
  '1.50',
  '2.00',
  '2.50',
  '3.00',
  '5.00',
]);

export function estimateFreeFeedUniqueBuyers(buyCount: number): number {
  if (buyCount <= 0) return 0;
  return Math.max(1, Math.min(buyCount, Math.ceil(buyCount * 0.68)));
}

export function detectSybilUniformBuys(
  buys: Array<{ wallet: string; solAmount: number; slot: number }>,
  coordinatedBuyDetected: boolean,
): { sybilScore: number; sybilSuspected: boolean; maxUniformWallets: number } {
  // Group distinct wallets by rounded SOL size, excluding common retail round numbers unless slot-clustered
  const oddSizeWallets = new Map<string, Set<string>>();
  const retailSizeEntries = new Map<string, Array<{ wallet: string; slot: number }>>();

  for (const b of buys) {
    const key2 = b.solAmount.toFixed(2);
    const key3 = b.solAmount.toFixed(3);
    if (COMMON_RETAIL_SOL_SIZES.has(key2) && Math.abs(b.solAmount - Number(key2)) < 0.004) {
      const list = retailSizeEntries.get(key2) ?? [];
      list.push({ wallet: b.wallet, slot: b.slot });
      retailSizeEntries.set(key2, list);
    } else {
      const set = oddSizeWallets.get(key3) ?? new Set<string>();
      set.add(b.wallet);
      oddSizeWallets.set(key3, set);
    }
  }

  let maxOddUniform = 0;
  for (const wSet of oddSizeWallets.values()) {
    if (wSet.size > maxOddUniform) maxOddUniform = wSet.size;
  }

  // For common round sizes, only flag if >=3 distinct wallets execute within <=2 slots
  let maxClusteredRetail = 0;
  for (const list of retailSizeEntries.values()) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.slot - b.slot);
    for (let i = 0; i < sorted.length; i++) {
      const clusterWallets = new Set<string>([sorted[i].wallet]);
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].slot - sorted[i].slot <= 2) {
          clusterWallets.add(sorted[j].wallet);
        } else {
          break;
        }
      }
      if (clusterWallets.size > maxClusteredRetail) {
        maxClusteredRetail = clusterWallets.size;
      }
    }
  }

  const maxUniformWallets = Math.max(maxOddUniform, maxClusteredRetail);
  const sybilScore = Math.min(
    100,
    (maxUniformWallets >= 3 ? maxUniformWallets * 18 : 0) + (coordinatedBuyDetected ? 25 : 0),
  );
  return {
    sybilScore,
    sybilSuspected: sybilScore >= 65 && maxUniformWallets >= 3,
    maxUniformWallets,
  };
}

export interface OrderflowThresholds {
  minBuyCount: number;
  minUniqueBuyers: number;
  minBuyToSellRatio?: number;
  minNetSolInflow?: number;
  minVolumeSpikeRatio?: number;
  washTradeGuardEnabled?: boolean;
  momentumFilterEnabled?: boolean;
  prefetchedM5Buys?: number;
  prefetchedM5Sells?: number;
  prefetchedM5VolumeUsd?: number;
  prefetchedH1VolumeUsd?: number;
  prefetchedM5PriceChangePct?: number;
  prefetchedLiquidityUsd?: number;
  prefetchedFdvUsd?: number;
  prefetchedAgeMinutes?: number;
  prefetchedAtMs?: number;
  skipDexScreenerRefetch?: boolean;
  solPriceUsd?: number;
  poolAddress?: string;
}

export class OrderflowAnalyzer {
  constructor(
    private readonly rpcManager: RpcManager,
    private readonly blacklistChecker?: (
      creatorAddress?: string | null,
    ) => { blacklisted: boolean; reason?: string },
    private readonly db?: SniperDatabase,
  ) {}

  public async analyzeEarlyMomentum(
    mintAddress: string,
    creatorAddress?: string,
    thresholds: OrderflowThresholds = {
      minBuyCount: 5,
      minUniqueBuyers: 4,
      minBuyToSellRatio: 1.05,
      minNetSolInflow: 0.1,
      minVolumeSpikeRatio: 0.5,
      washTradeGuardEnabled: true,
      momentumFilterEnabled: true,
    },
  ): Promise<OrderflowResult> {
    if (creatorAddress && this.blacklistChecker) {
      const bl = this.blacklistChecker(creatorAddress);
      if (bl.blacklisted) {
        return {
          passed: false,
          dataSource: 'ONCHAIN_FULL_BALANCE',
          reliabilityScore: 1,
          buyCount: 0,
          sellCount: 0,
          buyToSellRatio: 0,
          devSold: false,
          uniqueBuyers: 0,
          uniqueSellers: 0,
          netSolInflow: 0,
          buySolVolume: 0,
          sellSolVolume: 0,
          cvdSol: 0,
          orderflowImbalance: 0,
          whaleBuyCount: 0,
          whaleSellCount: 0,
          whaleNetSol: 0,
          smartMoneyAccumulation: false,
          smartMoneyDistribution: false,
          sybilSuspected: false,
          sybilScore: 0,
          coordinatedBuyDetected: false,
          avgBuySol: 0,
          washTradeSuspected: false,
          reason: `Rejected: Creator ${creatorAddress.slice(0, 6)}... BLACKLISTED (${bl.reason ?? 'Repeat rugger'})`,
        };
      }
    }

    const minBuyToSellRatio = thresholds.minBuyToSellRatio ?? 1.05;
    const minNetSolInflow = thresholds.minNetSolInflow ?? 0.1;
    const minVolumeSpikeRatio = thresholds.minVolumeSpikeRatio ?? 0.5;

    // Prioritize full on-chain balance-change inspection when Paid RPC is configured; otherwise blend Free-Feed + light RPC
    if (!this.rpcManager.isPaidPlan()) {
      const freeFlow = await this.analyzeViaFreeDexTelemetry(
        mintAddress,
        thresholds,
        minBuyToSellRatio,
        minVolumeSpikeRatio,
      );
      if (freeFlow) {
        this.db?.saveOrderflowSnapshot(mintAddress, freeFlow);
        return freeFlow;
      }
    }

    try {
      const mint = new PublicKey(mintAddress);
      const sigs = await this.rpcManager.withFallback((conn) =>
        conn.getSignaturesForAddress(mint, { limit: 30 }, 'confirmed'),
      );

      const validSigs = sigs.filter((s) => !s.err);
      if (validSigs.length < thresholds.minBuyCount) {
        return {
          passed: false,
          dataSource: 'ONCHAIN_FULL_BALANCE',
          reliabilityScore: 0.9,
          buyCount: validSigs.length,
          sellCount: 0,
          buyToSellRatio: validSigs.length,
          devSold: false,
          uniqueBuyers: 0,
          uniqueSellers: 0,
          netSolInflow: 0,
          buySolVolume: 0,
          sellSolVolume: 0,
          cvdSol: 0,
          orderflowImbalance: 0,
          whaleBuyCount: 0,
          whaleSellCount: 0,
          whaleNetSol: 0,
          smartMoneyAccumulation: false,
          smartMoneyDistribution: false,
          sybilSuspected: false,
          sybilScore: 0,
          coordinatedBuyDetected: false,
          avgBuySol: 0,
          reason: `Rejected: Too few confirmed swaps (${validSigs.length} < min ${thresholds.minBuyCount})`,
        };
      }

      const maxTxFetch = this.rpcManager.isPaidPlan() ? 28 : 12;
      const chronologicalSigs = validSigs
        .slice(0, maxTxFetch)
        .reverse()
        .map((s) => s.signature);

      const parsedTxs = await this.rpcManager.withFallback((conn) =>
        conn.getParsedTransactions(chronologicalSigs, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }),
      );

      let buyCount = 0;
      let sellCount = 0;
      let devSold = false;
      let buySolVolume = 0;
      let sellSolVolume = 0;
      let cvdSol = 0;
      let whaleBuyCount = 0;
      let whaleSellCount = 0;
      let whaleNetSol = 0;

      const buyerVolume = new Map<string, number>();
      const sellerVolume = new Map<string, number>();
      const buyRecordsForSybil: Array<{ wallet: string; solAmount: number; slot: number }> = [];
      const buysBySlot = new Map<number, Set<string>>();
      const participantWallets: NonNullable<OrderflowResult['participantWallets']> = [];

      const nowSec = Math.floor(Date.now() / 1000);
      const tf1m = { buys: 0, sells: 0, buySol: 0, sellSol: 0 };
      const tf5m = { buys: 0, sells: 0, buySol: 0, sellSol: 0 };
      const tf15m = { buys: 0, sells: 0, buySol: 0, sellSol: 0 };

      for (const tx of parsedTxs) {
        if (!tx?.meta || tx.meta.err) continue;

        // Resolve FULL account list (including v0 Address Lookup Tables) instead of trusting only accountKeys[0]
        const msgKeys = tx.meta.loadedAddresses
          ? tx.transaction.message.getAccountKeys({
              accountKeysFromLookups: tx.meta.loadedAddresses,
            })
          : tx.transaction.message.getAccountKeys();

        const nativeDeltaByAccount = new Map<string, number>();
        for (let i = 0; i < msgKeys.length; i++) {
          const pubkey = msgKeys.get(i)?.toBase58();
          if (!pubkey) continue;
          const preL = tx.meta.preBalances[i] ?? 0;
          const postL = tx.meta.postBalances[i] ?? 0;
          const deltaSol = (postL - preL) / LAMPORTS_PER_SOL;
          if (Math.abs(deltaSol) > 0.0001) {
            nativeDeltaByAccount.set(pubkey, deltaSol);
          }
        }

        // Compute target token & WSOL deltas grouped by owner (catches router/aggregators/fee wallets cleanly)
        const tokenDeltaByOwner = new Map<string, number>();
        const wsolDeltaByOwner = new Map<string, number>();

        for (const pre of tx.meta.preTokenBalances ?? []) {
          if (!pre.owner) continue;
          const amt = Number(pre.uiTokenAmount.uiAmount ?? 0);
          if (pre.mint === mintAddress) {
            tokenDeltaByOwner.set(pre.owner, (tokenDeltaByOwner.get(pre.owner) ?? 0) - amt);
          } else if (pre.mint === WSOL_MINT) {
            wsolDeltaByOwner.set(pre.owner, (wsolDeltaByOwner.get(pre.owner) ?? 0) - amt);
          }
        }

        for (const post of tx.meta.postTokenBalances ?? []) {
          if (!post.owner) continue;
          const amt = Number(post.uiTokenAmount.uiAmount ?? 0);
          if (post.mint === mintAddress) {
            tokenDeltaByOwner.set(post.owner, (tokenDeltaByOwner.get(post.owner) ?? 0) + amt);
          } else if (post.mint === WSOL_MINT) {
            wsolDeltaByOwner.set(post.owner, (wsolDeltaByOwner.get(post.owner) ?? 0) + amt);
          }
        }

        const blockAgeSec = tx.blockTime ? Math.max(0, nowSec - tx.blockTime) : 60;
        const feeSol = (tx.meta.fee ?? 0) / LAMPORTS_PER_SOL;

        // Inspect all non-pool owners that gained or lost target mint tokens
        for (const [owner, tokenDelta] of tokenDeltaByOwner.entries()) {
          if (owner === thresholds.poolAddress) continue;
          if (Math.abs(tokenDelta) <= 0) continue;

          const nativeDelta = nativeDeltaByAccount.get(owner) ?? 0;
          const wsolDelta = wsolDeltaByOwner.get(owner) ?? 0;
          const netSolDelta = nativeDelta + wsolDelta;

          if (tokenDelta > 0) {
            // Exclude fee lamports so dust swaps are filtered accurately
            const solSpent = Math.max(0, -(netSolDelta + (owner === msgKeys.get(0)?.toBase58() ? feeSol : 0)));
            if (solSpent < 0.005) continue;

            buyCount++;
            buySolVolume += solSpent;
            cvdSol += solSpent;
            buyRecordsForSybil.push({ wallet: owner, solAmount: solSpent, slot: tx.slot });
            buyerVolume.set(owner, (buyerVolume.get(owner) ?? 0) + solSpent);
            const slotSet = buysBySlot.get(tx.slot) ?? new Set<string>();
            slotSet.add(owner);
            buysBySlot.set(tx.slot, slotSet);
            participantWallets.push({
              wallet: owner,
              side: 'BUY',
              solAmount: Number(solSpent.toFixed(4)),
              tokenAmount: tokenDelta,
              slot: tx.slot,
            });

            if (solSpent >= WHALE_TX_SOL_THRESHOLD) {
              whaleBuyCount++;
              whaleNetSol += solSpent;
            }
            if (blockAgeSec <= 60) {
              tf1m.buys++;
              tf1m.buySol += solSpent;
            }
            if (blockAgeSec <= 300) {
              tf5m.buys++;
              tf5m.buySol += solSpent;
            }
            if (blockAgeSec <= 900) {
              tf15m.buys++;
              tf15m.buySol += solSpent;
            }
          } else if (tokenDelta < 0) {
            if (creatorAddress && owner === creatorAddress) {
              devSold = true;
            }
            const solReceived = Math.max(0, netSolDelta);
            if (solReceived < 0.004) continue;

            sellCount++;
            sellSolVolume += solReceived;
            cvdSol -= solReceived;
            sellerVolume.set(owner, (sellerVolume.get(owner) ?? 0) + solReceived);
            participantWallets.push({
              wallet: owner,
              side: 'SELL',
              solAmount: Number(solReceived.toFixed(4)),
              tokenAmount: Math.abs(tokenDelta),
              slot: tx.slot,
            });

            if (solReceived >= WHALE_TX_SOL_THRESHOLD) {
              whaleSellCount++;
              whaleNetSol -= solReceived;
            }
            if (blockAgeSec <= 60) {
              tf1m.sells++;
              tf1m.sellSol += solReceived;
            }
            if (blockAgeSec <= 300) {
              tf5m.sells++;
              tf5m.sellSol += solReceived;
            }
            if (blockAgeSec <= 900) {
              tf15m.sells++;
              tf15m.sellSol += solReceived;
            }
          }
        }
      }

      const history = this.db?.getOrderflowHistory(mintAddress, 1) ?? [];
      const priorCvd = history[0]?.cvdSol ?? 0;
      const netSolInflow = Number((buySolVolume - sellSolVolume).toFixed(3));
      const cumulativeCvdSol = Number((priorCvd + cvdSol).toFixed(3));
      const totalSolVol = buySolVolume + sellSolVolume;
      const orderflowImbalance =
        totalSolVol > 0 ? Number(((buySolVolume - sellSolVolume) / totalSolVol).toFixed(3)) : 0;

      const buyToSellRatio =
        sellCount === 0 ? buyCount : Number((buyCount / sellCount).toFixed(2));
      const avgBuySol = buyCount > 0 ? Number((buySolVolume / buyCount).toFixed(3)) : 0;

      const maxBuyerSol =
        buyerVolume.size > 0 ? Math.max(...Array.from(buyerVolume.values())) : 0;
      const largestBuyerSharePct =
        buySolVolume > 0 ? Number(((maxBuyerSol / buySolVolume) * 100).toFixed(1)) : 0;

      // Coordinated buy detection (>=3 separate wallets buying in same slot)
      const maxBuysSameSlot = Math.max(
        0,
        ...Array.from(buysBySlot.values()).map((set) => set.size),
      );
      const coordinatedBuyDetected = maxBuysSameSlot >= 3;

      // Sybil wallet clustering: exclude common retail round sizes unless clustered in <=2 slots
      const { sybilScore, sybilSuspected } = detectSybilUniformBuys(
        buyRecordsForSybil,
        coordinatedBuyDetected,
      );

      const smartMoneyAccumulation =
        whaleBuyCount >= 1 && whaleNetSol > 1.5 && orderflowImbalance > 0.2;
      const smartMoneyDistribution =
        whaleSellCount > whaleBuyCount && whaleNetSol < -1.5 && orderflowImbalance < -0.15;

      const washTradeGuardOn = thresholds.washTradeGuardEnabled !== false;
      const momentumFilterOn = thresholds.momentumFilterEnabled !== false;
      const washTradeSuspected =
        washTradeGuardOn &&
        ((buyCount >= 6 && buyerVolume.size <= 2) ||
          (buyCount >= 5 && largestBuyerSharePct > 55) ||
          sybilSuspected);

      const timeframes: OrderflowTimeframeMetrics[] = [
        this.toTimeframeMetric('1m', tf1m),
        this.toTimeframeMetric('5m', tf5m),
        this.toTimeframeMetric('15m', tf15m),
      ];

      if (devSold) {
        const res: OrderflowResult = {
          passed: false,
          dataSource: 'ONCHAIN_FULL_BALANCE',
          reliabilityScore: 0.96,
          buyCount,
          sellCount,
          buyToSellRatio,
          devSold: true,
          uniqueBuyers: buyerVolume.size,
          uniqueSellers: sellerVolume.size,
          netSolInflow,
          buySolVolume: Number(buySolVolume.toFixed(3)),
          sellSolVolume: Number(sellSolVolume.toFixed(3)),
          cvdSol: cumulativeCvdSol,
          orderflowImbalance,
          whaleBuyCount,
          whaleSellCount,
          whaleNetSol: Number(whaleNetSol.toFixed(3)),
          smartMoneyAccumulation,
          smartMoneyDistribution,
          sybilSuspected,
          sybilScore,
          coordinatedBuyDetected,
          avgBuySol,
          largestBuyerSharePct,
          washTradeSuspected,
          participantWallets: participantWallets.slice(0, 30),
          timeframes,
          reason: 'Rejected: Creator/Dev wallet already sold tokens in initial blocks',
        };
        this.db?.saveOrderflowSnapshot(mintAddress, res);
        return res;
      }

      const enoughBuys = buyCount >= thresholds.minBuyCount;
      const enoughUniqueBuyers = buyerVolume.size >= thresholds.minUniqueBuyers;
      const ratioPassed =
        sellCount === 0 ? buyCount >= thresholds.minBuyCount : buyToSellRatio >= minBuyToSellRatio;
      const inflowPassed = !momentumFilterOn || netSolInflow >= minNetSolInflow;
      const imbalanceOk = !momentumFilterOn || orderflowImbalance >= -0.05;
      const passed =
        enoughBuys &&
        enoughUniqueBuyers &&
        ratioPassed &&
        inflowPassed &&
        imbalanceOk &&
        !washTradeSuspected &&
        !smartMoneyDistribution;

      const reasons: string[] = [];
      if (!enoughBuys) reasons.push(`Buys ${buyCount} < ${thresholds.minBuyCount}`);
      if (!enoughUniqueBuyers)
        reasons.push(`Unique buyers ${buyerVolume.size} < ${thresholds.minUniqueBuyers}`);
      if (!ratioPassed) reasons.push(`Buy/Sell ${buyToSellRatio}x < ${minBuyToSellRatio}x`);
      if (!inflowPassed) reasons.push(`Net inflow ${netSolInflow} SOL < ${minNetSolInflow} SOL`);
      if (!imbalanceOk) reasons.push(`Negative imbalance ${orderflowImbalance}`);
      if (smartMoneyDistribution) reasons.push(`Whale distribution detected (${whaleNetSol.toFixed(2)} SOL)`);
      if (washTradeSuspected)
        reasons.push(`Wash/Sybil risk (top=${largestBuyerSharePct}%, sybil=${sybilScore})`);

      const result: OrderflowResult = {
        passed,
        dataSource: 'ONCHAIN_FULL_BALANCE',
        reliabilityScore: 0.95,
        buyCount,
        sellCount,
        buyToSellRatio,
        devSold: false,
        uniqueBuyers: buyerVolume.size,
        uniqueSellers: sellerVolume.size,
        netSolInflow,
        buySolVolume: Number(buySolVolume.toFixed(3)),
        sellSolVolume: Number(sellSolVolume.toFixed(3)),
        cvdSol: cumulativeCvdSol,
        orderflowImbalance,
        whaleBuyCount,
        whaleSellCount,
        whaleNetSol: Number(whaleNetSol.toFixed(3)),
        smartMoneyAccumulation,
        smartMoneyDistribution,
        sybilSuspected,
        sybilScore,
        coordinatedBuyDetected,
        avgBuySol,
        largestBuyerSharePct,
        washTradeSuspected,
        participantWallets: participantWallets.slice(0, 30),
        timeframes,
        reason: passed
          ? `On-Chain Flow: ${buyCount}B/${sellCount}S, CVD=${cumulativeCvdSol >= 0 ? '+' : ''}${cumulativeCvdSol} SOL, Imb=${orderflowImbalance}, Whales=${whaleBuyCount}B/${whaleSellCount}S`
          : `Weak orderflow: ${reasons.join(' | ')}`,
      };

      this.db?.saveOrderflowSnapshot(mintAddress, result);
      return result;
    } catch (err) {
      return {
        passed: false,
        dataSource: 'UNVERIFIED',
        reliabilityScore: 0,
        buyCount: 0,
        sellCount: 0,
        buyToSellRatio: 0,
        devSold: false,
        uniqueBuyers: 0,
        uniqueSellers: 0,
        netSolInflow: 0,
        buySolVolume: 0,
        sellSolVolume: 0,
        cvdSol: 0,
        orderflowImbalance: 0,
        whaleBuyCount: 0,
        whaleSellCount: 0,
        whaleNetSol: 0,
        smartMoneyAccumulation: false,
        smartMoneyDistribution: false,
        sybilSuspected: false,
        sybilScore: 0,
        coordinatedBuyDetected: false,
        avgBuySol: 0,
        reason: `Orderflow analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private toTimeframeMetric(
    windowLabel: '1m' | '5m' | '15m',
    tf: { buys: number; sells: number; buySol: number; sellSol: number },
  ): OrderflowTimeframeMetrics {
    const total = tf.buySol + tf.sellSol;
    return {
      windowLabel,
      buys: tf.buys,
      sells: tf.sells,
      buySolVolume: Number(tf.buySol.toFixed(3)),
      sellSolVolume: Number(tf.sellSol.toFixed(3)),
      volumeDeltaSol: Number((tf.buySol - tf.sellSol).toFixed(3)),
      imbalanceRatio: total > 0 ? Number(((tf.buySol - tf.sellSol) / total).toFixed(3)) : 0,
    };
  }

  private async analyzeViaFreeDexTelemetry(
    mintAddress: string,
    thresholds: OrderflowThresholds,
    minBuyToSellRatio: number,
    minVolumeSpikeRatio: number,
  ): Promise<OrderflowResult | null> {
    let buyCount = thresholds.prefetchedM5Buys ?? 0;
    let sellCount = thresholds.prefetchedM5Sells ?? 0;
    let m5VolUsd = thresholds.prefetchedM5VolumeUsd ?? 0;
    let h1VolUsd = thresholds.prefetchedH1VolumeUsd ?? 0;
    let priceChangeM5 = thresholds.prefetchedM5PriceChangePct ?? 0;
    let liquidityUsd = thresholds.prefetchedLiquidityUsd ?? 0;
    let fdvUsd = thresholds.prefetchedFdvUsd ?? 0;
    let ageMinutes = thresholds.prefetchedAgeMinutes;

    const hasFreshPrefetch =
      thresholds.prefetchedM5Buys !== undefined &&
      thresholds.prefetchedM5VolumeUsd !== undefined &&
      (Boolean(thresholds.skipDexScreenerRefetch) ||
        (thresholds.prefetchedAtMs !== undefined && Date.now() - thresholds.prefetchedAtMs < 6_000));

    if (!hasFreshPrefetch) {
      try {
        const data = await sharedHttpClient.get<{
          pairs?: Array<{
            pairCreatedAt?: number;
            liquidity?: { usd?: number };
            fdv?: number;
            txns?: { m5?: { buys?: number; sells?: number } };
            volume?: { m5?: number; h1?: number };
            priceChange?: { m5?: number };
          }>;
        }>(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`, {
          axiosConfig: { timeout: 1500 },
          maxRetries: 1,
        });

        const top = (data?.pairs ?? []).sort(
          (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
        )[0];

        if (top) {
          buyCount = Number(top.txns?.m5?.buys ?? buyCount);
          sellCount = Number(top.txns?.m5?.sells ?? sellCount);
          m5VolUsd = Number(top.volume?.m5 ?? m5VolUsd);
          h1VolUsd = Number(top.volume?.h1 ?? h1VolUsd);
          priceChangeM5 = Number(top.priceChange?.m5 ?? priceChangeM5);
          liquidityUsd = Number(top.liquidity?.usd ?? liquidityUsd);
          fdvUsd = Number(top.fdv ?? fdvUsd);
          if (top.pairCreatedAt) {
            ageMinutes = Math.max(
              0.5,
              Number(((Date.now() - top.pairCreatedAt) / 60_000).toFixed(1)),
            );
          }
        }
      } catch {
        // Fall back to prefetched GeckoTerminal values if available
      }
    }

    if (buyCount === 0 && sellCount === 0 && m5VolUsd === 0) {
      return null;
    }

    const totalTxns = Math.max(1, buyCount + sellCount);
    const buyShare = buyCount / totalTxns;
    const sellShare = sellCount / totalTxns;
    const solUsdEst =
      thresholds.solPriceUsd && thresholds.solPriceUsd > 10 ? thresholds.solPriceUsd : 165;
    const estBuySolVol = Number(((m5VolUsd * buyShare) / solUsdEst).toFixed(3));
    const estSellSolVol = Number(((m5VolUsd * sellShare) / solUsdEst).toFixed(3));
    const netSolInflow = Number((estBuySolVol - estSellSolVol).toFixed(3));
    const orderflowImbalance =
      estBuySolVol + estSellSolVol > 0
        ? Number(((estBuySolVol - estSellSolVol) / (estBuySolVol + estSellSolVol)).toFixed(3))
        : 0;
    const priorCvd = this.db?.getOrderflowHistory(mintAddress, 1)[0]?.cvdSol ?? 0;
    const cvdSol = Number((priorCvd + netSolInflow).toFixed(3));

    const buyToSellRatio =
      sellCount === 0 ? buyCount : Number((buyCount / sellCount).toFixed(2));
    // Calibrated Free-Feed unique buyer estimate (eliminates 5-6 buy cliff while staying conservative on high counts)
    const estUniqueBuyers = estimateFreeFeedUniqueBuyers(buyCount);
    const avgUsdPerTxn = m5VolUsd / totalTxns;
    const volumeSpikeRatio =
      h1VolUsd > 0 ? Number(((m5VolUsd * 12) / h1VolUsd).toFixed(2)) : m5VolUsd >= 350 ? 1.5 : 0;

    const washTradeGuardOn = thresholds.washTradeGuardEnabled !== false;
    const momentumFilterOn = thresholds.momentumFilterEnabled !== false;

    const washTradeSuspected = washTradeGuardOn && buyCount >= 50 && avgUsdPerTxn < 5;
    const turnoverRatio =
      liquidityUsd > 0 ? Number((m5VolUsd / liquidityUsd).toFixed(3)) : 0.2;
    const minTurnoverThreshold = liquidityUsd >= 25_000 ? 0.015 : 0.03;
    const fdvToLiqRatio =
      fdvUsd > 0 && liquidityUsd > 0 ? Number((fdvUsd / liquidityUsd).toFixed(1)) : 5;

    const ratioPassed =
      sellCount === 0 ? buyCount >= thresholds.minBuyCount : buyToSellRatio >= minBuyToSellRatio;
    const enoughBuys = buyCount >= thresholds.minBuyCount;
    const enoughBuyers = estUniqueBuyers >= thresholds.minUniqueBuyers;
    const enoughVol = !momentumFilterOn || m5VolUsd >= 350;
    const spikeOk =
      !momentumFilterOn ||
      ageMinutes === undefined ||
      ageMinutes < 50 ||
      volumeSpikeRatio >= minVolumeSpikeRatio;
    const momentumOk = !momentumFilterOn || (priceChangeM5 > -20 && priceChangeM5 <= 250);
    const turnoverOk =
      !momentumFilterOn || liquidityUsd <= 0 || turnoverRatio >= minTurnoverThreshold;
    const fdvOk = !momentumFilterOn || fdvToLiqRatio <= 40;

    const passed =
      enoughBuys &&
      enoughBuyers &&
      ratioPassed &&
      enoughVol &&
      spikeOk &&
      momentumOk &&
      turnoverOk &&
      fdvOk &&
      !washTradeSuspected;

    const reasons: string[] = [];
    if (!enoughBuys) reasons.push(`5m Buys ${buyCount} < ${thresholds.minBuyCount}`);
    if (!enoughBuyers) reasons.push(`Est buyers ${estUniqueBuyers} < ${thresholds.minUniqueBuyers}`);
    if (!ratioPassed) reasons.push(`Buy/Sell ${buyToSellRatio}x < ${minBuyToSellRatio}x`);
    if (!enoughVol) reasons.push(`5m Vol $${Math.round(m5VolUsd)} < $350`);
    if (!spikeOk) reasons.push(`VolSpike ${volumeSpikeRatio}x < ${minVolumeSpikeRatio}x`);
    if (!turnoverOk)
      reasons.push(
        `Turnover ${(turnoverRatio * 100).toFixed(1)}% < ${(minTurnoverThreshold * 100).toFixed(1)}%`,
      );
    if (!fdvOk) reasons.push(`FDV/Liq ${fdvToLiqRatio}x > 40x`);
    if (washTradeSuspected) reasons.push(`Wash-bot spam ($${avgUsdPerTxn.toFixed(1)}/tx)`);
    if (momentumFilterOn && priceChangeM5 <= -20)
      reasons.push(`Falling knife 5m=${priceChangeM5}%`);
    if (momentumFilterOn && priceChangeM5 > 250)
      reasons.push(`Overextended top 5m=+${priceChangeM5}% (>250%)`);

    return {
      passed,
      dataSource: 'FREE_FEED_AGGREGATED',
      reliabilityScore: 0.62,
      buyCount,
      sellCount,
      buyToSellRatio,
      devSold: false,
      uniqueBuyers: estUniqueBuyers,
      uniqueSellers: Math.max(0, Math.round(sellCount * 0.65)),
      netSolInflow,
      buySolVolume: estBuySolVol,
      sellSolVolume: estSellSolVol,
      cvdSol,
      orderflowImbalance,
      whaleBuyCount: avgUsdPerTxn >= 350 && buyShare > 0.6 ? 1 : 0,
      whaleSellCount: avgUsdPerTxn >= 350 && sellShare > 0.55 ? 1 : 0,
      whaleNetSol: avgUsdPerTxn >= 350 ? netSolInflow * 0.4 : 0,
      smartMoneyAccumulation: orderflowImbalance >= 0.25 && m5VolUsd >= 3500,
      smartMoneyDistribution: orderflowImbalance <= -0.25,
      sybilSuspected: washTradeSuspected,
      sybilScore: washTradeSuspected ? 75 : 15,
      coordinatedBuyDetected: buyCount >= 35 && sellCount <= 2 && priceChangeM5 >= 45,
      avgBuySol: buyCount > 0 ? Number((estBuySolVol / buyCount).toFixed(3)) : 0,
      m5VolumeUsd: m5VolUsd,
      h1VolumeUsd: h1VolUsd,
      volumeSpikeRatio,
      priceChangeM5Pct: priceChangeM5,
      turnoverRatio,
      washTradeSuspected,
      timeframes: [
        {
          windowLabel: '5m',
          buys: buyCount,
          sells: sellCount,
          buySolVolume: estBuySolVol,
          sellSolVolume: estSellSolVol,
          volumeDeltaSol: netSolInflow,
          imbalanceRatio: orderflowImbalance,
        },
      ],
      reason: passed
        ? `FreeFeed Flow (rel=0.62): ${buyCount}B/${sellCount}S, Imb=${orderflowImbalance}, CVD=${cvdSol >= 0 ? '+' : ''}${cvdSol} SOL`
        : `Weak orderflow: ${reasons.join(' | ')}`,
    };
  }
}
