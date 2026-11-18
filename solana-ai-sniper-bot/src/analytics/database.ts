import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  AiModelVersionRecord,
  AntiRugReport,
  DexSource,
  EntryStrategyId,
  MarketRegimeType,
  OrderflowResult,
  PnlSummary,
  PositionRecord,
  SmartWalletProfile,
  TokenSnapshotRecord,
  TradeLogRecord,
} from '../core/types';
import { TradingMode } from '../config/env';

export class SniperDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string, initialPaperBalanceSol: number) {
    const resolved = path.resolve(process.cwd(), dbPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.initSchema(initialPaperBalanceSol);
  }

  private initSchema(initialPaperBalanceSol: number): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_wallet (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        balance_sol REAL NOT NULL,
        initial_balance_sol REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        dex TEXT NOT NULL,
        pool_address TEXT,
        creator_address TEXT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        entry_strategy TEXT DEFAULT 'EARLY_MOMENTUM',
        market_regime TEXT DEFAULT 'SIDEWAYS',
        ai_score_at_entry REAL DEFAULT 0,
        entry_price_sol REAL NOT NULL,
        highest_price_sol REAL NOT NULL,
        current_price_sol REAL NOT NULL,
        entry_liquidity_usd REAL NOT NULL DEFAULT 0,
        initial_sol_spent REAL NOT NULL,
        remaining_sol_cost_basis REAL NOT NULL,
        initial_token_amount REAL NOT NULL,
        remaining_token_amount REAL NOT NULL,
        realized_sol REAL NOT NULL DEFAULT 0,
        tp1_hit INTEGER NOT NULL DEFAULT 0,
        tp1_trailing_armed INTEGER NOT NULL DEFAULT 0,
        tp1_peak_price_sol REAL,
        tp2_hit INTEGER NOT NULL DEFAULT 0,
        tp2_trailing_armed INTEGER NOT NULL DEFAULT 0,
        tp2_peak_price_sol REAL,
        breakeven_armed INTEGER NOT NULL DEFAULT 0,
        trailing_active INTEGER NOT NULL DEFAULT 0,
        trailing_stop_price_sol REAL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        close_reason TEXT,
        buy_chat_id INTEGER,
        buy_message_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        mode TEXT NOT NULL,
        side TEXT NOT NULL,
        dex_route TEXT NOT NULL,
        sol_amount REAL NOT NULL,
        token_amount REAL NOT NULL,
        price_sol REAL NOT NULL,
        fee_sol REAL NOT NULL,
        pnl_sol REAL NOT NULL DEFAULT 0,
        signature TEXT NOT NULL,
        reason TEXT NOT NULL,
        reconciled INTEGER NOT NULL DEFAULT 0,
        slippage_diff_pct REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        overall_safe INTEGER NOT NULL,
        security_score INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        lp_burned_pct REAL NOT NULL,
        top10_holders_pct REAL NOT NULL,
        dev_hold_pct REAL NOT NULL,
        bundle_supply_pct REAL NOT NULL,
        honeypot_passed INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS creator_blacklist (
        creator_address TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        strikes INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        dex TEXT NOT NULL,
        pool_address TEXT,
        creator_address TEXT,
        market_regime TEXT NOT NULL,
        entry_strategy TEXT,
        action_taken TEXT NOT NULL,
        rejection_stage TEXT,
        rejection_reason TEXT,
        security_score REAL NOT NULL DEFAULT 0,
        ai_quality_score REAL NOT NULL DEFAULT 0,
        pump_probability REAL NOT NULL DEFAULT 0,
        rug_probability REAL NOT NULL DEFAULT 0,
        smart_money_score REAL NOT NULL DEFAULT 0,
        social_score REAL NOT NULL DEFAULT 0,
        orderflow_imbalance REAL NOT NULL DEFAULT 0,
        cvd_sol REAL NOT NULL DEFAULT 0,
        liquidity_usd REAL NOT NULL DEFAULT 0,
        price_sol_at_discovery REAL NOT NULL DEFAULT 0,
        price_1m_sol REAL,
        price_5m_sol REAL,
        price_15m_sol REAL,
        price_1h_sol REAL,
        price_24h_sol REAL,
        realized_pnl_pct REAL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_token_snapshots_mint_time
        ON token_snapshots(mint, created_at DESC);

      CREATE TABLE IF NOT EXISTS orderflow_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        data_source TEXT NOT NULL,
        buy_count INTEGER NOT NULL,
        sell_count INTEGER NOT NULL,
        buy_sol_volume REAL NOT NULL,
        sell_sol_volume REAL NOT NULL,
        cvd_sol REAL NOT NULL,
        imbalance REAL NOT NULL,
        whale_buy_count INTEGER NOT NULL DEFAULT 0,
        whale_sell_count INTEGER NOT NULL DEFAULT 0,
        sybil_score REAL NOT NULL DEFAULT 0,
        wash_trade_suspected INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orderflow_snapshots_mint_time
        ON orderflow_snapshots(mint, created_at DESC);

      CREATE TABLE IF NOT EXISTS wallet_intelligence (
        wallet TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'UNKNOWN',
        total_trades INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        win_rate_pct REAL NOT NULL DEFAULT 50,
        profit_factor REAL NOT NULL DEFAULT 1,
        realized_pnl_sol REAL NOT NULL DEFAULT 0,
        avg_roi_pct REAL NOT NULL DEFAULT 0,
        reputation_score REAL NOT NULL DEFAULT 50,
        cluster_id TEXT,
        is_insider INTEGER NOT NULL DEFAULT 0,
        is_whale INTEGER NOT NULL DEFAULT 0,
        last_active_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS strategy_performance (
        strategy TEXT NOT NULL,
        regime TEXT NOT NULL,
        trades INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        net_pnl_sol REAL NOT NULL DEFAULT 0,
        avg_slippage_pct REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (strategy, regime)
      );

      CREATE TABLE IF NOT EXISTS ai_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        model_version TEXT NOT NULL,
        predicted_pump_prob REAL NOT NULL,
        predicted_rug_prob REAL NOT NULL,
        quality_score REAL NOT NULL,
        calibrated_confidence REAL NOT NULL,
        features_json TEXT NOT NULL,
        decision TEXT NOT NULL,
        actual_win INTEGER,
        actual_return_15m_pct REAL,
        evaluated_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_model_registry (
        version TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        sample_size INTEGER NOT NULL,
        in_sample_accuracy_pct REAL NOT NULL,
        oos_accuracy_pct REAL NOT NULL,
        brier_score REAL NOT NULL,
        status TEXT NOT NULL,
        weights_json TEXT NOT NULL,
        feature_importance_json TEXT NOT NULL,
        notes TEXT NOT NULL
      );
    `);

    const existingCols = (
      this.db.prepare("PRAGMA table_info('positions')").all() as Array<{ name: string }>
    ).map((c) => c.name);
    if (!existingCols.includes('tp1_trailing_armed')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN tp1_trailing_armed INTEGER NOT NULL DEFAULT 0');
    }
    if (!existingCols.includes('tp1_peak_price_sol')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN tp1_peak_price_sol REAL');
    }
    if (!existingCols.includes('tp2_trailing_armed')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN tp2_trailing_armed INTEGER NOT NULL DEFAULT 0');
    }
    if (!existingCols.includes('tp2_peak_price_sol')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN tp2_peak_price_sol REAL');
    }
    if (!existingCols.includes('entry_liquidity_usd')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN entry_liquidity_usd REAL NOT NULL DEFAULT 0');
    }
    if (!existingCols.includes('breakeven_armed')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN breakeven_armed INTEGER NOT NULL DEFAULT 0');
    }
    if (!existingCols.includes('pool_address')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN pool_address TEXT');
    }
    if (!existingCols.includes('creator_address')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN creator_address TEXT');
    }
    if (!existingCols.includes('buy_chat_id')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN buy_chat_id INTEGER');
    }
    if (!existingCols.includes('buy_message_id')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN buy_message_id INTEGER');
    }
    if (!existingCols.includes('entry_strategy')) {
      this.db.exec("ALTER TABLE positions ADD COLUMN entry_strategy TEXT DEFAULT 'EARLY_MOMENTUM'");
    }
    if (!existingCols.includes('market_regime')) {
      this.db.exec("ALTER TABLE positions ADD COLUMN market_regime TEXT DEFAULT 'SIDEWAYS'");
    }
    if (!existingCols.includes('ai_score_at_entry')) {
      this.db.exec('ALTER TABLE positions ADD COLUMN ai_score_at_entry REAL DEFAULT 0');
    }

    const tradeCols = (
      this.db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>
    ).map((c) => c.name);
    if (!tradeCols.includes('reconciled')) {
      this.db.exec('ALTER TABLE trades ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 0');
    }
    if (!tradeCols.includes('slippage_diff_pct')) {
      this.db.exec('ALTER TABLE trades ADD COLUMN slippage_diff_pct REAL NOT NULL DEFAULT 0');
    }
    if (!tradeCols.includes('latency_ms')) {
      this.db.exec('ALTER TABLE trades ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0');
    }

    const row = this.db.prepare('SELECT id FROM paper_wallet WHERE id = 1').get();
    if (!row) {
      this.db
        .prepare(
          'INSERT INTO paper_wallet (id, balance_sol, initial_balance_sol, updated_at) VALUES (1, ?, ?, ?)',
        )
        .run(initialPaperBalanceSol, initialPaperBalanceSol, Date.now());
    }
  }

  public getPaperBalance(): { balanceSol: number; initialBalanceSol: number } {
    const row = this.db
      .prepare('SELECT balance_sol, initial_balance_sol FROM paper_wallet WHERE id = 1')
      .get() as { balance_sol: number; initial_balance_sol: number };
    return { balanceSol: row.balance_sol, initialBalanceSol: row.initial_balance_sol };
  }

  public adjustPaperBalance(deltaSol: number): number {
    const current = this.getPaperBalance().balanceSol;
    const next = Math.max(0, Number((current + deltaSol).toFixed(9)));
    this.db
      .prepare('UPDATE paper_wallet SET balance_sol = ?, updated_at = ? WHERE id = 1')
      .run(next, Date.now());
    return next;
  }

  public setPaperBalance(newBalanceSol: number): { balanceSol: number; initialBalanceSol: number } {
    const clean = Math.max(0.001, Number(newBalanceSol.toFixed(6)));
    const closedRow = this.db
      .prepare(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(realized_sol - initial_sol_spent), 0) as net FROM positions WHERE status = 'CLOSED' AND mode = 'PAPER'",
      )
      .get() as { cnt: number; net: number };
    const openExposure = this.getOpenExposureSol('PAPER');

    const initialBalanceSol =
      closedRow.cnt === 0 && openExposure === 0
        ? clean
        : Math.max(0.001, Number((clean + openExposure - closedRow.net).toFixed(6)));

    this.db
      .prepare(
        'UPDATE paper_wallet SET balance_sol = ?, initial_balance_sol = ?, updated_at = ? WHERE id = 1',
      )
      .run(clean, initialBalanceSol, Date.now());

    return { balanceSol: clean, initialBalanceSol };
  }

  public resetPaperAccount(newBalanceSol: number): {
    balanceSol: number;
    deletedPositions: number;
    deletedTrades: number;
  } {
    const clean = Math.max(0.001, Number(newBalanceSol.toFixed(6)));
    const tx = this.db.transaction(() => {
      const delTrades = this.db.prepare("DELETE FROM trades WHERE mode = 'PAPER'").run();
      const delPositions = this.db.prepare("DELETE FROM positions WHERE mode = 'PAPER'").run();
      this.db
        .prepare(
          'UPDATE paper_wallet SET balance_sol = ?, initial_balance_sol = ?, updated_at = ? WHERE id = 1',
        )
        .run(clean, clean, Date.now());
      return {
        balanceSol: clean,
        deletedPositions: delPositions.changes,
        deletedTrades: delTrades.changes,
      };
    });
    return tx();
  }

  public resetPaperBalance(newBalanceSol: number): void {
    this.resetPaperAccount(newBalanceSol);
  }

  public saveSecurityAudit(report: AntiRugReport): void {
    this.db
      .prepare(
        `INSERT INTO security_audits (
          mint, overall_safe, security_score, elapsed_ms, lp_burned_pct,
          top10_holders_pct, dev_hold_pct, bundle_supply_pct, honeypot_passed,
          report_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.mint,
        report.overallSafe ? 1 : 0,
        report.securityScore,
        report.elapsedMs,
        report.lpBurnedPct,
        report.top10HoldersPct,
        report.devHoldPct,
        report.bundleSupplyPct,
        report.honeypotPassed ? 1 : 0,
        JSON.stringify(report),
        Date.now(),
      );
  }

  public saveTokenSnapshot(snap: TokenSnapshotRecord): number {
    const res = this.db
      .prepare(
        `INSERT INTO token_snapshots (
          mint, symbol, dex, pool_address, creator_address, market_regime,
          entry_strategy, action_taken, rejection_stage, rejection_reason,
          security_score, ai_quality_score, pump_probability, rug_probability,
          smart_money_score, social_score, orderflow_imbalance, cvd_sol,
          liquidity_usd, price_sol_at_discovery, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snap.mint,
        snap.symbol,
        snap.dex,
        snap.poolAddress ?? null,
        snap.creatorAddress ?? null,
        snap.marketRegime,
        snap.entryStrategy ?? null,
        snap.actionTaken,
        snap.rejectionStage ?? null,
        snap.rejectionReason ?? null,
        snap.securityScore,
        snap.aiQualityScore,
        snap.pumpProbability,
        snap.rugProbability,
        snap.smartMoneyScore,
        snap.socialScore,
        snap.orderflowImbalance,
        snap.cvdSol,
        snap.liquidityUsd,
        snap.priceSolAtDiscovery,
        snap.createdAt,
      );
    return Number(res.lastInsertRowid);
  }

  public updateTokenSnapshotHorizon(
    id: number,
    patch: Partial<{
      price1mSol: number;
      price5mSol: number;
      price15mSol: number;
      price1hSol: number;
      price24hSol: number;
      realizedPnlPct: number;
    }>,
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.price1mSol !== undefined) {
      sets.push('price_1m_sol = ?');
      vals.push(patch.price1mSol);
    }
    if (patch.price5mSol !== undefined) {
      sets.push('price_5m_sol = ?');
      vals.push(patch.price5mSol);
    }
    if (patch.price15mSol !== undefined) {
      sets.push('price_15m_sol = ?');
      vals.push(patch.price15mSol);
    }
    if (patch.price1hSol !== undefined) {
      sets.push('price_1h_sol = ?');
      vals.push(patch.price1hSol);
    }
    if (patch.price24hSol !== undefined) {
      sets.push('price_24h_sol = ?');
      vals.push(patch.price24hSol);
    }
    if (patch.realizedPnlPct !== undefined) {
      sets.push('realized_pnl_pct = ?');
      vals.push(patch.realizedPnlPct);
    }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE token_snapshots SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  public listPendingHorizonSnapshots(limit = 30): TokenSnapshotRecord[] {
    const cutoff = Date.now() - 25 * 60 * 60_000;
    const rows = this.db
      .prepare(
        `SELECT * FROM token_snapshots
         WHERE created_at >= ?
           AND price_sol_at_discovery > 0
           AND (price_1m_sol IS NULL OR price_5m_sol IS NULL OR price_15m_sol IS NULL OR price_1h_sol IS NULL OR price_24h_sol IS NULL)
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(cutoff, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTokenSnapshot(r));
  }

  public listRecentTokenSnapshots(limit = 200): TokenSnapshotRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM token_snapshots ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTokenSnapshot(r));
  }

  public saveOrderflowSnapshot(mint: string, flow: OrderflowResult): void {
    this.db
      .prepare(
        `INSERT INTO orderflow_snapshots (
          mint, data_source, buy_count, sell_count, buy_sol_volume, sell_sol_volume,
          cvd_sol, imbalance, whale_buy_count, whale_sell_count, sybil_score,
          wash_trade_suspected, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mint,
        flow.dataSource,
        flow.buyCount,
        flow.sellCount,
        flow.buySolVolume,
        flow.sellSolVolume,
        flow.cvdSol,
        flow.orderflowImbalance,
        flow.whaleBuyCount,
        flow.whaleSellCount,
        flow.sybilScore,
        flow.washTradeSuspected ? 1 : 0,
        Date.now(),
      );
  }

  public getOrderflowHistory(mint: string, limit = 15): Array<{
    cvdSol: number;
    imbalance: number;
    buySolVolume: number;
    sellSolVolume: number;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(
        'SELECT cvd_sol, imbalance, buy_sol_volume, sell_sol_volume, created_at FROM orderflow_snapshots WHERE mint = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(mint, limit) as Array<{
      cvd_sol: number;
      imbalance: number;
      buy_sol_volume: number;
      sell_sol_volume: number;
      created_at: number;
    }>;
    return rows.map((r) => ({
      cvdSol: r.cvd_sol,
      imbalance: r.imbalance,
      buySolVolume: r.buy_sol_volume,
      sellSolVolume: r.sell_sol_volume,
      createdAt: r.created_at,
    }));
  }

  public upsertSmartWallet(profile: Partial<SmartWalletProfile> & { wallet: string }): void {
    const existing = this.getSmartWallet(profile.wallet);
    const totalTrades = profile.totalTrades ?? existing?.totalTrades ?? 0;
    const wins = profile.wins ?? existing?.wins ?? 0;
    const losses = profile.losses ?? existing?.losses ?? 0;
    const winRatePct =
      totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(2)) : profile.winRatePct ?? existing?.winRatePct ?? 50;
    const profitFactor = profile.profitFactor ?? existing?.profitFactor ?? 1;
    const realizedPnlSol = profile.realizedPnlSol ?? existing?.realizedPnlSol ?? 0;
    const avgRoiPct = profile.avgRoiPct ?? existing?.avgRoiPct ?? 0;
    const reputationScore = profile.reputationScore ?? existing?.reputationScore ?? 55;
    const tier = profile.tier ?? existing?.tier ?? 'UNKNOWN';
    const clusterId = profile.clusterId !== undefined ? profile.clusterId : existing?.clusterId ?? null;
    const isInsider = profile.isInsider ?? existing?.isInsider ?? false;
    const isWhale = profile.isWhale ?? existing?.isWhale ?? false;

    this.db
      .prepare(
        `INSERT INTO wallet_intelligence (
          wallet, tier, total_trades, wins, losses, win_rate_pct, profit_factor,
          realized_pnl_sol, avg_roi_pct, reputation_score, cluster_id, is_insider, is_whale, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(wallet) DO UPDATE SET
          tier = excluded.tier,
          total_trades = excluded.total_trades,
          wins = excluded.wins,
          losses = excluded.losses,
          win_rate_pct = excluded.win_rate_pct,
          profit_factor = excluded.profit_factor,
          realized_pnl_sol = excluded.realized_pnl_sol,
          avg_roi_pct = excluded.avg_roi_pct,
          reputation_score = excluded.reputation_score,
          cluster_id = excluded.cluster_id,
          is_insider = excluded.is_insider,
          is_whale = excluded.is_whale,
          last_active_at = excluded.last_active_at`,
      )
      .run(
        profile.wallet,
        tier,
        totalTrades,
        wins,
        losses,
        winRatePct,
        profitFactor,
        realizedPnlSol,
        avgRoiPct,
        reputationScore,
        clusterId,
        isInsider ? 1 : 0,
        isWhale ? 1 : 0,
        profile.lastActiveAt ?? Date.now(),
      );
  }

  public getSmartWallet(wallet: string): SmartWalletProfile | null {
    const row = this.db
      .prepare('SELECT * FROM wallet_intelligence WHERE wallet = ?')
      .get(wallet) as Record<string, unknown> | undefined;
    return row ? this.mapSmartWallet(row) : null;
  }

  public getSmartWalletsBatch(wallets: string[]): SmartWalletProfile[] {
    if (wallets.length === 0) return [];
    const clean = wallets.slice(0, 60);
    const placeholders = clean.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM wallet_intelligence WHERE wallet IN (${placeholders})`)
      .all(...clean) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapSmartWallet(r));
  }

  public listTopSmartWallets(limit = 15): SmartWalletProfile[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM wallet_intelligence ORDER BY reputation_score DESC, realized_pnl_sol DESC LIMIT ?',
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapSmartWallet(r));
  }

