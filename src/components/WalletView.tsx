import { useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  DEFAULT_SOLANA_RPC_URL,
  formatTransportErrorMessage,
  normalizeServerUrl,
  validateHttpEndpoint,
  type DataTransportConfig,
  type DataTransportMode,
  type TransportPingResult,
} from '../lib/dataTransport';
import {
  buildIosWalletDeepLink,
  generateInAppSolanaWallet,
  isValidSolanaPublicKey,
  maskWalletAddress,
  PaperAccountState,
  parseImportedSecretKey,
  StoredWalletState,
} from '../lib/walletManager';
import type { TradingMode } from '../lib/quantEngine';

interface WalletViewProps {
  walletState: StoredWalletState;
  paperAccount: PaperAccountState;
  tradingMode: TradingMode;
  riskPerTradePct: number;
  scanningAllowed: boolean;
  transportConfig: DataTransportConfig;
  resolvedTransportMode: 'WEB_ORIGIN' | 'CUSTOM_SERVER' | 'DIRECT_ONCHAIN';
  onUpdateWallet: (next: StoredWalletState) => void;
  onChangeTradingMode: (mode: TradingMode) => void;
  onResetPaper: (newBalanceSol?: number) => void;
  onSyncLiveBalance: () => Promise<void>;
  onChangeTransportConfig: (next: DataTransportConfig) => void;
  onTestTransport: (cfg: DataTransportConfig) => Promise<TransportPingResult>;
}

interface InjectedSolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string; toBase58?: () => string } }>;
  disconnect?: () => Promise<void>;
}

