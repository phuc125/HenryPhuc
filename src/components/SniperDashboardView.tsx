import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Flame,
  Radar,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import {
  ActiveSnipePosition,
  ChainNetworkId,
  computePositionMetrics,
  isPositionAdjusting,
  MempoolPairItem,
  PendingSnipeOrder,
  ScannedContractInfo,
  scanContractInfo,
  shortenAddress,
  SnipeMode,
  SnipeOrderSettings,
  TerminalLogEntry,
} from '../lib/sniperTerminal';
import { PositionSparkline } from './PositionSparkline';

interface SniperDashboardViewProps {
  network: ChainNetworkId;
  activeBalanceSol: number;
  tradingMode: 'PAPER' | 'LIVE';
  feedSource: string;
  loadingFeed: boolean;
  scanningAllowed: boolean;
  autoScanEnabled: boolean;
  mempoolPairs: MempoolPairItem[];
  activePositions: ActiveSnipePosition[];
  pendingOrders: PendingSnipeOrder[];
  logs: TerminalLogEntry[];
  settings: SnipeOrderSettings;
  onChangeSettings: (next: SnipeOrderSettings) => void;
  onExecuteSnipe: (target: ScannedContractInfo, settings: SnipeOrderSettings) => void;
  onQuickSnipePair: (pair: MempoolPairItem) => void;
  onSellPosition: (positionId: string, fraction: number) => void;
  onCancelPendingOrder: (orderId: string) => void;
  onToggleAutoScan: () => void;
  onManualScan: () => Promise<void>;
  onActivateSmallCapHighPf: () => void;
}

const QUICK_AMOUNTS = [0.1, 0.5, 1, 5];