  public recordStrategyOutcome(params: {
    strategy: EntryStrategyId;
    regime: MarketRegimeType;
    won: boolean;
    netPnlSol: number;
    slippagePct?: number;
  }): void {
    const cur = this.db
      .prepare('SELECT * FROM strategy_performance WHERE strategy = ? AND regime = ?')
      .get(params.strategy, params.regime) as
      | { trades: number; wins: number; net_pnl_sol: number; avg_slippage_pct: number }
      | undefined;

    const trades = (cur?.trades ?? 0) + 1;
    const wins = (cur?.wins ?? 0) + (params.won ? 1 : 0);
    const netPnlSol = Number(((cur?.net_pnl_sol ?? 0) + params.netPnlSol).toFixed(6));
    const prevAvgSlip = cur?.avg_slippage_pct ?? 0;
    const nextSlip = Number(
      (((prevAvgSlip * (trades - 1)) + Math.abs(params.slippagePct ?? 0)) / trades).toFixed(2),
    );

    this.db
      .prepare(
        `INSERT INTO strategy_performance (strategy, regime, trades, wins, net_pnl_sol, avg_slippage_pct, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(strategy, regime) DO UPDATE SET
           trades = excluded.trades,
           wins = excluded.wins,
           net_pnl_sol = excluded.net_pnl_sol,
           avg_slippage_pct = excluded.avg_slippage_pct,
           updated_at = excluded.updated_at`,
      )
      .run(params.strategy, params.regime, trades, wins, netPnlSol, nextSlip, Date.now());
  }

