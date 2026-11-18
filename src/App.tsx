import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Code2,
  Download,
  Radar,
  SlidersHorizontal,
  Wallet,
  Zap,
} from 'lucide-react';
import { NetworkGuardBar } from './components/NetworkGuardBar';
import { OverviewView } from './components/OverviewView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RealtimeBacktestView } from './components/RealtimeBacktestView';
import { SetupGuideView } from './components/SetupGuideView';
import { SniperDashboardView } from './components/SniperDashboardView';
import { SourceExplorerView } from './components/SourceExplorerView';
import { StrategyLabView } from './components/StrategyLabView';
import { WalletView } from './components/WalletView';
import {
  DataTransportConfig,
  fetchDirectSolanaFeed,
  fetchDirectSolBalance,
  formatTransportErrorMessage,
  loadDataTransportConfig,
  pingDataTransport,
  resolveEffectiveTransport,
  saveDataTransportConfig,
} from './lib/dataTransport';
import { isCapacitorNativeApp, subscribeNativeNetwork } from './lib/nativeNetwork';
import {
  BrowserConnectionLike,
  createInitialDataUsage,
  DataUsageStats,
  decodeCompactLiveFeed,
  detectBrowserNetworkInterface,
  LiveTokenSnapshot,
  NetworkInterfaceKind,
  NetworkPolicyMode,
  NetworkSourceOverride,
  recordDataUsage,
  resolveEffectiveNetworkPolicy,
} from './lib/networkPolicy';
import {
  loadAppliedOtaState,
  OtaHotUpdateBundle,
  saveAppliedOtaState,
} from './lib/otaHotUpdate';
import {
  applyStrategyPreset,
  DEFAULT_STRATEGY_CONFIG,
  MarketRegimeType,
  StrategyConfig,
  StrategyPresetId,
} from './lib/quantEngine';
import {
  createInitialRealtimeBacktestState,
  RealtimeBacktestState,
  stepRealtimeBacktest,
} from './lib/realtimeBacktest';
import {
  ChainNetworkId,
  createInitialSniperTerminalState,
  DEFAULT_SNIPE_SETTINGS,
  executeSnipeOrder,
  formatTimeHMS,
  getNetworkTelemetry,
  MempoolPairItem,
  mergeLiveAndSamplePairs,
  panicSellAllPositions,
  ScannedContractInfo,
  sellPositionFraction,
  SnipeOrderSettings,
  SniperTerminalState,
  tickSniperPositions,
} from './lib/sniperTerminal';
import {
  applyPaperTradeOutcome,
  createInitialPaperAccount,
  PaperAccountState,
  StoredWalletState,
} from './lib/walletManager';
import type { BotProjectTree } from './types/studio';

type AppTab = 'scanner' | 'backtest' | 'wallet' | 'strategy' | 'code';
type CodeSubTab = 'overview' | 'explorer' | 'guide';

const WALLET_STORAGE_KEY = 'solsniper_wallet_v1';
const PAPER_STORAGE_KEY = 'solsniper_paper_v2';
const DEFAULT_PAPER_SOL = 14.52;

const DEFAULT_WALLET_STATE: StoredWalletState = {
  connectionKind: 'NONE',
  publicKey: '',
  secretKeyBase58: '',
  coldWalletAddress: '',
  liveSolBalance: 0,
  lastBalanceSyncAt: null,
};

