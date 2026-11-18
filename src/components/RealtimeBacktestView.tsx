import { useMemo } from 'react';
import { Activity, Pause, Play, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import {
  applyStrategyPreset,
  MarketRegimeType,
  StrategyConfig,
  StrategyPresetId,
} from '../lib/quantEngine';
import type { RealtimeBacktestState } from '../lib/realtimeBacktest';

interface RealtimeBacktestViewProps {
  state: RealtimeBacktestState;
  config: StrategyConfig;
  regime: MarketRegimeType;
  scanningAllowed: boolean;
  useCompactPayload: boolean;
  pollIntervalMs: number;
  busyTick: boolean;
  onToggleRunning: () => void;
  onStepLiveTick: () => Promise<void>;
  onResetBacktest: () => void;
  onApplyPreset: (preset: StrategyPresetId, nextConfig: StrategyConfig) => void;
  onChangeRegime: (regime: MarketRegimeType) => void;
  onToggleAutoDelete: () => void;
}

export function RealtimeBacktestView({
  state,
  config,
  regime,
  scanningAllowed,
  useCompactPayload,
  pollIntervalMs,
  busyTick,
  onToggleRunning,
  onStepLiveTick,
  onResetBacktest,
  onApplyPreset,
  onChangeRegime,
  onToggleAutoDelete,
}: RealtimeBacktestViewProps) {
  const totalClosed = state.wins + state.losses;
  const winRatePct = totalClosed > 0 ? Math.round((state.wins / totalClosed) * 100) : 0;

  const currentEquitySol = useMemo(() => {
    const openVal = state.openPositions.reduce((acc, p) => {
      const mult = p.currentPriceSol / Math.max(1e-12, p.entryPriceSol);
      return acc + p.positionSizeSol * p.remainingShare * mult + p.realizedSol;
    }, 0);
    return Number((state.cashBalanceSol + openVal).toFixed(4));
  }, [state.cashBalanceSol, state.openPositions]);

  const profitFactor = useMemo(() => {
    let gp = 0;
    let gl = 0;
    for (const t of state.closedTrades) {
      if (t.netPnlSol >= 0) gp += t.netPnlSol;
      else gl += Math.abs(t.netPnlSol);
    }
    if (gl === 0) return gp > 0 ? 99.9 : 0;
    return Number((gp / gl).toFixed(2));
  }, [state.closedTrades]);

  const chartGeom = useMemo(() => {
    const pts = state.equityCurve;
    const width = 680;
    const height = 160;
    const padX = 18;
    const padY = 16;
    const vals = pts.map((p) => p.equitySol);
    const minV = Math.min(...vals, state.initialBalanceSol * 0.99);
    const maxV = Math.max(...vals, state.initialBalanceSol * 1.01);
    const span = Math.max(0.02, maxV - minV);

    const coords = pts.map((p, idx) => {
      const x =
        pts.length <= 1
          ? width / 2
          : padX + (idx / (pts.length - 1)) * (width - padX * 2);
      const y = height - padY - ((p.equitySol - minV) / span) * (height - padY * 2);
      return { x, y, ...p };
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath =
      coords.length > 0
        ? `${linePath} L ${coords[coords.length - 1].x} ${height - padY} L ${coords[0].x} ${
            height - padY
          } Z`
        : '';
    return { width, height, coords, linePath, areaPath };
  }, [state.equityCurve, state.initialBalanceSol]);

  return (
    <div className="space-y-5">
      {/* Control Header */}
      <section className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-white/10 pb-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#00FFA3]" />
              Backtest Thời Gian Thực (Live Stream)
            </h2>
            <p className="text-xs text-slate-400">
              Nguồn: <strong className="font-mono text-slate-200">{state.lastFeedSource}</strong> · Tick #{state.tickCount} ·{' '}
              {scanningAllowed
                ? `Chu kỳ ${Math.round(pollIntervalMs / 1000)}s${useCompactPayload ? ' (4G Compact)' : ''}`
                : 'Tạm khóa bởi Wi-Fi Only'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!scanningAllowed}
              onClick={onToggleRunning}
              className={`min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50 transition-all ${
                state.running
                  ? 'bg-[#F59E0B] text-slate-950 hover:brightness-110'
                  : 'bg-[#00FFA3] text-slate-950 hover:brightness-110 shadow-[0_0_20px_-5px_rgba(0,255,163,0.45)]'
              }`}
            >
              {state.running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {state.running ? 'Tạm dừng Stream' : 'Chạy Backtest Live'}
            </button>

            <button
              type="button"
              disabled={!scanningAllowed || busyTick}
              onClick={() => void onStepLiveTick()}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/10 bg-slate-950/60 text-xs font-semibold text-slate-200 hover:bg-white/10 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <SkipForward className="w-3.5 h-3.5 text-[#00FFA3]" />
              {busyTick ? 'Đang lấy...' : '1 Tick Ngay'}
            </button>

            <button
              type="button"
              onClick={onResetBacktest}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/10 bg-slate-950/60 text-xs font-semibold text-slate-200 hover:bg-white/10 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset PnL/DD
            </button>
          </div>
        </div>

        {/* Presets & Regime & Auto-Delete Alert Toggle */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'SMALL_CAP_HIGH_PF', label: 'Vốn nhỏ High-PF' },
                { id: 'MAX_THROUGHPUT', label: 'Max Khớp' },
                { id: 'BALANCED', label: 'Cân Bằng' },
                { id: 'STRICT_SAFE', label: 'An Toàn' },
              ] as const
            ).map((p) => {
              const isSmallCap = p.id === 'SMALL_CAP_HIGH_PF';
              const active =
                (isSmallCap && config.smallCapEdgeMode) ||
                (!config.smallCapEdgeMode &&
                  p.id === 'BALANCED' &&
                  config.minLiquidityUsd === 15000) ||
                (p.id === 'MAX_THROUGHPUT' && config.minLiquidityUsd === 4000) ||
                (p.id === 'STRICT_SAFE' && config.minLiquidityUsd === 25000);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onApplyPreset(p.id, applyStrategyPreset(config, p.id))}
                  className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#00FFA3]/15 border-[#00FFA3]/40 text-[#00FFA3]'
                      : 'border-white/10 bg-slate-950/50 text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}

            <button
              type="button"
              onClick={onToggleAutoDelete}
              className={`min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                config.autoDeleteEntryMsgEnabled
                  ? 'bg-emerald-500/15 border-emerald-400/30 text-[#00FFA3]'
                  : 'bg-slate-950/50 border-white/10 text-slate-400'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa tin đặt lệnh khi TP/SL: {config.autoDeleteEntryMsgEnabled ? 'BẬT' : 'TẮT'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['BULLISH', 'SIDEWAYS', 'HIGH_VOLATILITY', 'BEARISH'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onChangeRegime(r)}
                className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold border cursor-pointer transition-colors ${
                  regime === r
                    ? 'bg-violet-500/20 text-violet-200 border-violet-400/40'
                    : 'bg-slate-950/50 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="glass-panel rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Live Equity</div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {currentEquitySol.toFixed(4)} SOL
          </div>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Realized Net PnL</div>
          <div
            className={`text-lg font-mono font-bold tabular-nums ${
              state.totalNetPnlSol >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
            }`}
          >
            {state.totalNetPnlSol >= 0 ? '+' : ''}
            {state.totalNetPnlSol.toFixed(4)} SOL
          </div>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Win Rate (W/L)</div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {winRatePct}% ({state.wins}/{state.losses})
          </div>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Profit Factor</div>
          <div className="text-lg font-mono font-bold text-[#00FFA3] tabular-nums">
            {profitFactor}
          </div>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Max Drawdown</div>
          <div className="text-base font-mono font-bold text-[#FF3B6B] tabular-nums">
            -{state.maxDrawdownPct}% (-{state.maxDrawdownSol} SOL)
          </div>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Đã lọc / Bỏ qua</div>
          <div className="text-base font-mono font-bold text-slate-200 tabular-nums">
            {state.evaluatedCount} / {state.rejectedCount}
          </div>
        </div>
      </div>

      {/* Equity Curve + Active Entry Order Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-8 glass-panel rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">Biểu đồ Tăng trưởng Equity Live</h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              Peak: <strong className="text-[#00FFA3]">{state.peakEquitySol.toFixed(4)} SOL</strong>
            </span>
          </div>

          <div className="w-full overflow-hidden rounded-xl bg-slate-950/70 border border-white/10 p-2">
            <svg
              viewBox={`0 0 ${chartGeom.width} ${chartGeom.height}`}
              className="w-full h-40"
              role="img"
              aria-label="Live Equity Curve"
            >
              {chartGeom.areaPath ? (
                <path d={chartGeom.areaPath} fill="#00FFA3" fillOpacity="0.14" />
              ) : null}
              {chartGeom.linePath ? (
                <path
                  d={chartGeom.linePath}
                  fill="none"
                  stroke="#00FFA3"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              ) : null}
              {chartGeom.coords.map((pt) => (
                <circle
                  key={pt.tick}
                  cx={pt.x}
                  cy={pt.y}
                  r={3.5}
                  fill="#00FFA3"
                />
              ))}
            </svg>
          </div>
        </section>

        <section className="lg:col-span-4 glass-panel rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">Thông báo Đặt Lệnh ({state.entryOrderAlerts.length})</h3>
            <span className="text-[11px] text-slate-400">Tự xóa khi dính TP/SL</span>
          </div>

          {state.entryOrderAlerts.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Chưa có thông báo đặt lệnh đang mở (hoặc đã tự động xóa sau khi dính TP/SL).
            </p>
          ) : (
            <ul className="space-y-2 max-h-44 overflow-y-auto">
              {state.entryOrderAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className="p-2.5 rounded-xl bg-slate-950/60 border border-white/10 text-xs font-mono text-slate-200 tabular-nums"
                >
                  {alert.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Open Simulated Positions & Closed Trades */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-6 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Vị thế đang chạy ({state.openPositions.length})
            </h3>
            <span className="text-xs font-mono text-slate-400">Mark-to-Market</span>
          </div>

          {state.openPositions.length === 0 ? (
            <div className="p-6 text-xs text-slate-400 text-center">
              Bấm &quot;Chạy Backtest Live&quot; hoặc &quot;1 Tick Ngay&quot; để quét và khớp kèo đạt chuẩn AI/Anti-Rug.
            </div>
          ) : (
            <ul className="divide-y divide-white/10">
              {state.openPositions.map((pos) => {
                const mult = pos.currentPriceSol / Math.max(1e-12, pos.entryPriceSol);
                const pnlPct = (mult - 1) * 100;
                return (
                  <li key={pos.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-white/5">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">
                        {pos.symbol}{' '}
                        <span className="font-mono text-[11px] font-normal text-slate-400">
                          {pos.strategy}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400 tabular-nums">
                        Size {pos.positionSizeSol} SOL · Còn {Math.round(pos.remainingShare * 100)}%
                        {pos.tp1Hit ? ' · TP1' : ''}
                        {pos.breakevenArmed ? ' · BE' : ''}
                      </div>
                    </div>
                    <div
                      className={`text-sm font-mono font-bold tabular-nums ${
                        pnlPct >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                      }`}
                    >
                      {pnlPct >= 0 ? '+' : ''}
                      {pnlPct.toFixed(2)}%
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lg:col-span-6 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Lịch sử Đóng Lệnh ({state.closedTrades.length})
            </h3>
            <span className="text-xs font-mono text-slate-400">Net After Fees</span>
          </div>

          {state.closedTrades.length === 0 ? (
            <div className="p-6 text-xs text-slate-400 text-center">
              Chưa có lệnh nào đóng trong phiên backtest hiện tại.
            </div>
          ) : (
            <ul className="divide-y divide-white/10 max-h-72 overflow-y-auto">
              {state.closedTrades.map((tr) => (
                <li key={tr.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-white/5">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">
                      {tr.symbol}{' '}
                      <span className="font-mono text-[11px] font-medium text-slate-400">
                        [{tr.closeReason}]
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-400 tabular-nums">
                      {tr.strategy} · Size {tr.positionSizeSol} SOL
                    </div>
                  </div>
                  <div
                    className={`text-right font-mono text-xs font-bold tabular-nums ${
                      tr.netPnlSol >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                    }`}
                  >
                    <div>
                      {tr.netPnlSol >= 0 ? '+' : ''}
                      {tr.netPnlSol} SOL
                    </div>
                    <div>
                      {tr.netPnlPct >= 0 ? '+' : ''}
                      {tr.netPnlPct}%
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