  public listStrategyPerformance(): Array<{
    strategy: string;
    regime: string;
    trades: number;
    wins: number;
    winRatePct: number;
    netPnlSol: number;
    avgSlippagePct: number;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM strategy_performance ORDER BY net_pnl_sol DESC')
      .all() as Array<{
      strategy: string;
      regime: string;
      trades: number;
      wins: number;
      net_pnl_sol: number;
      avg_slippage_pct: number;
    }>;
    return rows.map((r) => ({
      strategy: r.strategy,
      regime: r.regime,
      trades: r.trades,
      wins: r.wins,
      winRatePct: r.trades > 0 ? Number(((r.wins / r.trades) * 100).toFixed(1)) : 0,
      netPnlSol: r.net_pnl_sol,
      avgSlippagePct: r.avg_slippage_pct,
    }));
  }

  public logAiDecision(params: {
    mint: string;
    symbol: string;
    modelVersion: string;
    predictedPumpProb: number;
    predictedRugProb: number;
    qualityScore: number;
    calibratedConfidence: number;
    features: Record<string, number>;
    decision: 'APPROVED' | 'REJECTED';
  }): void {
    this.db
      .prepare(
        `INSERT INTO ai_decisions (
          mint, symbol, model_version, predicted_pump_prob, predicted_rug_prob,
          quality_score, calibrated_confidence, features_json, decision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.mint,
        params.symbol,
        params.modelVersion,
        params.predictedPumpProb,
        params.predictedRugProb,
        params.qualityScore,
        params.calibratedConfidence,
        JSON.stringify(params.features),
        params.decision,
        Date.now(),
      );
  }

  public evaluatePendingAiDecisions(mint: string, return15mPct: number): void {
    const actualWin = return15mPct >= 15 ? 1 : 0;
    this.db
      .prepare(
        `UPDATE ai_decisions SET actual_win = ?, actual_return_15m_pct = ?, evaluated_at = ?
         WHERE mint = ? AND actual_win IS NULL`,
      )
      .run(actualWin, return15mPct, Date.now(), mint);
  }

  public getEvaluatedAiDecisions(limit = 200): Array<{
    mint: string;
    symbol: string;
    modelVersion: string;
    predictedPumpProb: number;
    predictedRugProb: number;
    qualityScore: number;
    features: Record<string, number>;
    actualWin: number;
    actualReturn15mPct: number;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(
        'SELECT * FROM ai_decisions WHERE actual_win IS NOT NULL ORDER BY created_at ASC LIMIT ?',
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      let features: Record<string, number> = {};
      try {
        features = JSON.parse(String(r.features_json || '{}')) as Record<string, number>;
      } catch {
        features = {};
      }
      return {
        mint: String(r.mint),
        symbol: String(r.symbol),
        modelVersion: String(r.model_version),
        predictedPumpProb: Number(r.predicted_pump_prob),
        predictedRugProb: Number(r.predicted_rug_prob),
        qualityScore: Number(r.quality_score),
        features,
        actualWin: Number(r.actual_win),
        actualReturn15mPct: Number(r.actual_return_15m_pct ?? 0),
        createdAt: Number(r.created_at),
      };
    });
  }

  public saveAiModelVersion(record: AiModelVersionRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ai_model_registry (
          version, created_at, sample_size, in_sample_accuracy_pct, oos_accuracy_pct,
          brier_score, status, weights_json, feature_importance_json, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.version,
        record.createdAt,
        record.sampleSize,
        record.inSampleAccuracyPct,
        record.oosAccuracyPct,
        record.brierScore,
        record.status,
        record.weightsJson,
        record.featureImportanceJson,
        record.notes,
      );
  }

  public getActiveAiModel(): AiModelVersionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM ai_model_registry WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return row ? this.mapAiModel(row) : null;
  }

  public listAiModels(limit = 10): AiModelVersionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM ai_model_registry ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapAiModel(r));
  }

  public approveAiModel(version: string): boolean {
    const target = this.db
      .prepare('SELECT version FROM ai_model_registry WHERE version = ?')
      .get(version) as { version: string } | undefined;
    if (!target) return false;
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE ai_model_registry SET status = 'APPROVED' WHERE status = 'ACTIVE'")
        .run();
      this.db
        .prepare("UPDATE ai_model_registry SET status = 'ACTIVE' WHERE version = ?")
        .run(version);
    });
    tx();
    return true;
  }

  public createPosition(params: {
    mint: string;
    symbol: string;
    dex: DexSource;
    poolAddress?: string;
    creatorAddress?: string;
    mode: TradingMode;
    entryStrategy?: EntryStrategyId;
    marketRegime?: MarketRegimeType;
    aiScoreAtEntry?: number;
    entryPriceSol: number;
    entryLiquidityUsd?: number;
    solSpent: number;
    tokenAmount: number;
    buyChatId?: number | null;
    buyMessageId?: number | null;
  }): PositionRecord {
    const now = Date.now();
    const res = this.db
      .prepare(
        `INSERT INTO positions (
          mint, symbol, dex, pool_address, creator_address, mode, status,
          entry_strategy, market_regime, ai_score_at_entry,
          entry_price_sol, highest_price_sol,
          current_price_sol, entry_liquidity_usd, initial_sol_spent, remaining_sol_cost_basis,
          initial_token_amount, remaining_token_amount, realized_sol,
          tp1_hit, tp1_trailing_armed, tp1_peak_price_sol,
          tp2_hit, tp2_trailing_armed, tp2_peak_price_sol,
          breakeven_armed, trailing_active, trailing_stop_price_sol, opened_at,
          buy_chat_id, buy_message_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, ?, ?, ?)`,
      )
      .run(
        params.mint,
        params.symbol,
        params.dex,
        params.poolAddress ?? null,
        params.creatorAddress ?? null,
        params.mode,
        params.entryStrategy ?? 'EARLY_MOMENTUM',
        params.marketRegime ?? 'SIDEWAYS',
        params.aiScoreAtEntry ?? 0,
        params.entryPriceSol,
        params.entryPriceSol,
        params.entryPriceSol,
        params.entryLiquidityUsd ?? 0,
        params.solSpent,
        params.solSpent,
        params.tokenAmount,
        params.tokenAmount,
        now,
        params.buyChatId ?? null,
        params.buyMessageId ?? null,
      );

    return this.getPositionById(Number(res.lastInsertRowid))!;
  }

  public getPositionById(id: number): PositionRecord | null {
    const row = this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapPosition(row) : null;
  }

  public getOpenPositions(mode?: TradingMode): PositionRecord[] {
    const rows = mode
      ? (this.db
          .prepare("SELECT * FROM positions WHERE status = 'OPEN' AND mode = ? ORDER BY opened_at DESC")
          .all(mode) as Array<Record<string, unknown>>)
      : (this.db
          .prepare("SELECT * FROM positions WHERE status = 'OPEN' ORDER BY opened_at DESC")
          .all() as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapPosition(r));
  }

  public getClosedPositions(mode?: TradingMode, limit = 100): PositionRecord[] {
    const rows = mode
      ? (this.db
          .prepare(
            "SELECT * FROM positions WHERE status = 'CLOSED' AND mode = ? ORDER BY closed_at DESC LIMIT ?",
          )
          .all(mode, limit) as Array<Record<string, unknown>>)
      : (this.db
          .prepare("SELECT * FROM positions WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT ?")
          .all(limit) as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapPosition(r));
  }

  public getConsecutiveLossCount(mode: TradingMode): number {
    const rows = this.db
      .prepare(
        "SELECT realized_sol, initial_sol_spent FROM positions WHERE status = 'CLOSED' AND mode = ? ORDER BY closed_at DESC LIMIT 15",
      )
      .all(mode) as Array<{ realized_sol: number; initial_sol_spent: number }>;

    let streak = 0;
    for (const row of rows) {
      if (row.realized_sol - row.initial_sol_spent < 0) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  public getOpenExposureSol(mode: TradingMode): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(remaining_sol_cost_basis), 0) as total FROM positions WHERE status = 'OPEN' AND mode = ?",
      )
      .get(mode) as { total: number };
    return Number((row?.total ?? 0).toFixed(6));
  }

  public getDailyRealizedPnlSol(mode: TradingMode): number {
    const now = new Date();
    const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(realized_sol - initial_sol_spent), 0) as net FROM positions WHERE status = 'CLOSED' AND mode = ? AND closed_at >= ?",
      )
      .get(mode, utcDayStart) as { net: number };
    return Number((row?.net ?? 0).toFixed(6));
  }

  public getWeeklyRealizedPnlSol(mode: TradingMode): number {
    const weekStart = Date.now() - 7 * 24 * 60 * 60_000;
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(realized_sol - initial_sol_spent), 0) as net FROM positions WHERE status = 'CLOSED' AND mode = ? AND closed_at >= ?",
      )
      .get(mode, weekStart) as { net: number };
    return Number((row?.net ?? 0).toFixed(6));
  }

  public getRecentWinRatePct(mode: TradingMode, limit = 10): { winRatePct: number; sampleCount: number } {
    const rows = this.db
      .prepare(
        "SELECT realized_sol, initial_sol_spent FROM positions WHERE status = 'CLOSED' AND mode = ? ORDER BY closed_at DESC LIMIT ?",
      )
      .all(mode, limit) as Array<{ realized_sol: number; initial_sol_spent: number }>;
    if (rows.length === 0) return { winRatePct: 100, sampleCount: 0 };
    const wins = rows.filter((r) => r.realized_sol - r.initial_sol_spent >= 0).length;
    return {
      winRatePct: Number(((wins / rows.length) * 100).toFixed(1)),
      sampleCount: rows.length,
    };
  }

  public isCreatorBlacklisted(
    creatorAddress?: string | null,
  ): { blacklisted: boolean; reason?: string; strikes?: number } {
    if (!creatorAddress) return { blacklisted: false };
    const row = this.db
      .prepare('SELECT reason, strikes FROM creator_blacklist WHERE creator_address = ?')
      .get(creatorAddress) as { reason: string; strikes: number } | undefined;
    if (!row) return { blacklisted: false };
    return { blacklisted: true, reason: row.reason, strikes: row.strikes };
  }

  public blacklistCreator(creatorAddress: string, reason: string, source = 'AUTO'): void {
    const trimmed = creatorAddress.trim();
    if (trimmed.length < 32) return;
    this.db
      .prepare(
        `INSERT INTO creator_blacklist (creator_address, reason, source, strikes, added_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(creator_address) DO UPDATE SET
           reason = excluded.reason,
           strikes = creator_blacklist.strikes + 1,
           added_at = excluded.added_at`,
      )
      .run(trimmed, reason, source, Date.now());
  }

  public unblacklistCreator(creatorAddress: string): boolean {
    const res = this.db
      .prepare('DELETE FROM creator_blacklist WHERE creator_address = ?')
      .run(creatorAddress.trim());
    return res.changes > 0;
  }

  public listBlacklistedCreators(
    limit = 20,
  ): Array<{ creatorAddress: string; reason: string; source: string; strikes: number; addedAt: number }> {
    const rows = this.db
      .prepare(
        'SELECT creator_address, reason, source, strikes, added_at FROM creator_blacklist ORDER BY added_at DESC LIMIT ?',
      )
      .all(limit) as Array<{
      creator_address: string;
      reason: string;
      source: string;
      strikes: number;
      added_at: number;
    }>;
    return rows.map((r) => ({
      creatorAddress: r.creator_address,
      reason: r.reason,
      source: r.source,
      strikes: r.strikes,
      addedAt: r.added_at,
    }));
  }

  public getBlacklistedCreatorCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM creator_blacklist').get() as {
      cnt: number;
    };
    return row?.cnt ?? 0;
  }

  public updatePositionState(
    id: number,
    patch: Partial<{
      highestPriceSol: number;
      currentPriceSol: number;
      remainingSolCostBasis: number;
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
      status: 'OPEN' | 'CLOSED';
      closedAt: number | null;
      closeReason: string | null;
      buyChatId: number | null;
      buyMessageId: number | null;
    }>,
  ): void {
    const current = this.getPositionById(id);
    if (!current) return;

    this.db
      .prepare(
        `UPDATE positions SET
          highest_price_sol = ?,
          current_price_sol = ?,
          remaining_sol_cost_basis = ?,
          remaining_token_amount = ?,
          realized_sol = ?,
          tp1_hit = ?,
          tp1_trailing_armed = ?,
          tp1_peak_price_sol = ?,
          tp2_hit = ?,
          tp2_trailing_armed = ?,
          tp2_peak_price_sol = ?,
          breakeven_armed = ?,
          trailing_active = ?,
          trailing_stop_price_sol = ?,
          status = ?,
          closed_at = ?,
          close_reason = ?,
          buy_chat_id = ?,
          buy_message_id = ?
        WHERE id = ?`,
      )
      .run(
        patch.highestPriceSol ?? current.highestPriceSol,
        patch.currentPriceSol ?? current.currentPriceSol,
        patch.remainingSolCostBasis ?? current.remainingSolCostBasis,
        patch.remainingTokenAmount ?? current.remainingTokenAmount,
        patch.realizedSol ?? current.realizedSol,
        (patch.tp1Hit ?? current.tp1Hit) ? 1 : 0,
        (patch.tp1TrailingArmed ?? current.tp1TrailingArmed) ? 1 : 0,
        patch.tp1PeakPriceSol !== undefined ? patch.tp1PeakPriceSol : current.tp1PeakPriceSol,
        (patch.tp2Hit ?? current.tp2Hit) ? 1 : 0,
        (patch.tp2TrailingArmed ?? current.tp2TrailingArmed) ? 1 : 0,
        patch.tp2PeakPriceSol !== undefined ? patch.tp2PeakPriceSol : current.tp2PeakPriceSol,
        (patch.breakevenArmed ?? current.breakevenArmed) ? 1 : 0,
        (patch.trailingActive ?? current.trailingActive) ? 1 : 0,
        patch.trailingStopPriceSol !== undefined
          ? patch.trailingStopPriceSol
          : current.trailingStopPriceSol,
        patch.status ?? current.status,
        patch.closedAt !== undefined ? patch.closedAt : current.closedAt,
        patch.closeReason !== undefined ? patch.closeReason : current.closeReason,
        patch.buyChatId !== undefined ? patch.buyChatId : (current.buyChatId ?? null),
        patch.buyMessageId !== undefined ? patch.buyMessageId : (current.buyMessageId ?? null),
        id,
      );
  }

  public logTrade(params: Omit<TradeLogRecord, 'id' | 'createdAt'>): void {
    this.db
      .prepare(
        `INSERT INTO trades (
          position_id, mint, symbol, mode, side, dex_route, sol_amount,
          token_amount, price_sol, fee_sol, pnl_sol, signature, reason,
          reconciled, slippage_diff_pct, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.positionId,
        params.mint,
        params.symbol,
        params.mode,
        params.side,
        params.dexRoute,
        params.solAmount,
        params.tokenAmount,
        params.priceSol,
        params.feeSol,
        params.pnlSol,
        params.signature,
        params.reason,
        params.reconciled ? 1 : 0,
        params.slippageDiffPct ?? 0,
        params.latencyMs ?? 0,
        Date.now(),
      );
  }

  public listRecentTrades(modeFilter: TradingMode | 'ALL' = 'ALL', limit = 100): TradeLogRecord[] {
    const rows = (
      modeFilter === 'ALL'
        ? this.db.prepare('SELECT * FROM trades ORDER BY created_at DESC LIMIT ?').all(limit)
        : this.db
            .prepare('SELECT * FROM trades WHERE mode = ? ORDER BY created_at DESC LIMIT ?')
            .all(modeFilter, limit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      positionId: Number(r.position_id),
      mint: String(r.mint),
      symbol: String(r.symbol),
      mode: String(r.mode) as TradingMode,
      side: String(r.side) as 'BUY' | 'SELL',
      dexRoute: String(r.dex_route),
      solAmount: Number(r.sol_amount),
      tokenAmount: Number(r.token_amount),
      priceSol: Number(r.price_sol),
      feeSol: Number(r.fee_sol),
      pnlSol: Number(r.pnl_sol),
      signature: String(r.signature),
      reason: String(r.reason),
      reconciled: Boolean(r.reconciled),
      slippageDiffPct: Number(r.slippage_diff_pct ?? 0),
      latencyMs: Number(r.latency_ms ?? 0),
      createdAt: Number(r.created_at),
    }));
  }

  public getPnlSummary(
    modeFilter: TradingMode | 'ALL' = 'ALL',
    currentLiveBalanceSol?: number,
  ): PnlSummary {
    const closedRows = (
      modeFilter === 'ALL'
        ? this.db
            .prepare("SELECT * FROM positions WHERE status = 'CLOSED' ORDER BY closed_at ASC")
            .all()
        : this.db
            .prepare(
              "SELECT * FROM positions WHERE status = 'CLOSED' AND mode = ? ORDER BY closed_at ASC",
            )
            .all(modeFilter)
    ) as Array<Record<string, unknown>>;

    const tradeStatsRow = (
      modeFilter === 'ALL'
        ? this.db
            .prepare(
              'SELECT COUNT(*) as cnt, COALESCE(SUM(fee_sol), 0) as fees, COALESCE(AVG(ABS(slippage_diff_pct)), 0) as avg_slip FROM trades',
            )
            .get()
        : this.db
            .prepare(
              'SELECT COUNT(*) as cnt, COALESCE(SUM(fee_sol), 0) as fees, COALESCE(AVG(ABS(slippage_diff_pct)), 0) as avg_slip FROM trades WHERE mode = ?',
            )
            .get(modeFilter)
    ) as { cnt: number; fees: number; avg_slip: number };

    let winningPositions = 0;
    let losingPositions = 0;
    let grossProfitSol = 0;
    let grossLossSol = 0;
    let totalNetPnlSol = 0;

    const closedPositionsList = closedRows.map((r) => this.mapPosition(r));
    for (const pos of closedPositionsList) {
      totalNetPnlSol += pos.realizedSol - pos.initialSolSpent;
    }

    const startingBalanceSol =
      modeFilter === 'LIVE' && currentLiveBalanceSol !== undefined
        ? Math.max(
            0.01,
            Number(
              (currentLiveBalanceSol + this.getOpenExposureSol('LIVE') - totalNetPnlSol).toFixed(4),
            ),
          )
        : this.getPaperBalance().initialBalanceSol;

    let cumulative = 0;
    let runningBalance = startingBalanceSol;
    let peakBalanceSol = startingBalanceSol;
    let maxDrawdownSol = 0;

    const equityCurve: PnlSummary['equityCurve'] = [
      {
        timestamp: closedPositionsList[0]?.openedAt ?? Date.now(),
        cumulativePnlSol: 0,
        balanceSol: Number(startingBalanceSol.toFixed(6)),
        symbol: 'START',
      },
    ];

    for (const pos of closedPositionsList) {
      const netPnl = pos.realizedSol - pos.initialSolSpent;
      if (netPnl >= 0) {
        winningPositions++;
        grossProfitSol += netPnl;
      } else {
        losingPositions++;
        grossLossSol += Math.abs(netPnl);
      }

      cumulative += netPnl;
      runningBalance = Math.max(0, runningBalance + netPnl);
      if (runningBalance > peakBalanceSol) {
        peakBalanceSol = runningBalance;
      }
      const dd = peakBalanceSol - runningBalance;
      if (dd > maxDrawdownSol) {
        maxDrawdownSol = dd;
      }

      equityCurve.push({
        timestamp: pos.closedAt ?? pos.openedAt,
        cumulativePnlSol: Number(cumulative.toFixed(6)),
        balanceSol: Number(runningBalance.toFixed(6)),
        symbol: pos.symbol,
      });
    }

    const closedPositions = closedRows.length;
    const winRatePct =
      closedPositions > 0 ? Number(((winningPositions / closedPositions) * 100).toFixed(2)) : 0;
    const profitFactor =
      grossLossSol > 0
        ? Number((grossProfitSol / grossLossSol).toFixed(2))
        : grossProfitSol > 0
          ? 99.99
          : 0;
    const expectancySol =
      closedPositions > 0 ? Number((cumulative / closedPositions).toFixed(4)) : 0;
    const maxDrawdownPct =
      peakBalanceSol > 0 ? Number(((maxDrawdownSol / peakBalanceSol) * 100).toFixed(2)) : 0;
    const currentBalanceSol = Number(runningBalance.toFixed(4));
    const netReturnPct =
      startingBalanceSol > 0 ? Number(((cumulative / startingBalanceSol) * 100).toFixed(2)) : 0;

    return {
      mode: modeFilter,
      totalTrades: tradeStatsRow.cnt,
      closedPositions,
      winningPositions,
      losingPositions,
      winRatePct,
      profitFactor,
      expectancySol,
      maxDrawdownSol: Number(maxDrawdownSol.toFixed(4)),
      maxDrawdownPct,
      startingBalanceSol: Number(startingBalanceSol.toFixed(4)),
      currentBalanceSol,
      peakBalanceSol: Number(peakBalanceSol.toFixed(4)),
      netReturnPct,
      totalNetPnlSol: Number(cumulative.toFixed(4)),
      totalFeesSol: Number((tradeStatsRow.fees ?? 0).toFixed(4)),
      avgSlippageDiffPct: Number((tradeStatsRow.avg_slip ?? 0).toFixed(2)),
      grossProfitSol: Number(grossProfitSol.toFixed(4)),
      grossLossSol: Number(grossLossSol.toFixed(4)),
      equityCurve,
    };
  }

  private mapTokenSnapshot(row: Record<string, unknown>): TokenSnapshotRecord {
    return {
      id: Number(row.id),
      mint: String(row.mint),
      symbol: String(row.symbol),
      dex: String(row.dex) as DexSource,
      poolAddress: row.pool_address ? String(row.pool_address) : undefined,
      creatorAddress: row.creator_address ? String(row.creator_address) : undefined,
      marketRegime: String(row.market_regime) as MarketRegimeType,
      entryStrategy: row.entry_strategy
        ? (String(row.entry_strategy) as EntryStrategyId)
        : undefined,
      actionTaken: String(row.action_taken) as 'BOUGHT' | 'REJECTED',
      rejectionStage: row.rejection_stage ? String(row.rejection_stage) : undefined,
      rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
      securityScore: Number(row.security_score ?? 0),
      aiQualityScore: Number(row.ai_quality_score ?? 0),
      pumpProbability: Number(row.pump_probability ?? 0),
      rugProbability: Number(row.rug_probability ?? 0),
      smartMoneyScore: Number(row.smart_money_score ?? 0),
      socialScore: Number(row.social_score ?? 0),
      orderflowImbalance: Number(row.orderflow_imbalance ?? 0),
      cvdSol: Number(row.cvd_sol ?? 0),
      liquidityUsd: Number(row.liquidity_usd ?? 0),
      priceSolAtDiscovery: Number(row.price_sol_at_discovery ?? 0),
      price1mSol: row.price_1m_sol !== null ? Number(row.price_1m_sol) : null,
      price5mSol: row.price_5m_sol !== null ? Number(row.price_5m_sol) : null,
      price15mSol: row.price_15m_sol !== null ? Number(row.price_15m_sol) : null,
      price1hSol: row.price_1h_sol !== null ? Number(row.price_1h_sol) : null,
      price24hSol: row.price_24h_sol !== null ? Number(row.price_24h_sol) : null,
      realizedPnlPct: row.realized_pnl_pct !== null ? Number(row.realized_pnl_pct) : null,
      createdAt: Number(row.created_at),
    };
  }

  private mapSmartWallet(row: Record<string, unknown>): SmartWalletProfile {
    return {
      wallet: String(row.wallet),
      tier: String(row.tier) as SmartWalletProfile['tier'],
      totalTrades: Number(row.total_trades ?? 0),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      winRatePct: Number(row.win_rate_pct ?? 50),
      profitFactor: Number(row.profit_factor ?? 1),
      realizedPnlSol: Number(row.realized_pnl_sol ?? 0),
      avgRoiPct: Number(row.avg_roi_pct ?? 0),
      reputationScore: Number(row.reputation_score ?? 50),
      clusterId: row.cluster_id ? String(row.cluster_id) : null,
      isInsider: Boolean(row.is_insider),
      isWhale: Boolean(row.is_whale),
      lastActiveAt: Number(row.last_active_at ?? 0),
    };
  }

  private mapAiModel(row: Record<string, unknown>): AiModelVersionRecord {
    return {
      version: String(row.version),
      createdAt: Number(row.created_at),
      sampleSize: Number(row.sample_size),
      inSampleAccuracyPct: Number(row.in_sample_accuracy_pct),
      oosAccuracyPct: Number(row.oos_accuracy_pct),
      brierScore: Number(row.brier_score),
      status: String(row.status) as AiModelVersionRecord['status'],
      weightsJson: String(row.weights_json),
      featureImportanceJson: String(row.feature_importance_json),
      notes: String(row.notes),
    };
  }

  private mapPosition(row: Record<string, unknown>): PositionRecord {
    return {
      id: Number(row.id),
      mint: String(row.mint),
      symbol: String(row.symbol),
      dex: String(row.dex) as DexSource,
      poolAddress:
        row.pool_address !== null && row.pool_address !== undefined
          ? String(row.pool_address)
          : undefined,
      creatorAddress:
        row.creator_address !== null && row.creator_address !== undefined
          ? String(row.creator_address)
          : undefined,
      mode: String(row.mode) as TradingMode,
      status: String(row.status) as 'OPEN' | 'CLOSED',
      entryStrategy: row.entry_strategy
        ? (String(row.entry_strategy) as EntryStrategyId)
        : undefined,
      marketRegime: row.market_regime
        ? (String(row.market_regime) as MarketRegimeType)
        : undefined,
      aiScoreAtEntry: Number(row.ai_score_at_entry ?? 0),
      entryPriceSol: Number(row.entry_price_sol),
      highestPriceSol: Number(row.highest_price_sol),
      currentPriceSol: Number(row.current_price_sol),
      entryLiquidityUsd: Number(row.entry_liquidity_usd ?? 0),
      initialSolSpent: Number(row.initial_sol_spent),
      remainingSolCostBasis: Number(row.remaining_sol_cost_basis),
      initialTokenAmount: Number(row.initial_token_amount),
      remainingTokenAmount: Number(row.remaining_token_amount),
      realizedSol: Number(row.realized_sol),
      tp1Hit: Boolean(row.tp1_hit),
      tp1TrailingArmed: Boolean(row.tp1_trailing_armed),
      tp1PeakPriceSol:
        row.tp1_peak_price_sol !== null && row.tp1_peak_price_sol !== undefined
          ? Number(row.tp1_peak_price_sol)
          : null,
      tp2Hit: Boolean(row.tp2_hit),
      tp2TrailingArmed: Boolean(row.tp2_trailing_armed),
      tp2PeakPriceSol:
        row.tp2_peak_price_sol !== null && row.tp2_peak_price_sol !== undefined
          ? Number(row.tp2_peak_price_sol)
          : null,
      breakevenArmed: Boolean(row.breakeven_armed),
      trailingActive: Boolean(row.trailing_active),
      trailingStopPriceSol:
        row.trailing_stop_price_sol !== null ? Number(row.trailing_stop_price_sol) : null,
      openedAt: Number(row.opened_at),
      closedAt: row.closed_at !== null ? Number(row.closed_at) : null,
      closeReason: row.close_reason !== null ? String(row.close_reason) : null,
      buyChatId:
        row.buy_chat_id !== null && row.buy_chat_id !== undefined ? Number(row.buy_chat_id) : null,
      buyMessageId:
        row.buy_message_id !== null && row.buy_message_id !== undefined
          ? Number(row.buy_message_id)
          : null,
    };
  }

  public close(): void {
    this.db.close();
  }
}
