import { EventEmitter } from 'events';
import { RuntimeConfig, RuntimeConfigManager } from '../config/runtimeConfig';
import { SniperDatabase } from '../analytics/database';
import { TreasuryManager } from '../core/treasury';
import { EntryStrategyId, PositionRecord } from '../core/types';
import { SmartExecutionRouter } from '../execution/router';
import { OrderflowAnalyzer } from '../filters/orderflow';
import { AntiRugEngine } from '../security/antiRug';

export interface StrategyActionEvent {
  positionId: number;
  mint: string;
  symbol: string;
  mode: 'PAPER' | 'LIVE';
  action:
    | 'TP1'
    | 'TP2'
    | 'TRAILING_SL'
    | 'BREAKEVEN_SL'
    | 'HARD_SL'
    | 'TIME_EXIT'
    | 'RUG_DRAIN'
    | 'ORDERFLOW_REVERSAL'
    | 'WHALE_DISTRIBUTION'
    | 'VOLATILITY_EXIT'
    | 'PANIC_SELL';
  solReceived: number;
  pnlPct: number;
  signature: string;
  reconciled?: boolean;
  slippageDiffPct?: number;
  buyChatId?: number | null;
  buyMessageId?: number | null;
}

interface StrategyExitProfile {
  tp1Mult: number;
  hardSlMult: number;
  trailCallbackMult: number;
  timeExitMult: number;
}

const STRATEGY_EXIT_PROFILES: Record<EntryStrategyId, StrategyExitProfile> = {
  EARLY_MOMENTUM: { tp1Mult: 1.0, hardSlMult: 1.0, trailCallbackMult: 1.0, timeExitMult: 1.0 },
  BREAKOUT: { tp1Mult: 1.25, hardSlMult: 1.05, trailCallbackMult: 1.15, timeExitMult: 1.2 },
  PULLBACK: { tp1Mult: 0.9, hardSlMult: 0.85, trailCallbackMult: 0.9, timeExitMult: 0.95 },
  LIQUIDITY_INFLOW: { tp1Mult: 1.05, hardSlMult: 0.95, trailCallbackMult: 1.0, timeExitMult: 1.25 },
  SMART_MONEY: { tp1Mult: 1.35, hardSlMult: 1.05, trailCallbackMult: 1.2, timeExitMult: 1.4 },
};

/**
 * Module 7: Intelligent Exit Engine
 * - Verifies actual exit route liquidity via router.verifyExitRouteQuote() before triggering Emergency/RUG_DRAIN
 *   so transient RPC/DexScreener blips never panic-dump healthy coins
 * - Dynamic TP/SL tuned per entry strategy + market volatility
 * - Adaptive Trailing SL, Orderflow Reversal Exit, Whale Distribution Exit, Security Re-Assessment & State Sync
 */