function readConnectionInfo(): BrowserConnectionLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    connection?: BrowserConnectionLike & {
      addEventListener?: (t: string, cb: () => void) => void;
      removeEventListener?: (t: string, cb: () => void) => void;
    };
  };
  return nav.connection ?? null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('scanner');
  const [codeSubTab, setCodeSubTab] = useState<CodeSubTab>('overview');

  // Network Guard (Wi-Fi Only + Ultra-Low-Data 4G)
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [detectedNet, setDetectedNet] = useState<NetworkInterfaceKind>(() =>
    detectBrowserNetworkInterface(readConnectionInfo()),
  );
  const [policyMode, setPolicyMode] = useState<NetworkPolicyMode>('WIFI_ONLY_LOCK');
  const [sourceOverride, setSourceOverride] = useState<NetworkSourceOverride>('AUTO');
  const [dataUsage, setDataUsage] = useState<DataUsageStats>(() => createInitialDataUsage());

  const [isNativeIpa] = useState<boolean>(() => isCapacitorNativeApp());
  const [transportConfig, setTransportConfig] = useState<DataTransportConfig>(() =>
    loadDataTransportConfig(),
  );
  const effectiveTransport = useMemo(
    () => resolveEffectiveTransport(transportConfig, isNativeIpa),
    [transportConfig, isNativeIpa],
  );

  // Strategy, Regime & Applied OTA Hot-Update
  const [appliedOta, setAppliedOta] = useState(() => loadAppliedOtaState());
  const [config, setConfig] = useState<StrategyConfig>(() => {
    const base = applyStrategyPreset(
      { ...DEFAULT_STRATEGY_CONFIG, accountBalanceSol: DEFAULT_PAPER_SOL },
      'SMALL_CAP_HIGH_PF',
    );
    const saved = loadAppliedOtaState();
    return saved.bundle ? { ...base, ...saved.bundle.strategyPatch } : base;
  });
  const [regime, setRegime] = useState<MarketRegimeType>('BULLISH');

  // Sniper Terminal State
  const [snipeSettings, setSnipeSettings] = useState<SnipeOrderSettings>(() => {
    const saved = loadAppliedOtaState();
    return saved.bundle?.sniperDefaults
      ? { ...DEFAULT_SNIPE_SETTINGS, ...saved.bundle.sniperDefaults }
      : DEFAULT_SNIPE_SETTINGS;
  });
  const [sniperState, setSniperState] = useState<SniperTerminalState>(() =>
    createInitialSniperTerminalState(),
  );

  // Wallet & Paper State
  const [walletState, setWalletState] = useState<StoredWalletState>(() => {
    try {
      const raw = localStorage.getItem(WALLET_STORAGE_KEY);
      return raw
        ? { ...DEFAULT_WALLET_STATE, ...(JSON.parse(raw) as StoredWalletState) }
        : DEFAULT_WALLET_STATE;
    } catch {
      return DEFAULT_WALLET_STATE;
    }
  });

  const [paperAccount, setPaperAccount] = useState<PaperAccountState>(() => {
    try {
      const raw = localStorage.getItem(PAPER_STORAGE_KEY);
      return raw
        ? (JSON.parse(raw) as PaperAccountState)
        : createInitialPaperAccount(DEFAULT_PAPER_SOL);
    } catch {
      return createInitialPaperAccount(DEFAULT_PAPER_SOL);
    }
  });

  const updateWalletState = useCallback((next: StoredWalletState) => {
    setWalletState(next);
    try {
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const updatePaperAccount = useCallback(
    (updater: (prev: PaperAccountState) => PaperAccountState) => {
      setPaperAccount((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  const activeBalanceSol =
    config.tradingMode === 'LIVE' && walletState.publicKey
      ? walletState.liveSolBalance
      : paperAccount.balanceSol;

  // Live Feed & Real-Time Backtest State
  const [liveTokens, setLiveTokens] = useState<LiveTokenSnapshot[]>([]);
  const [feedSource, setFeedSource] = useState<string>('INIT');
  const [loadingFeed, setLoadingFeed] = useState<boolean>(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState<boolean>(true);
  const [rtBacktest, setRtBacktest] = useState<RealtimeBacktestState>(() =>
    createInitialRealtimeBacktestState(DEFAULT_PAPER_SOL),
  );
  const [busyBacktestTick, setBusyBacktestTick] = useState<boolean>(false);
  const lastEtagRef = useRef<string | null>(null);
  const lastFullTokensRef = useRef<LiveTokenSnapshot[]>([]);

  const handleUpdateTransportConfig = useCallback((next: DataTransportConfig) => {
    setTransportConfig(next);
    saveDataTransportConfig(next);
    lastEtagRef.current = null;
  }, []);

  const networkDecision = useMemo(
    () =>
      resolveEffectiveNetworkPolicy({
        policyMode,
        detectedKind: detectedNet,
        override: sourceOverride,
        isOnline,
      }),
    [policyMode, detectedNet, sourceOverride, isOnline],
  );

  const mempoolPairs = useMemo(
    () => mergeLiveAndSamplePairs(liveTokens, sniperState.network),
    [liveTokens, sniperState.network],
  );

  // Lazy-loaded Code Tree
  const [project, setProject] = useState<BotProjectTree | null>(null);
  const [projectLoading, setProjectLoading] = useState<boolean>(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const loadProjectTree = useCallback(async () => {
    if (effectiveTransport.resolvedMode === 'DIRECT_ONCHAIN') {
      setProjectError(
        'Chế độ Direct DEX/RPC đang chạy độc lập trên iPhone. Hãy nhập Server URL trong tab Ví App nếu muốn duyệt & hot-update mã nguồn bot từ xa.',
      );
      return;
    }
    setProjectLoading(true);
    try {
      const res = await fetch(`${effectiveTransport.baseUrl}/api/project-tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Server không trả về JSON source tree hợp lệ.');
      }
      const bytes = new Blob([text]).size;
      setDataUsage((u) => recordDataUsage(u, bytes, bytes, false));
      setProject(JSON.parse(text) as BotProjectTree);
      setProjectError(null);
    } catch (err) {
      setProjectError(formatTransportErrorMessage(err, 'Failed to load project'));
    } finally {
      setProjectLoading(false);
    }
  }, [effectiveTransport]);

  useEffect(() => {
    if (activeTab === 'code' && !project && !projectLoading) {
      void loadProjectTree();
    }
  }, [activeTab, project, projectLoading, loadProjectTree]);

  // Network listeners
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const conn = readConnectionInfo() as (BrowserConnectionLike & {
      addEventListener?: (t: string, cb: () => void) => void;
      removeEventListener?: (t: string, cb: () => void) => void;
    }) | null;
    const onConnChange = () => setDetectedNet(detectBrowserNetworkInterface(readConnectionInfo()));
    conn?.addEventListener?.('change', onConnChange);

    const unsubscribeNative = subscribeNativeNetwork((mapped) => {
      setIsOnline(mapped.isOnline);
      setDetectedNet(mapped.detectedKind);
    });

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      conn?.removeEventListener?.('change', onConnChange);
      unsubscribeNative();
    };
  }, []);

  const fetchLiveFeed = useCallback(async (): Promise<{
    source: string;
    tokens: LiveTokenSnapshot[];
  }> => {
    if (!networkDecision.scanningAllowed) {
      return { source: 'PAUSED_WIFI_ONLY', tokens: lastFullTokensRef.current };
    }

    if (effectiveTransport.resolvedMode === 'DIRECT_ONCHAIN') {
      try {
        const direct = await fetchDirectSolanaFeed(networkDecision.feedLimit);
        setDataUsage((u) =>
          recordDataUsage(u, direct.bytesTransferred, Math.max(direct.bytesTransferred, 3200), false),
        );
        if (direct.tokens.length > 0) {
          lastFullTokensRef.current = direct.tokens;
          setLiveTokens(direct.tokens);
          setFeedSource(direct.source);
        }
        return { source: direct.source, tokens: direct.tokens };
      } catch {
        return { source: feedSource || 'CACHED_FEED', tokens: lastFullTokensRef.current };
      }
    }

    const compactParam = networkDecision.useCompactPayload ? '1' : '0';
    const url = `${effectiveTransport.baseUrl}/api/live-feed?compact=${compactParam}&limit=${networkDecision.feedLimit}`;
    const headers: Record<string, string> = {};
    if (lastEtagRef.current && /^[\x20-\x7E]+$/.test(lastEtagRef.current)) {
      headers['If-None-Match'] = lastEtagRef.current;
    }

    try {
      const resp = await fetch(url, { headers });
      const fullEstHeader = Number(resp.headers.get('X-Full-Bytes-Est') ?? 2400);
      const etag = resp.headers.get('ETag');
      if (etag && /^[\x20-\x7E]+$/.test(etag)) {
        lastEtagRef.current = etag;
      }

      if (resp.status === 304) {
        setDataUsage((u) => recordDataUsage(u, 0, fullEstHeader, true));
        return {
          source: `${feedSource} (304 Cache)`,
          tokens: lastFullTokensRef.current,
        };
      }

      const rawText = await resp.text();
      if (!resp.ok || rawText.trim().startsWith('<')) {
        throw new Error(`Feed HTTP ${resp.status}`);
      }
      const bytes = new Blob([rawText]).size;
      setDataUsage((u) => recordDataUsage(u, bytes, Math.max(bytes, fullEstHeader), false));

      const decoded = decodeCompactLiveFeed(JSON.parse(rawText));
      if (decoded.tokens.length > 0) {
        lastFullTokensRef.current = decoded.tokens;
        setLiveTokens(decoded.tokens);
        setFeedSource(decoded.source);
      }
      return decoded;
    } catch {
      try {
        const fallback = await fetchDirectSolanaFeed(networkDecision.feedLimit);
        if (fallback.tokens.length > 0) {
          lastFullTokensRef.current = fallback.tokens;
          setLiveTokens(fallback.tokens);
          setFeedSource(fallback.source);
        }
        return { source: fallback.source, tokens: fallback.tokens };
      } catch {
        return { source: feedSource || 'OFFLINE_CACHE', tokens: lastFullTokensRef.current };
      }
    }
  }, [networkDecision, feedSource, effectiveTransport]);

  const handleManualScan = useCallback(async () => {
    if (!networkDecision.scanningAllowed) return;
    setLoadingFeed(true);
    try {
      await fetchLiveFeed();
    } catch {
      // handled safely inside fetchLiveFeed
    } finally {
      setLoadingFeed(false);
    }
  }, [networkDecision.scanningAllowed, fetchLiveFeed]);

  // Initial feed load + Auto-Scan Timer
  useEffect(() => {
    if (!networkDecision.scanningAllowed) return;
    if (liveTokens.length === 0) {
      void handleManualScan();
    }
    if (!autoScanEnabled || networkDecision.pollIntervalMs <= 0) return;

    const timer = setInterval(() => {
      void fetchLiveFeed();
    }, networkDecision.pollIntervalMs);
    return () => clearInterval(timer);
  }, [
    networkDecision.scanningAllowed,
    networkDecision.pollIntervalMs,
    autoScanEnabled,
    liveTokens.length,
    handleManualScan,
    fetchLiveFeed,
  ]);

  // Update active sniper positions smoothly when feed updates or every 4s
  useEffect(() => {
    const timer = setInterval(() => {
      setSniperState((prev) => tickSniperPositions(prev, mempoolPairs, config));
    }, 4000);
    return () => clearInterval(timer);
  }, [mempoolPairs, config]);

  // Real-Time Backtest Tick Execution
  const handleStepBacktestTick = useCallback(async () => {
    if (!networkDecision.scanningAllowed) return;
    setBusyBacktestTick(true);
    try {
      const feed = await fetchLiveFeed();
      setRtBacktest((prev) =>
        stepRealtimeBacktest(prev, feed.tokens, config, {
          regimeOverride: regime,
          feedSource: feed.source,
        }),
      );
    } catch {
      // Keep previous backtest state intact on transient network failure
    } finally {
      setBusyBacktestTick(false);
    }
  }, [networkDecision.scanningAllowed, fetchLiveFeed, config, regime]);

  useEffect(() => {
    if (!rtBacktest.running || !networkDecision.scanningAllowed || networkDecision.pollIntervalMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      void handleStepBacktestTick();
    }, networkDecision.pollIntervalMs);
    return () => clearInterval(timer);
  }, [
    rtBacktest.running,
    networkDecision.scanningAllowed,
    networkDecision.pollIntervalMs,
    handleStepBacktestTick,
  ]);

  const handleResetPaper = useCallback(
    (newBalanceSol = DEFAULT_PAPER_SOL) => {
      const safe = Number.isFinite(newBalanceSol) && newBalanceSol > 0 ? newBalanceSol : DEFAULT_PAPER_SOL;
      updatePaperAccount(() => createInitialPaperAccount(safe));
      setConfig((c) => ({ ...c, accountBalanceSol: safe }));
      setRtBacktest(createInitialRealtimeBacktestState(safe));
    },
    [updatePaperAccount],
  );

  const handleSyncLiveBalance = useCallback(async () => {
    if (!walletState.publicKey) return;
    if (effectiveTransport.resolvedMode === 'DIRECT_ONCHAIN') {
      const direct = await fetchDirectSolBalance(walletState.publicKey, transportConfig.rpcUrl);
      setDataUsage((u) => recordDataUsage(u, direct.bytesTransferred, direct.bytesTransferred, false));
      updateWalletState({
        ...walletState,
        liveSolBalance: direct.sol,
        lastBalanceSyncAt: Date.now(),
      });
      return;
    }
    try {
      const res = await fetch(
        `${effectiveTransport.baseUrl}/api/sol-balance?address=${encodeURIComponent(walletState.publicKey)}`,
      );
      const rawText = await res.text();
      if (!res.ok || rawText.trim().startsWith('<')) {
        throw new Error(`HTTP ${res.status}`);
      }
      const bytes = new Blob([rawText]).size;
      setDataUsage((u) => recordDataUsage(u, bytes, bytes, false));
      const json = JSON.parse(rawText) as { sol?: number };
      if (typeof json.sol === 'number') {
        updateWalletState({
          ...walletState,
          liveSolBalance: json.sol,
          lastBalanceSyncAt: Date.now(),
        });
      }
    } catch {
      const direct = await fetchDirectSolBalance(walletState.publicKey, transportConfig.rpcUrl);
      updateWalletState({
        ...walletState,
        liveSolBalance: direct.sol,
        lastBalanceSyncAt: Date.now(),
      });
    }
  }, [walletState, updateWalletState, effectiveTransport, transportConfig.rpcUrl]);

  // Sniper Execution Actions
  const handleExecuteSnipe = useCallback(
    (target: ScannedContractInfo, orderSettings: SnipeOrderSettings) => {
      setSniperState((prev) => executeSnipeOrder(prev, target, orderSettings).nextState);
    },
    [],
  );

  const handleQuickSnipePair = useCallback(
    (pair: MempoolPairItem) => {
      const target: ScannedContractInfo = {
        mint: pair.mint,
        symbol: pair.symbol,
        name: pair.name,
        dexLabel: pair.dexLabel,
        priceUsd: pair.priceUsd,
        priceSol: pair.priceSol,
        liquidityUsd: pair.liquidityUsd,
        marketCapUsd: pair.marketCapUsd,
        mintDisabled: pair.mintDisabled,
        lpBurned: pair.lpBurned,
        lpBurnedPct: pair.lpBurnedPct,
        top10HoldersPct: pair.top10HoldersPct,
        honeypotPassed: pair.honeypotPassed,
        aiScore: pair.mintDisabled && pair.lpBurned ? 91 : 48,
        riskTag: pair.mintDisabled && pair.lpBurned ? 'LOW_RISK' : 'HIGH_RISK',
      };
      setSniperState((prev) =>
        executeSnipeOrder(prev, target, { ...snipeSettings, mode: 'INSTANT' }).nextState,
      );
    },
    [snipeSettings],
  );

  const handleSellPosition = useCallback(
    (positionId: string, fraction: number) => {
      setSniperState((prev) => {
        const res = sellPositionFraction(prev, positionId, fraction);
        if (config.tradingMode === 'PAPER' && res.netPnlDeltaSol !== 0) {
          updatePaperAccount((p) => applyPaperTradeOutcome(p, res.netPnlDeltaSol));
        }
        return res.nextState;
      });
    },
    [config.tradingMode, updatePaperAccount],
  );

  const handlePanicSellAll = useCallback(() => {
    setSniperState((prev) => {
      const res = panicSellAllPositions(prev);
      if (config.tradingMode === 'PAPER' && res.totalNetPnlSol !== 0) {
        updatePaperAccount((p) => applyPaperTradeOutcome(p, res.totalNetPnlSol));
      }
      return res.nextState;
    });
    setActiveTab('scanner');
  }, [config.tradingMode, updatePaperAccount]);

  const handleCancelPendingOrder = useCallback((orderId: string) => {
    setSniperState((prev) => ({
      ...prev,
      pendingOrders: prev.pendingOrders.filter((o) => o.id !== orderId),
    }));
  }, []);

  const handleActivateSmallCapHighPf = useCallback(() => {
    const nextCfg = applyStrategyPreset(config, 'SMALL_CAP_HIGH_PF');
    setConfig(nextCfg);
    setSnipeSettings((prev) => ({
      ...prev,
      smallCapHighPf: true,
      priorityFeeSol: 0.00025,
      takeProfitPct: 30,
      stopLossPct: 12,
      antiMev: true,
    }));
    const now = Date.now();
    setSniperState((prev) => ({
      ...prev,
      logs: [
        {
          id: `log-pf-${now}`,
          timestamp: now,
          timeStr: formatTimeHMS(now),
          severity: 'SUCCESS' as const,
          message:
            'Activated SMALL_CAP_HIGH_PF: Fee-Drag cap <=2.2% (Tip 0.00025 SOL), TP1 +30% (55%), BE Lock +3.5%, Hard SL -12%',
        },
        ...prev.logs,
      ].slice(0, 60),
    }));
  }, [config]);

  const handleApplyOtaBundle = useCallback((bundle: OtaHotUpdateBundle) => {
    const saved = saveAppliedOtaState(bundle);
    setAppliedOta({ ...saved, bundle });
    setConfig((c) => ({ ...c, ...bundle.strategyPatch }));
    setSnipeSettings((s) => ({ ...s, ...bundle.sniperDefaults }));
    const now = Date.now();
    setSniperState((prev) => ({
      ...prev,
      logs: [
        {
          id: `log-ota-${now}`,
          timestamp: now,
          timeStr: formatTimeHMS(now),
          severity: 'SUCCESS' as const,
          message: `Hot-Update OTA ${bundle.version} applied in-app without re-sideloading!`,
        },
        ...prev.logs,
      ].slice(0, 60),
    }));
  }, []);

  const handleDownloadZip = () => {
    const link = document.createElement('a');
    link.href = effectiveTransport.baseUrl ? `${effectiveTransport.baseUrl}/api/download-zip` : '/api/download-zip';
    link.download = 'solana-ai-sniper-bot.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const telemetry = getNetworkTelemetry(sniperState.network);

  const navTabs: Array<{ id: AppTab; label: string; Icon: typeof Radar }> = [
    { id: 'scanner', label: 'Sniper', Icon: Radar },
    { id: 'backtest', label: 'Backtest', Icon: Activity },
    { id: 'wallet', label: 'Ví App', Icon: Wallet },
    { id: 'strategy', label: 'Chiến lược', Icon: SlidersHorizontal },
    { id: 'code', label: 'Code/App', Icon: Code2 },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#07090E] text-slate-100 relative overflow-x-hidden">
      {/* Ambient Gradient Blurs Behind Dark Glassmorphism Surfaces */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-36 -left-32 w-[520px] h-[520px] rounded-full bg-[#10B981]/15 blur-[140px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-1/3 -right-32 w-[520px] h-[520px] rounded-full bg-[#8B5CF6]/15 blur-[150px]"
      />

      {/* Sticky Glassmorphic Top Bar */}
      <header className="sticky top-0 z-30 pt-safe bg-[#07090E]/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-5 h-14 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Brand Logo + Live RPC Latency Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className="flex items-center gap-1.5 sm:gap-2 text-left shrink-0 cursor-pointer"
            >
              <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br from-[#00FFA3] to-[#8B5CF6] flex items-center justify-center text-slate-950 shadow-[0_0_16px_rgba(0,255,163,0.35)]">
                <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-slate-950" />
              </span>
              <span className="text-sm sm:text-base font-extrabold tracking-tight text-white font-display whitespace-nowrap">
                SolSniper<span className="hidden sm:inline"> AI</span>
              </span>
            </button>

            <div className="hidden lg:inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 font-mono tabular-nums text-[11px] text-slate-300 shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00FFA3] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00FFA3]" />
              </span>
              <span>
                {telemetry.label} • {telemetry.latencyMs}ms
              </span>
            </div>
          </div>

          {/* Center: Desktop Nav Tabs */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
            {navTabs.map((item) => {
              const isCurrent = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-white/15 text-[#00FFA3] shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right: Chain Switcher + Wallet Balance + .IPA OTA + PANIC SELL ALL */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Network Switcher (SOL / Base / ETH) */}
            <div className="hidden sm:inline-flex items-center rounded-xl bg-slate-950/80 border border-white/10 p-0.5">
              {(['SOL', 'BASE', 'ETH'] as ChainNetworkId[]).map((net) => {
                const active = sniperState.network === net;
                return (
                  <button
                    key={net}
                    type="button"
                    onClick={() =>
                      setSniperState((prev) => ({
                        ...prev,
                        network: net,
                      }))
                    }
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#8B5CF6]/30 text-white border border-[#8B5CF6]/50'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    {net === 'BASE' ? 'Base' : net}
                  </button>
                );
              })}
            </div>

            {/* Wallet Balance Pill */}
            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-white/15 text-[11px] sm:text-xs font-mono tabular-nums font-bold text-[#00FFA3] whitespace-nowrap cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5 text-slate-300" />
              <span>
                {activeBalanceSol.toFixed(2)} {telemetry.nativeUnit}
              </span>
            </button>

            {/* .IPA & Hot-Update Modal */}
            <PWAInstallButton
              appliedOtaVersion={appliedOta.version}
              serverBaseUrl={effectiveTransport.baseUrl}
              onApplyOtaBundle={handleApplyOtaBundle}
              onNavigateTransport={() => setActiveTab('wallet')}
            />

            {/* Prominent Red Emergency Panic Sell All */}
            <button
              type="button"
              onClick={handlePanicSellAll}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-[#FF3B6B] hover:bg-[#ff2056] text-white text-[11px] sm:text-xs font-extrabold tracking-wide uppercase shadow-[0_0_20px_rgba(255,59,107,0.45)] transition-all whitespace-nowrap cursor-pointer"
            >
              <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">PANIC SELL ALL</span>
              <span className="sm:hidden">PANIC</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-5 py-4 pb-24 md:pb-8 space-y-4">
        <NetworkGuardBar
          policyMode={policyMode}
          sourceOverride={sourceOverride}
          decision={networkDecision}
          usage={dataUsage}
          onChangePolicyMode={setPolicyMode}
          onChangeSourceOverride={setSourceOverride}
        />

        {activeTab === 'scanner' && (
          <SniperDashboardView
            network={sniperState.network}
            activeBalanceSol={activeBalanceSol}
            tradingMode={config.tradingMode}
            feedSource={feedSource}
            loadingFeed={loadingFeed}
            scanningAllowed={networkDecision.scanningAllowed}
            autoScanEnabled={autoScanEnabled}
            mempoolPairs={mempoolPairs}
            activePositions={sniperState.activePositions}
            pendingOrders={sniperState.pendingOrders}
            logs={sniperState.logs}
            settings={snipeSettings}
            onChangeSettings={setSnipeSettings}
            onExecuteSnipe={handleExecuteSnipe}
            onQuickSnipePair={handleQuickSnipePair}
            onSellPosition={handleSellPosition}
            onCancelPendingOrder={handleCancelPendingOrder}
            onToggleAutoScan={() => setAutoScanEnabled((v) => !v)}
            onManualScan={handleManualScan}
            onActivateSmallCapHighPf={handleActivateSmallCapHighPf}
          />
        )}

        {activeTab === 'backtest' && (
          <RealtimeBacktestView
            state={rtBacktest}
            config={config}
            regime={regime}
            scanningAllowed={networkDecision.scanningAllowed}
            useCompactPayload={networkDecision.useCompactPayload}
            pollIntervalMs={networkDecision.pollIntervalMs || 8000}
            busyTick={busyBacktestTick}
            onToggleRunning={() =>
              setRtBacktest((prev) => ({ ...prev, running: !prev.running }))
            }
            onStepLiveTick={handleStepBacktestTick}
            onResetBacktest={() => handleResetPaper(paperAccount.initialBalanceSol)}
            onApplyPreset={(_preset: StrategyPresetId, nextConfig) => setConfig(nextConfig)}
            onChangeRegime={setRegime}
            onToggleAutoDelete={() =>
              setConfig((c) => ({ ...c, autoDeleteEntryMsgEnabled: !c.autoDeleteEntryMsgEnabled }))
            }
          />
        )}

        {activeTab === 'wallet' && (
          <WalletView
            walletState={walletState}
            paperAccount={paperAccount}
            tradingMode={config.tradingMode}
            riskPerTradePct={config.riskPerTradePct}
            scanningAllowed={networkDecision.scanningAllowed}
            transportConfig={transportConfig}
            resolvedTransportMode={effectiveTransport.resolvedMode}
            onUpdateWallet={updateWalletState}
            onChangeTradingMode={(mode) => setConfig((c) => ({ ...c, tradingMode: mode }))}
            onResetPaper={handleResetPaper}
            onSyncLiveBalance={handleSyncLiveBalance}
            onChangeTransportConfig={handleUpdateTransportConfig}
            onTestTransport={(cfg) => pingDataTransport(cfg, isNativeIpa)}
          />
        )}

        {activeTab === 'strategy' && <StrategyLabView />}

        {activeTab === 'code' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/45 backdrop-blur-xl border border-white/10 rounded-xl p-3">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { id: 'overview', label: 'Kiến trúc v7' },
                    { id: 'explorer', label: 'Source & Hot-Update' },
                    { id: 'guide', label: 'Hướng dẫn iOS & VPS' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setCodeSubTab(sub.id)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                      codeSubTab === sub.id
                        ? 'bg-[#00FFA3]/20 border border-[#00FFA3]/40 text-[#00FFA3]'
                        : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleDownloadZip}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#00FFA3] to-[#10B981] text-slate-950 text-xs font-bold hover:brightness-110 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Tải solana-ai-sniper-bot.zip
              </button>
            </div>

            {projectError ? (
              <div className="p-4 rounded-xl border border-[#FF3B6B]/40 bg-[#FF3B6B]/10 text-xs text-[#FF3B6B]">
                Lỗi tải source tree: {projectError}
              </div>
            ) : null}

            {codeSubTab === 'overview' && (
              <OverviewView
                project={project}
                loading={projectLoading}
                onNavigate={(tab) => {
                  if (tab === 'explorer' || tab === 'guide') {
                    setCodeSubTab(tab);
                  } else {
                    setActiveTab(tab);
                  }
                }}
                onDownloadZip={handleDownloadZip}
              />
            )}

            {codeSubTab === 'explorer' && (
              <SourceExplorerView
                project={project}
                loading={projectLoading}
                serverBaseUrl={effectiveTransport.baseUrl}
                onDownloadZip={handleDownloadZip}
                onProjectUpdated={loadProjectTree}
              />
            )}

            {codeSubTab === 'guide' && <SetupGuideView onDownloadZip={handleDownloadZip} />}
          </div>
        )}
      </main>

      {/* Fixed Mobile Bottom Nav Bar */}
      <nav
        aria-label="Điều hướng chính"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 pb-safe bg-[#07090E]/90 backdrop-blur-xl border-t border-white/10"
      >
        <div className="grid grid-cols-5 items-center h-14">
          {navTabs.map((item) => {
            const isCurrent = activeTab === item.id;
            const Icon = item.Icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={isCurrent ? 'page' : undefined}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  isCurrent ? 'text-[#00FFA3]' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={isCurrent ? 2.4 : 1.8} />
                <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
