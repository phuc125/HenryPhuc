import http from 'http';
import { URL } from 'url';
import { RuntimeConfigManager, StrategyPresetId, ToggleableConfigKey } from '../config/runtimeConfig';
import { SniperDatabase } from '../analytics/database';
import { MarketRegimeDetector } from '../market/regimeDetector';
import { BacktestEngine } from '../backtesting/backtestEngine';
import { PerformanceAnalyticsEngine } from '../analytics/performance';
import { PositionManager } from '../strategy/positionManager';
import { WalletManager } from '../core/wallet';
import { PipelineStats } from '../core/types';

export interface AppAlertEvent {
  id: number;
  kind: 'BUY' | 'EXIT' | 'ALERT' | 'SYSTEM';
  mint?: string;
  symbol?: string;
  message: string;
  createdAt: number;
}

export class MobileAppApiServer {
  private server: http.Server | null = null;
  private events: AppAlertEvent[] = [];
  private nextEventId = 1;

  constructor(
    private readonly port: number,
    private readonly configManager: RuntimeConfigManager,
    private readonly wallet: WalletManager,
    private readonly db: SniperDatabase,
    private readonly positionManager: PositionManager,
    private readonly regimeDetector: MarketRegimeDetector,
    private readonly backtestEngine: BacktestEngine,
    private readonly perfAnalytics: PerformanceAnalyticsEngine,
    private readonly pipelineStats: PipelineStats,
  ) {}

  public pushEvent(
    kind: AppAlertEvent['kind'],
    message: string,
    meta?: { mint?: string; symbol?: string },
  ): number {
    const id = this.nextEventId++;
    this.events.unshift({
      id,
      kind,
      mint: meta?.mint,
      symbol: meta?.symbol,
      message,
      createdAt: Date.now(),
    });
    if (this.events.length > 80) {
      this.events.pop();
    }
    return id;
  }

  public removeEntryAlertById(eventId: number): boolean {
    const idx = this.events.findIndex((e) => e.id === eventId);
    if (idx === -1) return false;
    this.events.splice(idx, 1);
    return true;
  }

  private async readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  }

  private sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(body);
  }

  public start(): void {
    if (this.server) return;
    this.server = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        this.sendJson(res, 204, {});
        return;
      }

      const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
      const pathname = url.pathname;

      try {
        if (req.method === 'GET' && pathname === '/api/status') {
          const cfg = this.configManager.get();
          const paper = this.db.getPaperBalance();
          const openPositions = this.db.getOpenPositions(cfg.tradingMode);
          const regime = this.regimeDetector.getLastRegime();
          const compact = url.searchParams.get('compact') === '1';

          if (compact) {
            // Ultra-low-data 4G compact payload
            this.sendJson(res, 200, {
              m: cfg.tradingMode,
              a: cfg.autoSnipeEnabled ? 1 : 0,
              w: cfg.wifiOnlyMode ? 1 : 0,
              l4: cfg.lowData4gMode ? 1 : 0,
              bal: Number(paper.balanceSol.toFixed(4)),
              op: openPositions.length,
              buys: this.pipelineStats.executedBuys,
              pub: this.wallet.publicKey.toBase58(),
            });
            return;
          }

          this.sendJson(res, 200, {
            mode: cfg.tradingMode,
            walletAddress: this.wallet.publicKey.toBase58(),
            isEphemeralPaperWallet: this.wallet.isEphemeralPaperWallet,
            paperBalance: paper,
            openPositions,
            regime,
            pipelineStats: this.pipelineStats,
            config: cfg,
            events: this.events.slice(0, 20),
          });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/paper/reset') {
          const body = await this.readBody(req);
          const nextSol = Number(body.initialBalanceSol ?? 10);
          const safeSol = Number.isFinite(nextSol) && nextSol > 0 ? nextSol : 10;
          const resetResult = this.db.resetPaperAccount(safeSol);
          this.pushEvent('SYSTEM', `Paper Balance reset về ${safeSol} SOL`);
          this.sendJson(res, 200, { ok: true, resetResult });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/toggles') {
          const body = await this.readBody(req);
          const key = String(body.key ?? '') as ToggleableConfigKey;
          if (!key) {
            this.sendJson(res, 400, { error: 'key is required' });
            return;
          }
          const updated = this.configManager.toggle(key);
          this.sendJson(res, 200, { ok: true, config: updated });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/preset') {
          const body = await this.readBody(req);
          const preset = String(body.preset ?? 'BALANCED') as StrategyPresetId;
          const updated = this.configManager.applyPreset(preset);
          this.sendJson(res, 200, { ok: true, config: updated });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/network-policy') {
          const body = await this.readBody(req);
          const updated = this.configManager.update({
            wifiOnlyMode: typeof body.wifiOnlyMode === 'boolean' ? body.wifiOnlyMode : undefined,
            lowData4gMode: typeof body.lowData4gMode === 'boolean' ? body.lowData4gMode : undefined,
            networkInterfaceType:
              body.networkInterfaceType === 'WIFI' ||
              body.networkInterfaceType === 'CELLULAR_4G' ||
              body.networkInterfaceType === 'AUTO'
                ? body.networkInterfaceType
                : undefined,
          });
          this.sendJson(res, 200, { ok: true, config: updated });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/wallet/import') {
          const body = await this.readBody(req);
          const privateKey = typeof body.privateKey === 'string' ? body.privateKey.trim() : '';
          if (!privateKey) {
            this.sendJson(res, 400, { error: 'privateKey is required' });
            return;
          }
          const pubkey = this.wallet.importPrivateKey(privateKey);
          this.pushEvent('SYSTEM', `Đã nạp ví in-app mới: ${pubkey}`);
          this.sendJson(res, 200, { ok: true, publicKey: pubkey });
          return;
        }

        if (req.method === 'GET' && pathname === '/api/backtest/live') {
          const cfg = this.configManager.get();
          const report = this.backtestEngine.runBacktest(cfg, 60);
          const perf = this.perfAnalytics.computeSummary(cfg.tradingMode, 7);
          this.sendJson(res, 200, { ok: true, report, perf });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/positions/panic') {
          const cfg = this.configManager.get();
          const closedCount = await this.positionManager.panicSellAll(cfg.tradingMode);
          this.pushEvent('ALERT', `Panic Sell All hoàn tất (${closedCount} vị thế)`);
          this.sendJson(res, 200, { ok: true, closedCount });
          return;
        }

        this.sendJson(res, 404, { error: 'Not found' });
      } catch (err) {
        this.sendJson(res, 500, {
          error: err instanceof Error ? err.message : 'Internal API error',
        });
      }
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[MobileAppAPI] Listening on http://0.0.0.0:${this.port} (Telegram removed)`);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      this.server = null;
    });
  }
}
