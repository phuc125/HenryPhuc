import { SniperDatabase } from '../analytics/database';
import { OrderflowResult, SmartMoneyAnalysis, SmartWalletProfile } from '../core/types';

/**
 * Module 3: Smart Money & Wallet Intelligence Engine
 * - Maintains Smart Wallet Database & seeded alpha wallets
 * - Scores wallet profitability, whale entries/exits, insider/sniper wallets,
 *   creator wallet reputation, and coordinated wallet clustering.
 */
export class SmartMoneyEngine {
  private readonly knownSeedSet: Set<string>;

  constructor(
    private readonly db: SniperDatabase,
    seededWallets: string[] = [],
  ) {
    this.knownSeedSet = new Set(seededWallets.filter((w) => w.length >= 32));
    for (const wallet of this.knownSeedSet) {
      const existing = this.db.getSmartWallet(wallet);
      if (!existing) {
        this.db.upsertSmartWallet({
          wallet,
          tier: 'SMART_ALPHA',
          reputationScore: 82,
          winRatePct: 68,
          profitFactor: 2.3,
          isWhale: true,
        });
      }
    }
  }

  public analyzeTokenSmartMoney(params: {
    mint: string;
    creatorAddress?: string;
    flow: OrderflowResult;
    bundleSupplyPct: number;
    sybilScore: number;
    insidersDetected: number;
  }): SmartMoneyAnalysis {
    const participants = params.flow.participantWallets ?? [];
    const uniqueWallets = Array.from(new Set(participants.map((p) => p.wallet)));
    const dbProfiles = this.db.getSmartWalletsBatch(uniqueWallets);
    const profileMap = new Map<string, SmartWalletProfile>(
      dbProfiles.map((p) => [p.wallet, p]),
    );

    // Register & classify newly observed participants dynamically
    let smartBuyersCount = 0;
    let smartSellersCount = 0;
    let whaleEntriesCount = params.flow.whaleBuyCount;
    let whaleExitsCount = params.flow.whaleSellCount;
    let netSmartSolFlow = 0;
    const matchedProfiles: SmartWalletProfile[] = [];

    // Cluster check: wallets buying within same slot with almost identical SOL sizing
    const slotBuyBuckets = new Map<number, Array<{ wallet: string; solAmount: number }>>();
    for (const tx of participants) {
      if (tx.side === 'BUY') {
        const arr = slotBuyBuckets.get(tx.slot) ?? [];
        arr.push({ wallet: tx.wallet, solAmount: tx.solAmount });
        slotBuyBuckets.set(tx.slot, arr);
      }
    }

    let coordinatedClusterDetected = params.flow.coordinatedBuyDetected;
    const clusteredWallets = new Set<string>();
    for (const [, slotTxs] of slotBuyBuckets) {
      if (slotTxs.length >= 3) {
        const sorted = [...slotTxs].sort((a, b) => a.solAmount - b.solAmount);
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1].solAmount;
          if (prev > 0.05 && Math.abs(sorted[i].solAmount - prev) / prev < 0.08) {
            coordinatedClusterDetected = true;
            clusteredWallets.add(sorted[i - 1].wallet);
            clusteredWallets.add(sorted[i].wallet);
          }
        }
      }
    }

    for (const tx of participants) {
      let profile = profileMap.get(tx.wallet);
      const isSeeded = this.knownSeedSet.has(tx.wallet);
      const isClustered = clusteredWallets.has(tx.wallet);
      const isWhaleTx = tx.solAmount >= 2.0;

      if (!profile) {
        const tier: SmartWalletProfile['tier'] = isSeeded
          ? 'SMART_ALPHA'
          : isClustered
            ? 'SYBIL'
            : isWhaleTx
              ? 'WHALE'
              : tx.side === 'BUY' && tx.solAmount >= 0.4
                ? 'SNIPER'
                : 'UNKNOWN';

        const baseRep = isSeeded ? 84 : isClustered ? 22 : isWhaleTx ? 70 : 52;
        this.db.upsertSmartWallet({
          wallet: tx.wallet,
          tier,
          reputationScore: baseRep,
          clusterId: isClustered ? `CLUSTER_${params.mint.slice(0, 6)}` : null,
          isWhale: isWhaleTx,
          isInsider: isClustered && tx.slot > 0,
          lastActiveAt: Date.now(),
        });
        profile = this.db.getSmartWallet(tx.wallet) ?? undefined;
        if (profile) profileMap.set(tx.wallet, profile);
      }

      if (!profile) continue;

      const isSmart =
        profile.tier === 'SMART_ALPHA' ||
        (profile.reputationScore >= 68 && profile.winRatePct >= 55);

      if (isSmart) {
        matchedProfiles.push(profile);
        if (tx.side === 'BUY') {
          smartBuyersCount++;
          netSmartSolFlow += tx.solAmount;
        } else {
          smartSellersCount++;
          netSmartSolFlow -= tx.solAmount;
        }
      } else if (profile.isWhale || isWhaleTx) {
        matchedProfiles.push(profile);
        if (tx.side === 'BUY') {
          netSmartSolFlow += tx.solAmount * 0.6;
        } else {
          netSmartSolFlow -= tx.solAmount * 0.7;
        }
      }
    }

    if (params.flow.smartMoneyAccumulation && smartBuyersCount === 0) {
      smartBuyersCount = Math.max(1, whaleEntriesCount);
      netSmartSolFlow += Math.max(0, params.flow.whaleNetSol);
    }
    if (params.flow.smartMoneyDistribution && smartSellersCount === 0) {
      smartSellersCount = Math.max(1, whaleExitsCount);
      netSmartSolFlow -= Math.abs(params.flow.whaleNetSol);
    }

    // Creator reputation lookup from wallet DB & blacklist history
    let creatorReputationScore = 62;
    if (params.creatorAddress) {
      const bl = this.db.isCreatorBlacklisted(params.creatorAddress);
      if (bl.blacklisted) {
        creatorReputationScore = 0;
      } else {
        const creatorProf = this.db.getSmartWallet(params.creatorAddress);
        if (creatorProf) {
          creatorReputationScore = creatorProf.reputationScore;
        }
      }
    }

    const insiderAlert =
      params.insidersDetected >= 2 ||
      params.bundleSupplyPct >= 24 ||
      clusteredWallets.size >= 3;

    // Composite Smart Money Score (0 - 100)
    let score = 50;
    score += Math.min(22, smartBuyersCount * 8);
    score += Math.min(14, whaleEntriesCount * 5);
    score -= Math.min(25, smartSellersCount * 9);
    score -= Math.min(20, whaleExitsCount * 7);
    score += Math.max(-15, Math.min(15, netSmartSolFlow * 2.5));
    if (coordinatedClusterDetected || params.sybilScore >= 55) score -= 22;
    if (insiderAlert) score -= 18;
    if (creatorReputationScore < 40) score -= 20;
    else if (creatorReputationScore >= 75) score += 8;

    const smartMoneyScore = Number(Math.max(0, Math.min(100, score)).toFixed(1));
    const uniqueTop = Array.from(
      new Map(matchedProfiles.map((p) => [p.wallet, p])).values(),
    )
      .sort((a, b) => b.reputationScore - a.reputationScore)
      .slice(0, 6);

    return {
      smartMoneyScore,
      smartBuyersCount,
      smartSellersCount,
      whaleEntriesCount,
      whaleExitsCount,
      insiderAlert,
      coordinatedClusterDetected,
      creatorReputationScore,
      netSmartSolFlow: Number(netSmartSolFlow.toFixed(3)),
      topMatchedWallets: uniqueTop,
      reason: `SM Score=${smartMoneyScore}/100 | Smart=${smartBuyersCount}B/${smartSellersCount}S | Whales=${whaleEntriesCount}B/${whaleExitsCount}S | NetSM=${netSmartSolFlow.toFixed(2)} SOL${insiderAlert ? ' | ⚠️ INSIDER_ALERT' : ''}`,
    };
  }

  public recordParticipantOutcome(wallets: string[], pnlPct: number, solDelta: number): void {
    const won = pnlPct >= 10;
    for (const wallet of wallets.slice(0, 20)) {
      const cur = this.db.getSmartWallet(wallet);
      const totalTrades = (cur?.totalTrades ?? 0) + 1;
      const wins = (cur?.wins ?? 0) + (won ? 1 : 0);
      const losses = (cur?.losses ?? 0) + (won ? 0 : 1);
      const winRatePct = Number(((wins / totalTrades) * 100).toFixed(2));
      const realizedPnlSol = Number(((cur?.realizedPnlSol ?? 0) + solDelta).toFixed(4));
      const prevAvgRoi = cur?.avgRoiPct ?? 0;
      const avgRoiPct = Number(
        (((prevAvgRoi * (totalTrades - 1)) + pnlPct) / totalTrades).toFixed(2),
      );
      const profitFactor =
        losses === 0 ? (wins > 0 ? 3.0 : 1.0) : Number(Math.max(0.2, (wins / losses) * 1.4).toFixed(2));
      const tier =
        totalTrades >= 4 && winRatePct >= 62 && realizedPnlSol > 0
          ? 'SMART_ALPHA'
          : cur?.tier ?? 'UNKNOWN';
      const reputationScore = Number(
        Math.max(10, Math.min(99, 45 + (winRatePct - 50) * 0.7 + Math.min(20, realizedPnlSol * 2))).toFixed(1),
      );

      this.db.upsertSmartWallet({
        wallet,
        tier,
        totalTrades,
        wins,
        losses,
        winRatePct,
        profitFactor,
        realizedPnlSol,
        avgRoiPct,
        reputationScore,
        lastActiveAt: Date.now(),
      });
    }
  }
}