export function WalletView({
  walletState,
  paperAccount,
  tradingMode,
  riskPerTradePct,
  scanningAllowed,
  transportConfig,
  resolvedTransportMode,
  onUpdateWallet,
  onChangeTradingMode,
  onResetPaper,
  onSyncLiveBalance,
  onChangeTransportConfig,
  onTestTransport,
}: WalletViewProps) {
  const [secretInput, setSecretInput] = useState('');
  const [coldWalletInput, setColdWalletInput] = useState(walletState.coldWalletAddress);
  const [paperResetInput, setPaperResetInput] = useState(String(paperAccount.initialBalanceSol));
  const [showSecret, setShowSecret] = useState(false);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [syncingBal, setSyncingBal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(transportConfig.serverUrl);
  const [rpcUrlInput, setRpcUrlInput] = useState(transportConfig.rpcUrl);
  const [testingTransport, setTestingTransport] = useState(false);
  const [pingResult, setPingResult] = useState<TransportPingResult | null>(null);

  const handleSaveTransport = (mode: DataTransportMode = transportConfig.mode) => {
    const serverCheck = validateHttpEndpoint(serverUrlInput);
    if (!serverCheck.valid) {
      setPingResult({
        ok: false,
        resolvedMode: 'CUSTOM_SERVER',
        latencyMs: 0,
        message: serverCheck.error ?? 'Server URL không hợp lệ.',
      });
      return;
    }
    const rpcCheck = validateHttpEndpoint(rpcUrlInput);
    if (!rpcCheck.valid) {
      setPingResult({
        ok: false,
        resolvedMode: 'DIRECT_ONCHAIN',
        latencyMs: 0,
        message: rpcCheck.error ?? 'RPC Endpoint không hợp lệ.',
      });
      return;
    }
    const next: DataTransportConfig = {
      mode,
      serverUrl: serverCheck.normalized,
      rpcUrl: rpcCheck.normalized || DEFAULT_SOLANA_RPC_URL,
    };
    setServerUrlInput(next.serverUrl);
    setRpcUrlInput(next.rpcUrl);
    onChangeTransportConfig(next);
    setPingResult(null);
  };

  const handleRunPing = async () => {
    const serverCheck = validateHttpEndpoint(serverUrlInput);
    if (!serverCheck.valid) {
      setPingResult({
        ok: false,
        resolvedMode: 'CUSTOM_SERVER',
        latencyMs: 0,
        message: serverCheck.error ?? 'Server URL không hợp lệ.',
      });
      return;
    }
    const rpcCheck = validateHttpEndpoint(rpcUrlInput);
    if (!rpcCheck.valid) {
      setPingResult({
        ok: false,
        resolvedMode: 'DIRECT_ONCHAIN',
        latencyMs: 0,
        message: rpcCheck.error ?? 'RPC Endpoint không hợp lệ.',
      });
      return;
    }
    setTestingTransport(true);
    try {
      const next: DataTransportConfig = {
        mode: transportConfig.mode,
        serverUrl: serverCheck.normalized,
        rpcUrl: rpcCheck.normalized || DEFAULT_SOLANA_RPC_URL,
      };
      setServerUrlInput(next.serverUrl);
      setRpcUrlInput(next.rpcUrl);
      onChangeTransportConfig(next);
      const res = await onTestTransport(next);
      setPingResult(res);
    } catch (err) {
      setPingResult({
        ok: false,
        resolvedMode: resolvedTransportMode,
        latencyMs: 0,
        message: formatTransportErrorMessage(err, 'Không thể kiểm tra kết nối.'),
      });
    } finally {
      setTestingTransport(false);
    }
  };

  const winCount = paperAccount.wins;
  const lossCount = paperAccount.losses;
  const totalTrades = winCount + lossCount;
  const winRate = totalTrades > 0 ? Math.round((winCount / totalTrades) * 100) : 0;
  const activeBalance =
    tradingMode === 'PAPER' ? paperAccount.balanceSol : walletState.liveSolBalance;
  const estimatedRiskSol = Number(((activeBalance * riskPerTradePct) / 100).toFixed(4));

  const handleConnectInjected = async (target: 'phantom' | 'solflare') => {
    setWalletError(null);
    const win = window as unknown as {
      phantom?: { solana?: InjectedSolanaProvider };
      solflare?: InjectedSolanaProvider;
      solana?: InjectedSolanaProvider;
    };
    const provider =
      target === 'phantom'
        ? win.phantom?.solana ?? (win.solana?.isPhantom ? win.solana : undefined)
        : win.solflare ?? (win.solana?.isSolflare ? win.solana : undefined);

    if (!provider) {
      setWalletStatus(
        `Không tìm thấy tiện ích ${
          target === 'phantom' ? 'Phantom' : 'Solflare'
        } trên trình duyệt hiện tại. Dùng nút "Mở trong App iOS" bên dưới hoặc Nhập Private Key trực tiếp.`,
      );
      return;
    }

    try {
      const resp = await provider.connect();
      const pubkey = resp.publicKey.toBase58?.() ?? resp.publicKey.toString();
      onUpdateWallet({
        ...walletState,
        connectionKind: target === 'phantom' ? 'INJECTED_PHANTOM' : 'INJECTED_SOLFLARE',
        publicKey: pubkey,
        secretKeyBase58: '',
      });
      setWalletStatus(`Đã kết nối ví ${target === 'phantom' ? 'Phantom' : 'Solflare'}: ${maskWalletAddress(pubkey)}`);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Người dùng từ chối kết nối ví.');
    }
  };

  const handleImportSecretKey = () => {
    setWalletError(null);
    const parsed = parseImportedSecretKey(secretInput);
    if (!parsed.valid) {
      setWalletError(parsed.error ?? 'Private key không hợp lệ.');
      return;
    }
    onUpdateWallet({
      ...walletState,
      connectionKind: 'IN_APP_IMPORTED',
      publicKey: parsed.publicKey,
      secretKeyBase58: parsed.secretKeyBase58,
    });
    setSecretInput('');
    setWalletStatus(`Đã nạp ví trực tiếp vào App: ${maskWalletAddress(parsed.publicKey)}`);
  };

  const handleGenerateBurner = async () => {
    setWalletError(null);
    const created = await generateInAppSolanaWallet();
    onUpdateWallet({
      ...walletState,
      connectionKind: 'IN_APP_GENERATED',
      publicKey: created.publicKey,
      secretKeyBase58: created.secretKeyBase58,
      liveSolBalance: 0,
    });
    setWalletStatus(`Đã tạo ví giao dịch mới ngay trong App: ${maskWalletAddress(created.publicKey)}`);
  };

  const handleDisconnect = () => {
    onUpdateWallet({
      ...walletState,
      connectionKind: 'NONE',
      publicKey: '',
      secretKeyBase58: '',
      liveSolBalance: 0,
    });
    setWalletStatus('Đã ngắt kết nối và xóa khóa ví khỏi bộ nhớ App.');
    setWalletError(null);
  };

  const handleSaveColdWallet = () => {
    const trimmed = coldWalletInput.trim();
    if (trimmed && !isValidSolanaPublicKey(trimmed)) {
      setWalletError('Địa chỉ ví lạnh Solana không hợp lệ (cần đúng Base58 32 bytes).');
      return;
    }
    setWalletError(null);
    onUpdateWallet({
      ...walletState,
      coldWalletAddress: trimmed,
    });
    setWalletStatus(
      trimmed
        ? `Đã lưu ví lạnh gom lợi nhuận: ${maskWalletAddress(trimmed)}`
        : 'Đã xóa địa chỉ ví lạnh.',
    );
  };

  const handleCopyAddress = async () => {
    if (!walletState.publicKey) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(walletState.publicKey);
        setCopiedAddr(true);
        setTimeout(() => setCopiedAddr(false), 1800);
        return;
      }
      setWalletError('Trình duyệt không cho phép copy tự động — hãy chọn và copy thủ công địa chỉ bên trên.');
    } catch {
      setWalletError('Không thể copy tự động trong WebView/iframe — hãy giữ để chọn và copy địa chỉ ví.');
    }
  };

  const handleSyncClick = async () => {
    setSyncingBal(true);
    await onSyncLiveBalance();
    setSyncingBal(false);
  };

  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://localhost:3000';

  return (
    <div className="space-y-5">
      {/* Top Wallet + Mode Summary Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 glass-panel rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00FFA3]/20 to-violet-500/20 border border-white/10 text-[#00FFA3] flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Ví Solana Trong App</h2>
                <p className="text-xs text-slate-400">
                  Kết nối hoặc nhập trực tiếp trên điện thoại · Không cần Telegram hay .env
                </p>
              </div>
            </div>

            <div className="inline-flex rounded-xl bg-slate-950/70 border border-white/10 p-1">
              <button
                type="button"
                onClick={() => onChangeTradingMode('PAPER')}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  tradingMode === 'PAPER'
                    ? 'bg-white/15 text-white border border-white/15'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Paper Mode
              </button>
              <button
                type="button"
                onClick={() => onChangeTradingMode('LIVE')}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  tradingMode === 'LIVE'
                    ? 'bg-[#00FFA3] text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Live Mode
              </button>
            </div>
          </div>

          {/* Active Wallet Address & Balance */}
          <div className="rounded-xl bg-slate-950/60 border border-white/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-400">
                Trạng thái ví (<span className="font-mono text-slate-200">{walletState.connectionKind}</span>)
              </span>
              {walletState.publicKey ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyAddress()}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/10 bg-slate-900/80 text-xs font-medium text-slate-200 hover:bg-white/10 cursor-pointer"
                  >
                    {copiedAddr ? <Check className="w-3.5 h-3.5 text-[#00FFA3]" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedAddr ? 'Đã copy' : 'Copy địa chỉ'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="min-h-[36px] px-3 py-1 rounded-lg border border-[#FF3B6B]/40 bg-[#FF3B6B]/10 text-xs font-medium text-[#FF3B6B] hover:bg-[#FF3B6B]/20 cursor-pointer"
                  >
                    Ngắt ví
                  </button>
                </div>
              ) : null}
            </div>

            <div className="font-mono text-xs sm:text-sm font-semibold text-white break-all tabular-nums">
              {walletState.publicKey || 'Chưa kết nối ví thực (đang dùng chế độ Paper ảo)'}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-white/10">
              <div>
                <div className="text-[11px] text-slate-400">Số dư On-Chain</div>
                <div className="text-base font-mono font-bold text-white tabular-nums">
                  {walletState.liveSolBalance.toFixed(4)} SOL
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Risk {riskPerTradePct}% / Lệnh</div>
                <div className="text-base font-mono font-bold text-[#00FFA3] tabular-nums">
                  {estimatedRiskSol} SOL
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1 flex items-end">
                <button
                  type="button"
                  disabled={!walletState.publicKey || syncingBal}
                  onClick={() => void handleSyncClick()}
                  className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-slate-900/80 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#00FFA3] ${syncingBal ? 'animate-spin' : ''}`} />
                  {scanningAllowed ? 'Đồng bộ SOL' : 'Cập nhật thủ công'}
                </button>
              </div>
            </div>

            {walletState.secretKeyBase58 ? (
              <div className="pt-2 border-t border-white/10 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Private Key lưu cục bộ trên máy bạn (không gửi lên server):</span>
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="inline-flex items-center gap-1 font-semibold text-slate-200 cursor-pointer py-1 px-2"
                  >
                    {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showSecret ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
                {showSecret ? (
                  <div className="p-2.5 rounded-lg bg-black/70 border border-white/10 text-[#00FFA3] font-mono text-[11px] break-all">
                    {walletState.secretKeyBase58}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {walletStatus ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-xs text-emerald-200">
              {walletStatus}
            </div>
          ) : null}
          {walletError ? (
            <div className="p-3 rounded-xl bg-[#FF3B6B]/10 border border-[#FF3B6B]/30 text-xs text-rose-200">
              {walletError}
            </div>
          ) : null}
        </section>

        {/* Paper Account + Reset Balance/PnL/Drawdown Card */}
        <section className="lg:col-span-5 glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3.5">
            <div>
              <h2 className="text-base font-bold text-white">Tài khoản Paper &amp; Reset</h2>
              <p className="text-xs text-slate-400">
                Đặt lại số dư, PnL và Max Drawdown về trạng thái ban đầu bất cứ lúc nào.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3">
              <div className="text-[11px] text-slate-400">Balance Paper</div>
              <div className="text-lg font-mono font-bold text-white tabular-nums">
                {paperAccount.balanceSol.toFixed(4)} SOL
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3">
              <div className="text-[11px] text-slate-400">Realized PnL</div>
              <div
                className={`text-lg font-mono font-bold tabular-nums ${
                  paperAccount.realizedPnlSol >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                }`}
              >
                {paperAccount.realizedPnlSol >= 0 ? '+' : ''}
                {paperAccount.realizedPnlSol.toFixed(4)} SOL
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3">
              <div className="text-[11px] text-slate-400">Max Drawdown</div>
              <div className="text-base font-mono font-bold text-[#FF3B6B] tabular-nums">
                -{paperAccount.maxDrawdownSol.toFixed(4)} SOL ({paperAccount.maxDrawdownPct}%)
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3">
              <div className="text-[11px] text-slate-400">Win Rate (W/L)</div>
              <div className="text-base font-mono font-bold text-white tabular-nums">
                {winRate}% ({winCount}/{lossCount})
              </div>
            </div>
          </div>

          <div className="pt-2 space-y-2.5">
            <label htmlFor="paper-reset-sol" className="block text-xs font-medium text-slate-300">
              Vốn Paper khởi tạo (SOL)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="paper-reset-sol"
                type="number"
                step="1"
                min="0.1"
                value={paperResetInput}
                onChange={(e) => setPaperResetInput(e.target.value)}
                className="flex-1 min-h-[42px] px-3 py-2 text-sm font-mono tabular-nums border border-white/10 rounded-xl bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
              />
              <button
                type="button"
                onClick={() => {
                  const v = Number(paperResetInput);
                  onResetPaper(Number.isFinite(v) && v > 0 ? v : 10);
                  setWalletStatus(`Đã reset Balance (${Number.isFinite(v) && v > 0 ? v : 10} SOL), PnL & Drawdown về 0!`);
                }}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/15 border border-white/15 text-white text-xs font-semibold hover:bg-white/25 whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Paper
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Connect / Import / Generate & Cold Wallet Sweep */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-6 glass-panel rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">1. Kết nối Ví Phantom / Solflare (iOS &amp; Browser)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => void handleConnectInjected('phantom')}
              className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-bold hover:brightness-110 cursor-pointer"
            >
              <Wallet className="w-4 h-4" />
              Kết nối Phantom
            </button>
            <button
              type="button"
              onClick={() => void handleConnectInjected('solflare')}
              className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-slate-950/60 text-slate-100 text-xs font-semibold hover:bg-white/10 cursor-pointer"
            >
              <Wallet className="w-4 h-4 text-[#F59E0B]" />
              Kết nối Solflare
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <a
              href={buildIosWalletDeepLink('phantom', currentUrl)}
              className="min-h-[42px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/60 border border-white/10 text-slate-300 text-xs font-medium hover:text-white hover:bg-white/10"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Mở trong Phantom iOS
            </a>
            <a
              href={buildIosWalletDeepLink('solflare', currentUrl)}
              className="min-h-[42px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/60 border border-white/10 text-slate-300 text-xs font-medium hover:text-white hover:bg-white/10"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Mở trong Solflare iOS
            </a>
          </div>
        </section>

        <section className="lg:col-span-6 glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">2. Nhập / Tạo Ví Giao Dịch Trong App</h3>
            <button
              type="button"
              onClick={() => void handleGenerateBurner()}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#00FFA3] text-slate-950 text-xs font-bold hover:brightness-110 whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Tạo ví mới
            </button>
          </div>

          <div className="space-y-2.5">
            <label htmlFor="import-secret-input" className="block text-xs text-slate-400">
              Dán Private Key Base58 hoặc mảng 64 số JSON từ Phantom/Solflare:
            </label>
            <textarea
              id="import-secret-input"
              rows={2}
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              placeholder="VD: 5Mai... hoặc [12, 44, ...]"
              className="w-full px-3 py-2.5 text-xs font-mono border border-white/10 rounded-xl bg-slate-950/70 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#00FFA3]/50"
            />
            <button
              type="button"
              onClick={handleImportSecretKey}
              className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white/15 border border-white/15 text-white text-xs font-semibold hover:bg-white/25 cursor-pointer"
            >
              <KeyRound className="w-4 h-4 text-[#00FFA3]" />
              Nạp Ví Vào App
            </button>
          </div>
        </section>
      </div>

      {/* Cold Wallet Auto-Consolidate Target */}
      <section className="glass-panel rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#00FFA3]" />
          <h3 className="text-sm font-bold text-white">
            Ví Lạnh Gom Lợi Nhuận &amp; Rent Reclaim (Auto-Consolidate)
          </h3>
        </div>
        <p className="text-xs text-slate-400">
          Địa chỉ ví an toàn nhận SOL lời tự động khi vượt ngưỡng và tiền rent (<span className="font-mono text-slate-200">~0.00204 SOL/ATA</span>) thu hồi sau khi bán hết token.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={coldWalletInput}
            onChange={(e) => setColdWalletInput(e.target.value)}
            placeholder="Nhập Public Key ví lạnh Solana..."
            aria-label="Địa chỉ ví lạnh Solana"
            className="flex-1 min-h-[42px] px-3 py-2 text-xs font-mono border border-white/10 rounded-xl bg-slate-950/70 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#00FFA3]/50"
          />
          <button
            type="button"
            onClick={handleSaveColdWallet}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-white/10 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 whitespace-nowrap cursor-pointer"
          >
            Lưu Ví Lạnh
          </button>
        </div>
      </section>

      {/* Hybrid Data Transport for Standalone .IPA */}
      <section className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#00FFA3]" />
            <h3 className="text-sm font-bold text-white">
              Nguồn Dữ Liệu &amp; Kết Nối Khi Chạy File .IPA
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Đang dùng:{' '}
            <strong className="text-[#00FFA3]">
              {resolvedTransportMode === 'DIRECT_ONCHAIN'
                ? 'Direct DEX/RPC'
                : resolvedTransportMode === 'CUSTOM_SERVER'
                  ? 'Custom Server'
                  : 'Web Origin'}
            </strong>
          </span>
        </div>

        <p className="text-xs text-slate-400">
          Trong file .IPA độc lập trên iPhone, bạn có thể chạy thẳng qua DexScreener/GeckoTerminal/Solana RPC không cần server, hoặc trỏ tới Server URL để bật nén compact 4G (-88%) và ETag 304.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-1 bg-slate-950/70 border border-white/10 rounded-xl">
          {(
            [
              { id: 'AUTO', label: 'Tự động (Auto)' },
              { id: 'DIRECT_ONCHAIN', label: 'Direct DEX / RPC' },
              { id: 'CUSTOM_SERVER', label: 'Server URL Tùy chỉnh' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSaveTransport(item.id)}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                transportConfig.mode === item.id
                  ? 'bg-white/15 text-white border border-white/15'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="ipa-server-url" className="font-medium text-slate-300">
                Server / Cloud URL (Tùy chọn)
              </label>
              {typeof window !== 'undefined' && window.location.protocol.startsWith('http') ? (
                <button
                  type="button"
                  onClick={() => setServerUrlInput(normalizeServerUrl(window.location.origin))}
                  className="text-[11px] font-semibold text-[#00FFA3] hover:underline cursor-pointer"
                >
                  Dùng URL hiện tại
                </button>
              ) : null}
            </div>
            <input
              id="ipa-server-url"
              type="url"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="https://your-bot-server.run.app"
              className="w-full min-h-[42px] px-3 py-2 text-xs font-mono border border-white/10 rounded-xl bg-slate-950/70 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ipa-rpc-url" className="block text-xs font-medium text-slate-300">
              Solana RPC Endpoint (Direct Mode)
            </label>
            <input
              id="ipa-rpc-url"
              type="url"
              value={rpcUrlInput}
              onChange={(e) => setRpcUrlInput(e.target.value)}
              placeholder="https://solana-rpc.publicnode.com"
              className="w-full min-h-[42px] px-3 py-2 text-xs font-mono border border-white/10 rounded-xl bg-slate-950/70 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleSaveTransport(transportConfig.mode)}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#00FFA3] text-slate-950 text-xs font-bold hover:brightness-110 cursor-pointer"
          >
            Lưu Cấu Hình Kết Nối
          </button>
          <button
            type="button"
            disabled={testingTransport}
            onClick={() => void handleRunPing()}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-slate-950/60 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#00FFA3] ${testingTransport ? 'animate-spin' : ''}`} />
            Kiểm tra kết nối
          </button>
        </div>

        {pingResult ? (
          <div
            className={`p-3 rounded-xl border text-xs ${
              pingResult.ok
                ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
                : 'bg-[#FF3B6B]/10 border-[#FF3B6B]/30 text-rose-200'
            }`}
          >
            {pingResult.message}
          </div>
        ) : null}
      </section>
    </div>
  );
}