export function SniperDashboardView({
  network,
  activeBalanceSol,
  tradingMode,
  feedSource,
  loadingFeed,
  scanningAllowed,
  autoScanEnabled,
  mempoolPairs,
  activePositions,
  pendingOrders,
  logs,
  settings,
  onChangeSettings,
  onExecuteSnipe,
  onQuickSnipePair,
  onSellPosition,
  onCancelPendingOrder,
  onToggleAutoScan,
  onManualScan,
  onActivateSmallCapHighPf,
}: SniperDashboardViewProps) {
  const [contractInput, setContractInput] = useState<string>(
    mempoolPairs[0]?.mint ?? '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  );
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState<boolean>(true);

  const scannedInfo = useMemo(
    () => scanContractInfo(contractInput, mempoolPairs),
    [contractInput, mempoolPairs],
  );

  const handleQuickPaste = async () => {
    try {
      const clip = await navigator.clipboard?.readText();
      if (clip && clip.trim().length >= 16) {
        setContractInput(clip.trim());
        setPasteHint('Đã dán CA từ Clipboard');
        setTimeout(() => setPasteHint(null), 1800);
        return;
      }
    } catch {
      // Clipboard blocked in non-HTTPS or headless iframe; rotate sample CA cleanly
    }
    const idx = mempoolPairs.findIndex((p) => p.mint === contractInput.trim());
    const nextPair = mempoolPairs[(idx + 1) % Math.max(1, mempoolPairs.length)];
    if (nextPair) {
      setContractInput(nextPair.mint);
      setPasteHint(`Đã chọn ${nextPair.symbol}`);
      setTimeout(() => setPasteHint(null), 1800);
    }
  };

  const nativeUnit = network === 'SOL' ? 'SOL' : 'ETH';

  const handleSubmitSnipe = () => {
    if (!scannedInfo) return;
    onExecuteSnipe(scannedInfo, settings);
  };

  return (
    <div className="space-y-4">
      {/* Main 40% / 60% Responsive Sniper Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4 items-start">
        {/* LEFT COLUMN (40%) — Snipe Control & Quick Config */}
        <section
          aria-label="Bảng điều khiển Snipe & Cấu hình nhanh"
          className="bg-slate-900/45 backdrop-blur-xl border border-white/10 rounded-xl p-4 sm:p-5 space-y-4 shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#00FFA3]" />
                Sniper Execution Console
              </h2>
              <p className="text-[11px] text-slate-400">
                {tradingMode} · Khả dụng:{' '}
                <span className="font-mono tabular-nums text-[#00FFA3] font-semibold">
                  {activeBalanceSol.toFixed(4)} {nativeUnit}
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={onActivateSmallCapHighPf}
              className={`min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                settings.smallCapHighPf
                  ? 'bg-[#10B981]/20 border-[#00FFA3]/50 text-[#00FFA3] shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-slate-800/60 border-white/10 text-slate-300 hover:border-white/25'
              }`}
              title="Áp dụng bộ lọc & chốt lời tối ưu Profit Factor cho vốn nhỏ"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Vốn nhỏ High-PF</span>
            </button>
          </div>

          {/* Contract Address Input + Paste + Auto Scan Card */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sniper-ca-input" className="font-medium text-slate-300">
                Contract Address (CA)
              </label>
              {pasteHint ? (
                <span className="text-[11px] font-mono text-[#00FFA3]">{pasteHint}</span>
              ) : (
                <span className="text-[11px] text-slate-400">Tự động quét bảo mật</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="sniper-ca-input"
                type="text"
                value={contractInput}
                onChange={(e) => setContractInput(e.target.value)}
                placeholder="Dán địa chỉ CA token Solana / EVM..."
                className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl bg-slate-950/70 border border-white/10 text-xs font-mono tabular-nums text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#00FFA3]/60"
              />
              <button
                type="button"
                onClick={() => void handleQuickPaste()}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-[#00FFA3]" />
                <span>Dán nhanh</span>
              </button>
            </div>

            {/* Auto-Scanned Token Audit Box */}
            {scannedInfo ? (
              <div className="rounded-xl bg-slate-950/55 border border-white/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">
                        {scannedInfo.symbol}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        {scannedInfo.name} · {scannedInfo.dexLabel}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400">
                      ${scannedInfo.priceUsd.toFixed(5)} · MC $
                      {Math.round(scannedInfo.marketCapUsd / 1000).toLocaleString()}k · Liq $
                      {Math.round(scannedInfo.liquidityUsd / 1000).toLocaleString()}k
                    </div>
                  </div>
                  <div
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums font-bold shrink-0 border ${
                      scannedInfo.riskTag === 'LOW_RISK'
                        ? 'bg-[#00FFA3]/15 border-[#00FFA3]/40 text-[#00FFA3]'
                        : scannedInfo.riskTag === 'MODERATE'
                          ? 'bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#F59E0B]'
                          : 'bg-[#FF3B6B]/15 border-[#FF3B6B]/40 text-[#FF3B6B]'
                    }`}
                  >
                    AI {scannedInfo.aiScore}/100
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums">
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      scannedInfo.mintDisabled
                        ? 'bg-[#00FFA3]/10 border-[#00FFA3]/30 text-[#00FFA3]'
                        : 'bg-[#FF3B6B]/10 border-[#FF3B6B]/30 text-[#FF3B6B]'
                    }`}
                  >
                    {scannedInfo.mintDisabled ? 'Mint Disabled' : 'Mint Active'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      scannedInfo.lpBurned
                        ? 'bg-[#00FFA3]/10 border-[#00FFA3]/30 text-[#00FFA3]'
                        : 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]'
                    }`}
                  >
                    LP {scannedInfo.lpBurned ? `Burned ${scannedInfo.lpBurnedPct}%` : `${scannedInfo.lpBurnedPct}%`}
                  </span>
                  <span className="px-2 py-0.5 rounded-full border bg-white/5 border-white/10 text-slate-300">
                    Top 10: {scannedInfo.top10HoldersPct}%
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-950/40 border border-white/10 p-3 text-xs text-slate-400">
                Nhập địa chỉ Contract hợp lệ (tối thiểu 16 ký tự) để tự động kiểm tra LP &amp; Top 10 Holders.
              </div>
            )}
          </div>

          {/* Mode Tabs: Instant Snipe | Auto Snipe | Limit Order */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/70 border border-white/10">
            {(
              [
                { id: 'INSTANT', label: 'Instant Snipe' },
                { id: 'AUTO_LIQ', label: 'Auto Snipe' },
                { id: 'LIMIT', label: 'Limit Order' },
              ] as Array<{ id: SnipeMode; label: string }>
            ).map((tab) => {
              const active = settings.mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChangeSettings({ ...settings, mode: tab.id })}
                  className={`min-h-[38px] px-2 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-r from-[#10B981]/30 to-[#8B5CF6]/30 text-white border border-white/15 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {settings.mode === 'LIMIT' ? (
            <div className="rounded-xl bg-slate-950/60 border border-[#F59E0B]/30 p-3 flex items-center justify-between gap-3">
              <span className="text-xs text-[#F59E0B] font-medium">
                Trigger Price Dip (%)
              </span>
              <input
                type="number"
                step="1"
                value={settings.limitTriggerChangePct}
                onChange={(e) =>
                  onChangeSettings({
                    ...settings,
                    limitTriggerChangePct: Number(e.target.value) || -8,
                  })
                }
                aria-label="Trigger Price Dip (%)"
                className="w-24 min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-900 border border-white/15 text-right font-mono tabular-nums text-xs text-white"
              />
            </div>
          ) : null}

          {/* Buy Amount Presets + Custom Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Số lượng mua ({nativeUnit})</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-400">
                Fee est: {(settings.priorityFeeSol * 2).toFixed(5)} {nativeUnit}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((amt) => {
                const selected = settings.amountSol === amt;
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => onChangeSettings({ ...settings, amountSol: amt })}
                    className={`min-h-[40px] rounded-xl font-mono tabular-nums text-xs font-bold border transition-all cursor-pointer ${
                      selected
                        ? 'bg-[#00FFA3]/20 border-[#00FFA3] text-[#00FFA3] shadow-[0_0_12px_rgba(0,255,163,0.2)]'
                        : 'bg-slate-950/60 border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {amt} {nativeUnit}
                  </button>
                );
              })}
            </div>

            <input
              type="number"
              step="0.05"
              min="0.02"
              aria-label="Số tiền mua tùy chỉnh"
              value={settings.amountSol}
              onChange={(e) =>
                onChangeSettings({
                  ...settings,
                  amountSol: Math.max(0.02, Number(e.target.value) || 0.1),
                })
              }
              className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-slate-950/70 border border-white/10 font-mono tabular-nums text-sm font-semibold text-white focus:outline-none focus:border-[#00FFA3]/60"
            />
          </div>

          {/* Glassmorphic Advanced Settings */}
          <div className="rounded-xl bg-slate-950/55 border border-white/10 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Cài đặt nâng cao &amp; Anti-MEV
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.antiMev}
                onClick={() =>
                  onChangeSettings({ ...settings, antiMev: !settings.antiMev })
                }
                className={`min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border transition-colors cursor-pointer ${
                  settings.antiMev
                    ? 'bg-[#00FFA3]/15 border-[#00FFA3]/50 text-[#00FFA3]'
                    : 'bg-white/5 border-white/15 text-slate-400'
                }`}
              >
                Anti-MEV: {settings.antiMev ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="cfg-slippage-input"
                  className="block text-[11px] text-slate-400 mb-1"
                >
                  Slippage (%)
                </label>
                <input
                  id="cfg-slippage-input"
                  type="number"
                  step="0.5"
                  value={settings.slippagePct}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      slippagePct: Math.max(0.5, Number(e.target.value) || 5),
                    })
                  }
                  className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 font-mono tabular-nums text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-tip-input"
                  className="block text-[11px] text-slate-400 mb-1"
                >
                  Jito Tip ({nativeUnit})
                </label>
                <input
                  id="cfg-tip-input"
                  type="number"
                  step="0.0001"
                  value={settings.priorityFeeSol}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      priorityFeeSol: Math.max(0.00005, Number(e.target.value) || 0.00025),
                    })
                  }
                  className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 font-mono tabular-nums text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-tp-input"
                  className="block text-[11px] text-slate-400 mb-1"
                >
                  Auto TP (%)
                </label>
                <input
                  id="cfg-tp-input"
                  type="number"
                  step="5"
                  value={settings.takeProfitPct}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      takeProfitPct: Math.max(5, Number(e.target.value) || 30),
                    })
                  }
                  className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 font-mono tabular-nums text-xs text-[#00FFA3]"
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-sl-input"
                  className="block text-[11px] text-slate-400 mb-1"
                >
                  Auto SL (%)
                </label>
                <input
                  id="cfg-sl-input"
                  type="number"
                  step="1"
                  value={settings.stopLossPct}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      stopLossPct: Math.max(3, Number(e.target.value) || 12),
                    })
                  }
                  className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 font-mono tabular-nums text-xs text-[#FF3B6B]"
                />
              </div>
            </div>
          </div>

          {/* Primary Glowing Execute Button */}
          <button
            type="button"
            disabled={!scannedInfo}
            onClick={handleSubmitSnipe}
            className="w-full min-h-[50px] rounded-xl bg-gradient-to-r from-[#00FFA3] via-[#10B981] to-[#8B5CF6] text-slate-950 font-extrabold text-sm tracking-wide uppercase shadow-[0_0_26px_rgba(16,185,129,0.45)] hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-2"
          >
            <Flame className="w-4 h-4" />
            <span>EXECUTE SNIPE</span>
          </button>
        </section>

        {/* RIGHT COLUMN (60%) — Active Positions & New Pairs Mempool Scanner */}
        <div className="space-y-4 min-w-0">
          {/* Top: Active Positions */}
          <section
            aria-label="Vị thế đang nắm giữ"
            className="bg-slate-900/45 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
          >
            <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00FFA3] animate-pulse" />
                <h2 className="text-sm font-bold text-white">
                  Active Positions ({activePositions.length})
                </h2>
                {pendingOrders.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-[#F59E0B]/15 border border-[#F59E0B]/30 text-[#F59E0B] font-mono tabular-nums text-[11px] font-semibold">
                    {pendingOrders.length} Pending
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                1-Tap Sell 50% / 100% · Auto Rent Reclaim
              </span>
            </div>

            {activePositions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Chưa có vị thế đang mở. Chọn token ở bảng bên dưới hoặc dán CA để thực thi{' '}
                <strong className="text-[#00FFA3]">EXECUTE SNIPE</strong>.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {activePositions.map((pos) => {
                  const m = computePositionMetrics(pos);
                  const isWin = m.pnlPct >= 0;
                  const adjusting = isPositionAdjusting(pos);
                  const isSlippagePhase = pos.executionPhase === 'SLIPPAGE_CHECK';
                  const phaseLabel = isSlippagePhase ? 'Slippage Guard' : 'Fee Adjusting';
                  return (
                    <div
                      key={pos.id}
                      data-execution-phase={pos.executionPhase ?? 'CONFIRMED'}
                      className={`relative px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                        adjusting
                          ? `animate-order-adjust-pulse ${
                              isSlippagePhase
                                ? 'bg-[#F59E0B]/[0.06] ring-1 ring-inset ring-[#F59E0B]/30'
                                : 'bg-[#8B5CF6]/[0.07] ring-1 ring-inset ring-[#8B5CF6]/35'
                            }`
                          : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      {adjusting ? (
                        <>
                          <div
                            aria-hidden="true"
                            className={`pointer-events-none absolute inset-0 animate-order-adjust-overlay ${
                              isSlippagePhase
                                ? 'bg-gradient-to-r from-[#F59E0B]/[0.09] via-transparent to-[#F59E0B]/[0.04]'
                                : 'bg-gradient-to-r from-[#8B5CF6]/[0.11] via-transparent to-[#00FFA3]/[0.05]'
                            }`}
                          />
                          <div
                            aria-hidden="true"
                            className={`pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] animate-order-adjust-overlay ${
                              isSlippagePhase
                                ? 'bg-gradient-to-r from-transparent via-[#F59E0B]/80 to-transparent'
                                : 'bg-gradient-to-r from-transparent via-[#8B5CF6]/85 to-[#00FFA3]/60'
                            }`}
                          />
                        </>
                      ) : null}

                      <div className="relative min-w-0 space-y-1 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-white">{pos.symbol}</span>
                          <span className="font-mono tabular-nums text-[11px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                            {shortenAddress(pos.mint)}
                          </span>
                          <span className="text-[11px] text-slate-400">{pos.dexLabel}</span>
                          {pos.antiMev ? (
                            <span className="text-[10px] font-mono text-[#00FFA3] bg-[#00FFA3]/10 px-1.5 py-0.5 rounded">
                              Jito Shield
                            </span>
                          ) : null}
                          {adjusting ? (
                            <span
                              role="status"
                              className={`inline-flex items-center gap-1.5 text-[10px] font-mono tabular-nums font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${
                                isSlippagePhase
                                  ? 'bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#F59E0B]'
                                  : 'bg-[#8B5CF6]/20 border-[#8B5CF6]/45 text-purple-200'
                              }`}
                            >
                              <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0" />
                              <span>
                                {phaseLabel}
                                {pos.adjustmentReason ? ` · ${pos.adjustmentReason}` : ''}
                              </span>
                            </span>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums">
                          <div className="whitespace-nowrap">
                            <span className="text-slate-500">Entry: </span>
                            <span className="text-slate-200">${pos.entryPriceUsd.toFixed(5)}</span>
                          </div>
                          <div className="whitespace-nowrap">
                            <span className="text-slate-500">Now: </span>
                            <span className="text-white font-semibold">
                              ${pos.currentPriceUsd.toFixed(5)}
                            </span>
                          </div>
                          <div className="whitespace-nowrap">
                            <span className="text-slate-500">Size: </span>
                            <span className="text-slate-200">
                              {m.remainingSolBasis.toFixed(2)} {nativeUnit}
                            </span>
                          </div>
                          <div className={`whitespace-nowrap ${isWin ? 'text-[#00FFA3] font-bold' : 'text-[#FF3B6B] font-bold'}`}>
                            {isWin ? '+' : ''}
                            {m.pnlPct.toFixed(1)}% ({m.pnlSol >= 0 ? '+' : ''}
                            {m.pnlSol.toFixed(3)} {nativeUnit})
                          </div>
                        </div>

                        {/* TP / SL Visual Progress Bar */}
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="font-mono tabular-nums text-[10px] text-[#FF3B6B] w-10">
                            -{pos.slPct}%
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800/90 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isWin
                                  ? 'bg-gradient-to-r from-[#10B981] to-[#00FFA3]'
                                  : 'bg-[#FF3B6B]'
                              }`}
                              style={{ width: `${m.tpSlProgressPct}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-[10px] text-[#00FFA3] w-10 text-right">
                            +{pos.tpPct}%
                          </span>
                        </div>
                      </div>

                      {/* 10-Tick Momentum Sparkline + 1-Tap Partial / Full Sell Buttons */}
                      <div className="relative flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
                        <PositionSparkline position={pos} isWin={isWin} />
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => onSellPosition(pos.id, 0.5)}
                            className="flex-1 sm:flex-initial min-h-[38px] px-3 py-1.5 rounded-lg bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 border border-[#F59E0B]/40 text-[#F59E0B] text-xs font-mono font-bold whitespace-nowrap cursor-pointer transition-colors"
                          >
                            Sell 50%
                          </button>
                          <button
                            type="button"
                            onClick={() => onSellPosition(pos.id, 1.0)}
                            className="flex-1 sm:flex-initial min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FF3B6B]/20 hover:bg-[#FF3B6B]/30 border border-[#FF3B6B]/45 text-[#FF3B6B] text-xs font-mono font-bold whitespace-nowrap cursor-pointer transition-colors"
                          >
                            Sell 100%
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pendingOrders.length > 0 ? (
              <div className="px-4 py-2.5 bg-slate-950/60 border-t border-white/10 flex flex-wrap items-center gap-2">
                {pendingOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[11px] font-mono tabular-nums text-[#F59E0B]"
                  >
                    <span>
                      {ord.mode}: {ord.symbol} ({ord.amountSol} {nativeUnit})
                    </span>
                    <button
                      type="button"
                      onClick={() => onCancelPendingOrder(ord.id)}
                      className="text-slate-300 hover:text-white underline cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* Bottom: New Pairs / Mempool Scanner */}
          <section
            aria-label="Quét cặp token mới trên Mempool"
            className="bg-slate-900/45 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
          >
            <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-[#8B5CF6]" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    New Pairs / Mempool Scanner ({mempoolPairs.length})
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                    Stream: {feedSource} · Raydium / Pump.fun / Meteora
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!scanningAllowed}
                  onClick={onToggleAutoScan}
                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer disabled:opacity-40 ${
                    autoScanEnabled && scanningAllowed
                      ? 'bg-[#00FFA3]/15 border-[#00FFA3]/40 text-[#00FFA3]'
                      : 'bg-white/5 border-white/10 text-slate-300'
                  }`}
                >
                  Auto: {autoScanEnabled && scanningAllowed ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  disabled={!scanningAllowed || loadingFeed}
                  onClick={() => void onManualScan()}
                  className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-200 cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingFeed ? 'animate-spin' : ''}`} />
                  Quét
                </button>
              </div>
            </div>

            <div className="divide-y divide-white/10">
              {mempoolPairs.map((pair) => {
                const isSafe = pair.mintDisabled && pair.lpBurned && pair.honeypotPassed;
                return (
                  <div
                    key={pair.mint}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="min-w-0 space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">{pair.symbol}</span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-400">
                          {shortenAddress(pair.mint)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#8B5CF6]/20 border border-[#8B5CF6]/30 text-[10px] font-mono text-purple-200">
                          {pair.dexLabel}
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-400">
                          {pair.ageLabel}
                        </span>
                        <span
                          className={`font-mono tabular-nums text-[11px] font-bold ${
                            pair.change5mPct >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                          }`}
                        >
                          {pair.change5mPct >= 0 ? '+' : ''}
                          {pair.change5mPct}%
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums">
                        <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">
                          Liq ${Math.round(pair.liquidityUsd / 1000)}k
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                            pair.mintDisabled
                              ? 'bg-[#00FFA3]/10 border-[#00FFA3]/30 text-[#00FFA3]'
                              : 'bg-[#FF3B6B]/10 border-[#FF3B6B]/30 text-[#FF3B6B]'
                          }`}
                        >
                          {pair.mintDisabled ? (
                            <ShieldCheck className="w-3 h-3" />
                          ) : (
                            <ShieldAlert className="w-3 h-3" />
                          )}
                          {pair.mintDisabled ? 'Mint Disabled' : 'Mint Active'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full border ${
                            pair.lpBurned
                              ? 'bg-[#00FFA3]/10 border-[#00FFA3]/30 text-[#00FFA3]'
                              : 'bg-[#FF3B6B]/10 border-[#FF3B6B]/30 text-[#FF3B6B]'
                          }`}
                        >
                          {pair.lpBurned ? 'LP Burned' : 'LP Unlocked'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full border ${
                            pair.top10HoldersPct <= 25
                              ? 'bg-white/5 border-white/15 text-slate-200'
                              : 'bg-[#FF3B6B]/10 border-[#FF3B6B]/30 text-[#FF3B6B]'
                          }`}
                        >
                          Top 10 Holders: {pair.top10HoldersPct}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setContractInput(pair.mint)}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-slate-300 whitespace-nowrap cursor-pointer"
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        onClick={() => onQuickSnipePair(pair)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-all inline-flex items-center gap-1 ${
                          isSafe
                            ? 'bg-[#00FFA3]/20 hover:bg-[#00FFA3]/30 border border-[#00FFA3]/50 text-[#00FFA3]'
                            : 'bg-[#FF3B6B]/15 hover:bg-[#FF3B6B]/25 border border-[#FF3B6B]/40 text-[#FF3B6B]'
                        }`}
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Quick Snipe
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Bottom Collapsible Terminal Execution Logs */}
      <section
        aria-label="Nhật ký giao dịch trực tiếp của Bot"
        className="bg-slate-950/75 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      >
        <button
          type="button"
          onClick={() => setLogsExpanded((v) => !v)}
          className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-4 h-4 text-[#00FFA3] shrink-0" />
            <span className="text-xs font-bold text-slate-200 whitespace-nowrap">
              Terminal Logs ({logs.length})
            </span>
            {logs[0] ? (
              <span className="font-mono tabular-nums text-[11px] text-slate-400 truncate">
                [{logs[0].timeStr}] {logs[0].message}
              </span>
            ) : null}
          </div>
          <span className="text-slate-400 shrink-0">
            {logsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </span>
        </button>

        {logsExpanded ? (
          <div className="border-t border-white/10 max-h-44 overflow-y-auto px-4 py-2.5 space-y-1 font-mono tabular-nums text-xs">
            {logs.map((entry) => {
              const colorCls =
                entry.severity === 'SUCCESS'
                  ? 'text-[#00FFA3]'
                  : entry.severity === 'ERROR'
                    ? 'text-[#FF3B6B]'
                    : entry.severity === 'WARN'
                      ? 'text-[#F59E0B]'
                      : 'text-slate-300';
              return (
                <div key={entry.id} className="leading-relaxed">
                  <span className="text-slate-500">[{entry.timeStr}]</span>{' '}
                  <span className={colorCls}>{entry.message}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