export class PositionManager extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private readonly activeLocks = new Set<number>();
  private readonly nullPriceTicks = new Map<number, number>();
  private readonly tickCounter = new Map<number, number>();
  private readonly rollingPnlHistory = new Map<number, number[]>();

  constructor(
    private readonly db: SniperDatabase,
    private readonly router: SmartExecutionRouter,
    private readonly configManager: RuntimeConfigManager,
    private readonly orderflow?: OrderflowAnalyzer,
    private readonly antiRug?: AntiRugEngine,
    private readonly treasury?: TreasuryManager,
  ) {
    super();
  }

  public start(intervalMs = 5000): void {
    if (this.pollTimer) return;
    const safeIntervalMs = Math.max(5_000, intervalMs);
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, safeIntervalMs);
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async evaluateAllOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const cfg = this.configManager.get();
      const openPositions = this.db.getOpenPositions();
      await Promise.allSettled(openPositions.map((pos) => this.evaluatePosition(pos, cfg)));
    } finally {
      this.isTicking = false;
    }
  }

  private async evaluatePosition(pos: PositionRecord, cfg: RuntimeConfig): Promise<void> {
    if (this.activeLocks.has(pos.id)) return;
    this.activeLocks.add(pos.id);

    try {
      const profile =
        STRATEGY_EXIT_PROFILES[pos.entryStrategy ?? 'EARLY_MOMENTUM'] ??
        STRATEGY_EXIT_PROFILES.EARLY_MOMENTUM;

      const livePrice = await this.router.fetchLiveTokenPriceInSol(pos.mint);
      if (!livePrice || livePrice <= 0) {
        const misses = (this.nullPriceTicks.get(pos.id) ?? 0) + 1;
        this.nullPriceTicks.set(pos.id, misses);

        // Fix #4: Check real exit-route capability before assuming RUG_DRAIN
        if (misses >= Math.max(5, cfg.rugDrainMissTicks)) {
          const [exitRoute, confirmSnap] = await Promise.all([
            this.router.verifyExitRouteQuote(pos.mint, pos.remainingTokenAmount),
            this.router.fetchMarketSnapshot(
              pos.mint,
              Math.min(0.1, Math.max(0.01, pos.initialSolSpent || 0.05)),
            ),
          ]);
          if (exitRoute.routable && exitRoute.priceSol) {
            // Transient oracle miss, token is still routable — use Jupiter exit quote price and reset misses
            this.nullPriceTicks.set(pos.id, 0);
            this.db.updatePositionState(pos.id, { currentPriceSol: exitRoute.priceSol });
            return;
          }
          if (!confirmSnap.priceSol && !confirmSnap.canSellOnJupiter && !exitRoute.routable) {
            await this.sellFraction(pos, 1.0, 'RUG_DRAIN', -100, cfg, true);
          } else {
            this.nullPriceTicks.set(pos.id, Math.max(0, misses - 2));
          }
        }
        return;
      }

      this.nullPriceTicks.set(pos.id, 0);
      const ticks = (this.tickCounter.get(pos.id) ?? 0) + 1;
      this.tickCounter.set(pos.id, ticks);

      const pnlPct = ((livePrice - pos.entryPriceSol) / pos.entryPriceSol) * 100;
      const hist = this.rollingPnlHistory.get(pos.id) ?? [];
      hist.push(pnlPct);
      if (hist.length > 20) hist.shift();
      this.rollingPnlHistory.set(pos.id, hist);

      // Compute recent return standard deviation for adaptive trailing stop tightening
      let recentVolStd = 0;
      if (hist.length >= 4) {
        const diffs: number[] = [];
        for (let i = 1; i < hist.length; i++) diffs.push(Math.abs(hist[i] - hist[i - 1]));
        recentVolStd = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      }

      // Periodic liquidity + continuous security reassessment every 4 ticks (~6s) or on sharp -45% drop
      if (pos.entryLiquidityUsd > 0 && (ticks % 4 === 0 || pnlPct <= -45)) {
        const probeSol = Math.min(0.1, Math.max(0.01, pos.initialSolSpent || 0.05));
        const [snap, secWatch] = await Promise.all([
          this.router.fetchMarketSnapshot(pos.mint, probeSol),
          this.antiRug && ticks % 8 === 0
            ? this.antiRug
                .reassessOpenPositionSecurity({
                  mint: pos.mint,
                  poolAddress: pos.poolAddress,
                  initialLpBurnedPct: 90,
                })
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        const liqCollapsed =
          snap.liquidityUsd !== null &&
          (snap.liquidityUsd < pos.entryLiquidityUsd * cfg.rugDrainLiqRatio ||
            snap.liquidityUsd < 1500);

        const secThreat =
          secWatch &&
          (secWatch.mintOrFreezeChangedAlert || secWatch.lpDropAlert || secWatch.dangerAlert);

        if (liqCollapsed || secThreat) {
          // Verify actual exit route before emergency panic action
          const routeCheck = await this.router.verifyExitRouteQuote(
            pos.mint,
            pos.remainingTokenAmount,
          );
          const isZeroPool = (snap.liquidityUsd ?? 0) < 150 || !routeCheck.routable;
          await this.sellFraction(pos, 1.0, 'RUG_DRAIN', pnlPct, cfg, isZeroPool);
          return;
        }
      }

      const highestPriceSol = Math.max(pos.highestPriceSol, livePrice);
      const effectiveTp1Pct = Number((cfg.tp1Pct * profile.tp1Mult).toFixed(1));
      const effectiveHardSlPct = Number((cfg.hardSlPct * profile.hardSlMult).toFixed(1));
      const effectiveTrailCb = Number(
        Math.max(
          5,
          Math.min(
            22,
            cfg.trailingCallbackPct *
              profile.trailCallbackMult *
              (recentVolStd >= 12 ? 0.8 : 1.0),
          ),
        ).toFixed(1),
      );

      let breakevenArmed = pos.breakevenArmed;
      let trailingActive = pos.trailingActive;
      let trailingStopPriceSol = pos.trailingStopPriceSol;
      let tp1TrailingArmed = pos.tp1TrailingArmed;
      let tp1PeakPriceSol = pos.tp1PeakPriceSol;
      let tp2TrailingArmed = pos.tp2TrailingArmed;
      let tp2PeakPriceSol = pos.tp2PeakPriceSol;

      if (cfg.breakevenLockEnabled && pnlPct >= cfg.breakevenActivatePct) {
        breakevenArmed = true;
      }

      if (cfg.trailingStopEnabled && pnlPct >= cfg.trailingActivatePct) {
        trailingActive = true;
        const candidateStop = highestPriceSol * (1 - effectiveTrailCb / 100);
        trailingStopPriceSol =
          trailingStopPriceSol !== null
            ? Math.max(trailingStopPriceSol, candidateStop)
            : candidateStop;
      }

      if (cfg.trailingTpEnabled && !pos.tp1Hit && (tp1TrailingArmed || pnlPct >= effectiveTp1Pct)) {
        tp1TrailingArmed = true;
        tp1PeakPriceSol =
          tp1PeakPriceSol !== null ? Math.max(tp1PeakPriceSol, livePrice) : livePrice;
      }

      if (
        cfg.trailingTpEnabled &&
        pos.tp1Hit &&
        !pos.tp2Hit &&
        (tp2TrailingArmed || pnlPct >= cfg.tp2Pct)
      ) {
        tp2TrailingArmed = true;
        tp2PeakPriceSol =
          tp2PeakPriceSol !== null ? Math.max(tp2PeakPriceSol, livePrice) : livePrice;
      }

      this.db.updatePositionState(pos.id, {
        currentPriceSol: livePrice,
        highestPriceSol,
        breakevenArmed,
        trailingActive,
        trailingStopPriceSol,
        tp1TrailingArmed,
        tp1PeakPriceSol,
        tp2TrailingArmed,
        tp2PeakPriceSol,
      });

      const ageMinutes = (Date.now() - pos.openedAt) / 60_000;

      // 1. Hard Stop-Loss + Early Momentum Cut (tighter invalidation for small-capital edge mode)
      const earlyCutAgeMin = cfg.smallCapEdgeMode ? 5 : 6;
      const earlyCutLossPct = cfg.smallCapEdgeMode ? -8 : -15;
      if (
        pnlPct <= -Math.abs(effectiveHardSlPct) ||
        (cfg.earlyMomentumCutEnabled &&
          ageMinutes >= earlyCutAgeMin &&
          pnlPct <= earlyCutLossPct &&
          !breakevenArmed &&
          !pos.tp1Hit)
      ) {
        await this.sellFraction(pos, 1.0, 'HARD_SL', pnlPct, cfg);
        return;
      }

      // 2. Multi-Tier Take Profit 1 (Dynamic per strategy + Partial Profit Lock)
      if (!pos.tp1Hit) {
        if (!cfg.trailingTpEnabled && pnlPct >= effectiveTp1Pct) {
          await this.sellFraction(pos, cfg.tp1SellSharePct / 100, 'TP1', pnlPct, cfg);
          return;
        }
        if (cfg.trailingTpEnabled && tp1TrailingArmed && tp1PeakPriceSol !== null) {
          const tp1Floor = pos.entryPriceSol * (1 + effectiveTp1Pct / 100);
          const tp1Trigger = Math.max(
            tp1Floor,
            tp1PeakPriceSol * (1 - cfg.trailingTpCallbackPct / 100),
          );
          if (livePrice <= tp1Trigger) {
            await this.sellFraction(pos, cfg.tp1SellSharePct / 100, 'TP1', pnlPct, cfg);
            return;
          }
        }
      }

      // 3. Multi-Tier Take Profit 2
      if (pos.tp1Hit && !pos.tp2Hit) {
        const shareOfRemaining = Math.min(1, cfg.tp2SellSharePct / (100 - cfg.tp1SellSharePct));
        if (!cfg.trailingTpEnabled && pnlPct >= cfg.tp2Pct) {
          await this.sellFraction(pos, shareOfRemaining, 'TP2', pnlPct, cfg);
          return;
        }
        if (cfg.trailingTpEnabled && tp2TrailingArmed && tp2PeakPriceSol !== null) {
          const tp2Floor = pos.entryPriceSol * (1 + cfg.tp2Pct / 100);
          const tp2Trigger = Math.max(
            tp2Floor,
            tp2PeakPriceSol * (1 - cfg.trailingTpCallbackPct / 100),
          );
          if (livePrice <= tp2Trigger) {
            await this.sellFraction(pos, shareOfRemaining, 'TP2', pnlPct, cfg);
            return;
          }
        }
      }

      // 4. Adaptive Trailing Stop-Loss trigger
      if (trailingActive && trailingStopPriceSol !== null && livePrice <= trailingStopPriceSol) {
        await this.sellFraction(pos, 1.0, 'TRAILING_SL', pnlPct, cfg);
        return;
      }

      // 5. Extreme Volatility Spike Exit (lock profits if peak was >= +35% and sudden >24% single-candle collapse)
      const peakPnlPct = ((highestPriceSol - pos.entryPriceSol) / pos.entryPriceSol) * 100;
      if (peakPnlPct >= 35 && recentVolStd >= 18 && pnlPct < peakPnlPct - 24 && pnlPct > 3) {
        await this.sellFraction(pos, 1.0, 'VOLATILITY_EXIT', pnlPct, cfg);
        return;
      }

      // 6. Orderflow Reversal & Whale Distribution Check (both profit protection >10% and early cut at <=-6%)
      if (this.orderflow && ageMinutes >= 1.5 && ticks % 6 === 0 && (pnlPct > 10 || pnlPct <= -6)) {
        const flow = await this.orderflow
          .analyzeEarlyMomentum(pos.mint, pos.creatorAddress, {
            minBuyCount: 1,
            minUniqueBuyers: 1,
            washTradeGuardEnabled: false,
            momentumFilterEnabled: false,
            poolAddress: pos.poolAddress,
          })
          .catch(() => null);

        if (flow) {
          if (flow.whaleSellCount >= 2 && flow.whaleNetSol <= (pnlPct > 10 ? -3.5 : -5)) {
            await this.sellFraction(pos, 1.0, 'WHALE_DISTRIBUTION', pnlPct, cfg);
            return;
          }
          if (flow.smartMoneyDistribution && flow.orderflowImbalance <= (pnlPct > 10 ? -0.4 : -0.45)) {
            await this.sellFraction(pos, 1.0, 'ORDERFLOW_REVERSAL', pnlPct, cfg);
            return;
          }
        }
      }

      // 7. Break-Even Positive Lock (pre-TP1 or post-TP1 fee-adjusted floor when trailing stop isn't active)
      const postTp1BeFloor = cfg.smallCapEdgeMode ? 3.5 : 2.5;
      if (
        cfg.breakevenLockEnabled &&
        ((breakevenArmed && !pos.tp1Hit && pnlPct <= 5.01) ||
          (pos.tp1Hit && !trailingActive && pnlPct <= postTp1BeFloor))
      ) {
        await this.sellFraction(pos, 1.0, 'BREAKEVEN_SL', pnlPct, cfg);
        return;
      }

      // 8. Intelligent Time Exit (scales window by entry strategy)
      const effectiveTimeMinutes = Number((cfg.timeExitMinutes * profile.timeExitMult).toFixed(1));
      if (
        cfg.timeExitEnabled &&
        ageMinutes >= effectiveTimeMinutes &&
        pnlPct < 8 &&
        !pos.tp1Hit &&
        !tp1TrailingArmed
      ) {
        await this.sellFraction(pos, 1.0, 'TIME_EXIT', pnlPct, cfg);
      }
    } finally {
      this.activeLocks.delete(pos.id);
    }
  }

  private async sellFraction(
    pos: PositionRecord,
    fraction: number,
    action: StrategyActionEvent['action'],
    pnlPct: number,
    cfg: RuntimeConfig,
    isRugDrain = false,
  ): Promise<void> {
    const sellTokenAmount = pos.remainingTokenAmount * fraction;
    if (sellTokenAmount <= 0) return;

    const result = await this.router.executeSell({
      mint: pos.mint,
      dex: pos.dex,
      poolAddress: pos.poolAddress,
      tokenAmountUi: sellTokenAmount,
      cfg,
      modeOverride: pos.mode,
      fallbackPriceSol: pos.currentPriceSol,
      isRugDrain,
      isEmergencyExit: action === 'RUG_DRAIN' || action === 'HARD_SL',
    });

    if (!result.success) {
      this.emit('execution_error', {
        positionId: pos.id,
        mint: pos.mint,
        action,
        error: result.error,
      });
      return;
    }

    const isFullExit =
      fraction >= 0.99 ||
      action === 'HARD_SL' ||
      action === 'TRAILING_SL' ||
      action === 'BREAKEVEN_SL' ||
      action === 'TIME_EXIT' ||
      action === 'RUG_DRAIN' ||
      action === 'ORDERFLOW_REVERSAL' ||
      action === 'WHALE_DISTRIBUTION' ||
      action === 'VOLATILITY_EXIT' ||
      action === 'PANIC_SELL';
    const nextRemainingTokens = isFullExit
      ? 0
      : Math.max(0, pos.remainingTokenAmount - sellTokenAmount);
    const costPortion = pos.remainingSolCostBasis * fraction;
    const realizedPnlForLeg = result.solAmount - costPortion;

    this.db.logTrade({
      positionId: pos.id,
      mint: pos.mint,
      symbol: pos.symbol,
      mode: pos.mode,
      side: 'SELL',
      dexRoute: result.dexRoute,
      solAmount: result.solAmount,
      tokenAmount: sellTokenAmount,
      priceSol: result.executionPriceSol,
      feeSol: result.priorityFeeSol + result.jitoTipSol,
      pnlSol: realizedPnlForLeg,
      signature: result.signature,
      reason: action,
      reconciled: result.reconciled,
      slippageDiffPct: result.slippageDiffPct,
      latencyMs: result.latencyMs,
    });

    const buyChatIdToDelete = cfg.autoDeleteEntryMsgEnabled ? (pos.buyChatId ?? null) : null;
    const buyMessageIdToDelete = cfg.autoDeleteEntryMsgEnabled ? (pos.buyMessageId ?? null) : null;

    const totalRealizedAfter = pos.realizedSol + result.solAmount;

    this.db.updatePositionState(pos.id, {
      remainingTokenAmount: nextRemainingTokens,
      remainingSolCostBasis: isFullExit ? 0 : Math.max(0, pos.remainingSolCostBasis - costPortion),
      realizedSol: totalRealizedAfter,
      tp1Hit: pos.tp1Hit || action === 'TP1',
      tp2Hit: pos.tp2Hit || action === 'TP2',
      status: isFullExit ? 'CLOSED' : 'OPEN',
      closedAt: isFullExit ? Date.now() : null,
      closeReason: isFullExit ? action : null,
      ...(buyMessageIdToDelete ? { buyMessageId: null } : {}),
    });

    if (action === 'RUG_DRAIN' && pos.creatorAddress) {
      this.db.blacklistCreator(
        pos.creatorAddress,
        `Auto-blacklisted after RUG_DRAIN on ${pos.symbol}`,
        'AUTO_RUG_DRAIN',
      );
    }

    if (isFullExit) {
      this.nullPriceTicks.delete(pos.id);
      this.tickCounter.delete(pos.id);
      this.rollingPnlHistory.delete(pos.id);

      const totalNetSol = totalRealizedAfter - pos.initialSolSpent;
      this.db.recordStrategyOutcome({
        strategy: pos.entryStrategy ?? 'EARLY_MOMENTUM',
        regime: pos.marketRegime ?? 'SIDEWAYS',
        won: totalNetSol >= 0,
        netPnlSol: totalNetSol,
        slippagePct: result.slippageDiffPct ?? 0,
      });

      if (cfg.circuitBreakerEnabled) {
        const lossStreak = this.db.getConsecutiveLossCount(pos.mode);
        if (lossStreak >= cfg.maxConsecutiveLosses && cfg.autoSnipeEnabled) {
          this.configManager.update({ autoSnipeEnabled: false });
          this.emit('circuit_breaker', { mode: pos.mode, lossStreak });
        }
      }

      if (this.treasury && (cfg.autoRentReclaimEnabled || cfg.autoConsolidateEnabled)) {
        const openPositions = this.db.getOpenPositions(pos.mode);
        const openMints = new Set(openPositions.map((p) => p.mint));
        const openExposureSol = this.db.getOpenExposureSol(pos.mode);
        const delayMs = pos.mode === 'LIVE' ? 2500 : 0;
        const runTreasury = async () => {
          const out = await this.treasury!.onPositionClosed({
            mint: pos.mint,
            mode: pos.mode,
            cfg,
            openMints,
            openExposureSol,
          });
          if (
            (out.reclaim && out.reclaim.closedCount > 0) ||
            (out.consolidation && out.consolidation.executed)
          ) {
            this.emit('treasury_action', out);
          }
        };
        if (delayMs > 0) {
          setTimeout(() => {
            void runTreasury().catch(() => {});
          }, delayMs);
        } else {
          await runTreasury().catch(() => {});
        }
      }
    }

    const event: StrategyActionEvent = {
      positionId: pos.id,
      mint: pos.mint,
      symbol: pos.symbol,
      mode: pos.mode,
      action,
      solReceived: result.solAmount,
      pnlPct,
      signature: result.signature,
      reconciled: result.reconciled,
      slippageDiffPct: result.slippageDiffPct,
      buyChatId: buyChatIdToDelete,
      buyMessageId: buyMessageIdToDelete,
    };
    this.emit('strategy_action', event);
  }

  public async panicSellAll(): Promise<StrategyActionEvent[]> {
    const cfg = this.configManager.get();
    const openPositions = this.db.getOpenPositions();
    const results: StrategyActionEvent[] = [];

    for (const pos of openPositions) {
      const pnlPct =
        pos.entryPriceSol > 0
          ? ((pos.currentPriceSol - pos.entryPriceSol) / pos.entryPriceSol) * 100
          : 0;

      const execRes = await this.router.executeSell({
        mint: pos.mint,
        dex: pos.dex,
        poolAddress: pos.poolAddress,
        tokenAmountUi: pos.remainingTokenAmount,
        cfg,
        modeOverride: pos.mode,
        fallbackPriceSol: pos.currentPriceSol,
        isEmergencyExit: true,
      });

      if (execRes.success) {
        const legPnl = execRes.solAmount - pos.remainingSolCostBasis;
        this.db.logTrade({
          positionId: pos.id,
          mint: pos.mint,
          symbol: pos.symbol,
          mode: pos.mode,
          side: 'SELL',
          dexRoute: execRes.dexRoute,
          solAmount: execRes.solAmount,
          tokenAmount: pos.remainingTokenAmount,
          priceSol: execRes.executionPriceSol,
          feeSol: execRes.priorityFeeSol + execRes.jitoTipSol,
          pnlSol: legPnl,
          signature: execRes.signature,
          reason: 'PANIC_SELL',
          reconciled: execRes.reconciled,
          slippageDiffPct: execRes.slippageDiffPct,
          latencyMs: execRes.latencyMs,
        });

        const buyChatIdToDelete = cfg.autoDeleteEntryMsgEnabled ? (pos.buyChatId ?? null) : null;
        const buyMessageIdToDelete = cfg.autoDeleteEntryMsgEnabled
          ? (pos.buyMessageId ?? null)
          : null;

        this.db.updatePositionState(pos.id, {
          remainingTokenAmount: 0,
          remainingSolCostBasis: 0,
          realizedSol: pos.realizedSol + execRes.solAmount,
          status: 'CLOSED',
          closedAt: Date.now(),
          closeReason: 'PANIC_SELL',
          ...(buyMessageIdToDelete ? { buyMessageId: null } : {}),
        });

        this.nullPriceTicks.delete(pos.id);
        this.tickCounter.delete(pos.id);
        this.rollingPnlHistory.delete(pos.id);

        results.push({
          positionId: pos.id,
          mint: pos.mint,
          symbol: pos.symbol,
          mode: pos.mode,
          action: 'PANIC_SELL',
          solReceived: execRes.solAmount,
          pnlPct,
          signature: execRes.signature,
          reconciled: execRes.reconciled,
          slippageDiffPct: execRes.slippageDiffPct,
          buyChatId: buyChatIdToDelete,
          buyMessageId: buyMessageIdToDelete,
        });
      }
    }

    if (results.length > 0 && this.treasury && (cfg.autoRentReclaimEnabled || cfg.autoConsolidateEnabled)) {
      const openMints = new Set(this.db.getOpenPositions().map((p) => p.mint));
      setTimeout(() => {
        void this.treasury
          ?.reclaimEmptyTokenAccounts({
            mode: cfg.tradingMode,
            openMints,
          })
          .then((reclaim) => {
            if (reclaim.closedCount > 0) {
              this.emit('treasury_action', { reclaim });
            }
          })
          .catch(() => {});
      }, cfg.tradingMode === 'LIVE' ? 2500 : 0);
    }

    return results;
  }
}
