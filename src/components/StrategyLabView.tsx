import { useMemo, useState } from 'react';
import {
  applyStrategyPreset,
  computeAnalyticsSummary,
  computeDynamicPositionSize,
  computePostTradeReconciliation,
  DEFAULT_STRATEGY_CONFIG,
  detectMarketRegime,
  evaluateAdaptiveEntry,
  evaluateAiTokenCandidate,
  evaluateTokenCandidate,
  MarketRegimeType,
  runWalkForwardBacktestSimulation,
  simulatePositionLifecycle,
  SimulatedPriceStep,
  StrategyConfig,
  StrategyPresetId,
  TokenCandidateInput,
} from '../lib/quantEngine';

interface PresetCandidate {
  id: string;
  label: string;
  token: TokenCandidateInput;
  trajectoryLabel: string;
  trajectory: SimulatedPriceStep[];
}

const PRESETS: PresetCandidate[] = [
  {
    id: 'clean_gem',
    label: 'Clean Raydium V4 Launch',
    token: {
      mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      symbol: 'SOLCAT',
      name: 'Solana Quant Cat',
      dex: 'RAYDIUM_V4',
      eventKind: 'NEW_POOL',
      creatorAddress: 'SafeDev111111111111111111111111111111111111',
      hasVerifiedPrice: true,
      liquidityUsd: 42500,
      roundTripSpreadPct: 2.8,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      lpBurnedPct: 99.4,
      top10HoldersPct: 16.5,
      devHoldPct: 2.1,
      bundleSupplyPct: 9.0,
      rugcheckRisk: 'Good',
      honeypotPassed: true,
      buyCount: 34,
      sellCount: 8,
      uniqueBuyers: 21,
      devSold: false,
      m5VolumeUsd: 9600,
      h1VolumeUsd: 44000,
      largestBuyerSharePct: 12,
    },
    trajectoryLabel: 'Pump +45% -> Peak +160% -> Pullback -8% (TP1 Trail) -> -12% (Trail SL)',
    trajectory: [
      { minute: 1, priceMultiplier: 1.25 },
      { minute: 2, priceMultiplier: 1.55 },
      { minute: 4, priceMultiplier: 2.6 },
      { minute: 5, priceMultiplier: 2.36 },
      { minute: 6, priceMultiplier: 2.02 },
    ],
  },
  {
    id: 'bundle_honeypot',
    label: 'Pump Create / Rug Trap',
    token: {
      mint: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      symbol: 'FAKEAI',
      name: 'Fake AI Rug',
      dex: 'PUMP_FUN',
      eventKind: 'NEW_POOL',
      creatorAddress: 'RugDev6666666666666666666666666666666666666',
      hasVerifiedPrice: false,
      liquidityUsd: 1850,
      roundTripSpreadPct: 38.0,
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: true,
      lpBurnedPct: 45.0,
      top10HoldersPct: 48.0,
      devHoldPct: 12.5,
      bundleSupplyPct: 44.0,
      rugcheckRisk: 'Danger',
      honeypotPassed: false,
      buyCount: 2,
      sellCount: 0,
      uniqueBuyers: 1,
      devSold: false,
      m5VolumeUsd: 400,
      h1VolumeUsd: 2400,
      largestBuyerSharePct: 78,
    },
    trajectoryLabel: 'LP Drain Collapse (< 35% liquidity -> RUG_DRAIN & auto-blacklist)',
    trajectory: [
      { minute: 1, priceMultiplier: 0.85 },
      { minute: 2, priceMultiplier: 0.68, liquidityRatio: 0.25 },
    ],
  },
  {
    id: 'wash_trade_trap',
    label: 'Wash-Trade / Micro-Spam Trap',
    token: {
      mint: 'WashTrap11111111111111111111111111111111111',
      symbol: 'BOTSPAM',
      name: 'Wash Bot Token',
      dex: 'RAYDIUM_CPMM',
      eventKind: 'NEW_POOL',
      creatorAddress: 'CleanDev22222222222222222222222222222222222',
      hasVerifiedPrice: true,
      liquidityUsd: 16800,
      roundTripSpreadPct: 5.1,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      lpBurnedPct: 98.0,
      top10HoldersPct: 18.0,
      devHoldPct: 2.0,
      bundleSupplyPct: 11.0,
      rugcheckRisk: 'Good',
      honeypotPassed: true,
      buyCount: 68,
      sellCount: 4,
      uniqueBuyers: 9,
      devSold: false,
      m5VolumeUsd: 290,
      h1VolumeUsd: 6200,
      largestBuyerSharePct: 62,
    },
    trajectoryLabel: 'Sideways bleed into 12m Time Exit',
    trajectory: [
      { minute: 5, priceMultiplier: 1.03 },
      { minute: 12, priceMultiplier: 0.96 },
    ],
  },
  {
    id: 'breakeven_reversal',
    label: 'Meteora Wick + Break-Even Lock',
    token: {
      mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      symbol: 'MEOWDL',
      name: 'Meteora Owl',
      dex: 'METEORA_DLMM',
      eventKind: 'NEW_POOL',
      creatorAddress: 'SafeDev333333333333333333333333333333333333',
      hasVerifiedPrice: true,
      liquidityUsd: 19400,
      roundTripSpreadPct: 4.5,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      lpBurnedPct: 100,
      top10HoldersPct: 19.8,
      devHoldPct: 3.4,
      bundleSupplyPct: 14.0,
      rugcheckRisk: 'Good',
      honeypotPassed: true,
      buyCount: 14,
      sellCount: 5,
      uniqueBuyers: 9,
      devSold: false,
      m5VolumeUsd: 3800,
      h1VolumeUsd: 24000,
      largestBuyerSharePct: 18,
    },
    trajectoryLabel: 'Pump +22% (Arms Break-Even) -> Pullback to +5% (Exits BE_SL with positive net)',
    trajectory: [
      { minute: 1, priceMultiplier: 0.86 },
      { minute: 3, priceMultiplier: 1.22 },
      { minute: 5, priceMultiplier: 1.05 },
      { minute: 7, priceMultiplier: 0.65 },
    ],
  },
];

const SAMPLE_R_OUTCOMES = [
  { symbol: 'BONKAI', rMultiple: 1.6, timestamp: 1 },
  { symbol: 'CATSOL', rMultiple: -1.0, timestamp: 2 },
  { symbol: 'JUPDOG', rMultiple: 2.4, timestamp: 3 },
  { symbol: 'MEMEX', rMultiple: -0.75, timestamp: 4 },
  { symbol: 'ORCAFI', rMultiple: 1.85, timestamp: 5 },
  { symbol: 'PUMPAI', rMultiple: 2.9, timestamp: 6 },
];

export function StrategyLabView() {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('clean_gem');
  const [activeStrategyPreset, setActiveStrategyPreset] = useState<StrategyPresetId | 'CUSTOM'>(
    'BALANCED',
  );
  const [liveTipFloorSol, setLiveTipFloorSol] = useState<number>(0.0014);
  const [regimeOverride, setRegimeOverride] = useState<MarketRegimeType>('BULLISH');
  const [config, setConfig] = useState<StrategyConfig>(DEFAULT_STRATEGY_CONFIG);
  const [paperResetToZero, setPaperResetToZero] = useState<boolean>(false);

  const preset = useMemo(
    () => PRESETS.find((p) => p.id === selectedPresetId) ?? PRESETS[0],
    [selectedPresetId],
  );

  const marketRegime = useMemo(
    () => detectMarketRegime({ regimeOverride }),
    [regimeOverride],
  );

  const evaluation = useMemo(
    () =>
      evaluateTokenCandidate(preset.token, config, {
        liveTipFloorSol,
      }),
    [preset.token, config, liveTipFloorSol],
  );

  const aiEval = useMemo(
    () =>
      evaluateAiTokenCandidate(preset.token, config, evaluation, {
        regime: marketRegime,
      }),
    [preset.token, config, evaluation, marketRegime],
  );

  const adaptiveEntry = useMemo(
    () => evaluateAdaptiveEntry(preset.token, aiEval, evaluation, marketRegime, config),
    [preset.token, aiEval, evaluation, marketRegime, config],
  );

  const backtestReport = useMemo(
    () => runWalkForwardBacktestSimulation(config, { seed: 202607, sampleCount: 60 }),
    [config],
  );

  const lifecycle = useMemo(
    () => simulatePositionLifecycle(preset.trajectory, config),
    [preset.trajectory, config],
  );

  const sizing = useMemo(
    () =>
      computeDynamicPositionSize({
        availableBalanceSol: config.accountBalanceSol,
        openExposureSol: 0,
        dailyRealizedPnlSol: -0.02,
        weeklyRealizedPnlSol: -0.05,
        securityScore: evaluation.securityScore,
        liquidityUsd: preset.token.liquidityUsd ?? 24000,
        cfg: config,
      }),
    [config, evaluation.securityScore, preset.token.liquidityUsd],
  );

  const reconciliationSample = useMemo(
    () =>
      computePostTradeReconciliation({
        side: 'BUY',
        expectedSolUi: sizing.allowed ? sizing.sizedBuySol : 0.05,
        preLamports: Math.round(config.accountBalanceSol * 1_000_000_000),
        postLamports:
          Math.round(config.accountBalanceSol * 1_000_000_000) -
          Math.round(
            ((sizing.allowed ? sizing.sizedBuySol : 0.05) * 1.015 +
              evaluation.effectiveJitoTipSol +
              0.0002) *
              1_000_000_000,
          ),
        feeLamports: 200_000,
        tipSol: evaluation.effectiveJitoTipSol,
        preTokenUi: 0,
        postTokenUi: 425_000,
      }),
    [sizing.allowed, sizing.sizedBuySol, config.accountBalanceSol, evaluation.effectiveJitoTipSol],
  );

  const analytics = useMemo(() => {
    if (paperResetToZero) {
      return computeAnalyticsSummary([], config.accountBalanceSol);
    }
    const rUnit = Math.max(
      0.001,
      (config.accountBalanceSol * (config.riskPerTradePct || 1)) / 100,
    );
    const outcomes = SAMPLE_R_OUTCOMES.map((item) => ({
      symbol: item.symbol,
      netPnlSol: Number((item.rMultiple * rUnit).toFixed(4)),
      timestamp: item.timestamp,
    }));
    return computeAnalyticsSummary(outcomes, config.accountBalanceSol);
  }, [config.accountBalanceSol, config.riskPerTradePct, paperResetToZero]);

  const balanceChartGeometry = useMemo(() => {
    const pts = analytics.balanceCurve;
    const width = 760;
    const height = 160;
    const padX = 24;
    const padY = 18;
    const values = pts.map((p) => p.balanceSol);
    const minV = Math.min(...values) * 0.995;
    const maxV = Math.max(...values) * 1.005;
    const span = Math.max(0.01, maxV - minV);

    const coords = pts.map((p, idx) => {
      const x =
        pts.length <= 1
          ? width / 2
          : padX + (idx / (pts.length - 1)) * (width - padX * 2);
      const y = height - padY - ((p.balanceSol - minV) / span) * (height - padY * 2);
      return { x, y, ...p };
    });

    const linePath = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath =
      coords.length > 0
        ? `${linePath} L ${coords[coords.length - 1].x} ${height - padY} L ${coords[0].x} ${
            height - padY
          } Z`
        : '';

    return { width, height, padY, coords, linePath, areaPath };
  }, [analytics.balanceCurve]);

  const updateNum = (key: keyof StrategyConfig, value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setConfig((prev) => ({ ...prev, [key]: parsed }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Autonomous Risk & Strategy Controls */}
      <section className="glass-panel rounded-xl p-5 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Autonomous Risk &amp; Strategy Parameter Lab
            </h2>
            <p className="text-xs text-slate-400">
              Tự động tính khối lượng lệnh theo <span className="font-mono text-[#00FFA3]">{config.riskPerTradePct}%</span> Balance,
              Anti-Rug 5 lớp cân bằng, Orderflow chống wash-trade &amp; tối ưu Profit Factor cho vốn nhỏ.
            </p>
          </div>

          <div className="flex items-center gap-1.5 p-1 bg-slate-950/70 border border-white/10 rounded-xl">
            <button
              type="button"
              onClick={() => setConfig((c) => ({ ...c, tradingMode: 'PAPER' }))}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                config.tradingMode === 'PAPER'
                  ? 'bg-white/15 text-white border border-white/15'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Paper Mode
            </button>
            <button
              type="button"
              onClick={() => setConfig((c) => ({ ...c, tradingMode: 'LIVE' }))}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                config.tradingMode === 'LIVE'
                  ? 'bg-[#00FFA3] text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Live Mode
            </button>
          </div>
        </div>

        {/* Preset Selector & Strategy Throughput Presets + Granular Toggles */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPresetId(p.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedPresetId === p.id
                      ? 'bg-violet-500/20 text-violet-200 border-violet-400/40'
                      : 'bg-slate-950/50 text-slate-300 border-white/10 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400">Bot Logic Preset:</span>
              {(
                [
                  { id: 'SMALL_CAP_HIGH_PF', label: 'Vốn nhỏ High-PF' },
                  { id: 'MAX_THROUGHPUT', label: 'Max Khớp Lệnh' },
                  { id: 'BALANCED', label: 'Cân Bằng' },
                  { id: 'STRICT_SAFE', label: 'An Toàn' },
                ] as const
              ).map((presetBtn) => (
                <button
                  key={presetBtn.id}
                  type="button"
                  onClick={() => {
                    setConfig((c) => applyStrategyPreset(c, presetBtn.id));
                    setActiveStrategyPreset(presetBtn.id);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeStrategyPreset === presetBtn.id
                      ? 'bg-[#00FFA3]/20 text-[#00FFA3] border-[#00FFA3]/40'
                      : 'bg-slate-950/50 text-slate-300 border-white/10 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {presetBtn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {(
              [
                {
                  title: 'Security & Liquidity Gates',
                  items: [
                    { key: 'honeypotSimEnabled', label: 'Honeypot Sim (L5)' },
                    { key: 'lpLockCheckEnabled', label: 'LP Lock Check (L2)' },
                    { key: 'antiBundleCheckEnabled', label: 'Anti-Bundle (L4)' },
                    { key: 'spreadGuardEnabled', label: 'Spread Guard' },
                    { key: 'snipePumpCreate', label: 'Snipe Pump Create' },
                  ],
                },
                {
                  title: 'Orderflow & Execution',
                  items: [
                    { key: 'orderflowFilterEnabled', label: 'Orderflow Master' },
                    { key: 'washTradeGuardEnabled', label: 'Wash/Sybil Guard' },
                    { key: 'momentumFilterEnabled', label: 'Momentum/Vol/FDV' },
                    { key: 'cooldownGuardEnabled', label: 'Entry Cooldown (30s)' },
                    { key: 'dynamicJitoTipEnabled', label: 'Dynamic Jito Tip' },
                  ],
                },
                {
                  title: 'v7 AI & Quant Intelligence',
                  items: [
                    { key: 'aiIntelligenceEnabled', label: 'AI Prediction Engine' },
                    { key: 'smartMoneyFilterEnabled', label: 'Smart Money Intel' },
                    { key: 'marketRegimeGuardEnabled', label: 'Market Regime Guard' },
                    { key: 'adaptiveEntryEnabled', label: 'Adaptive Entry (5x)' },
                    { key: 'socialIntelligenceEnabled', label: 'Social & Narrative' },
                    { key: 'continuousLearningEnabled', label: 'Continuous Learning' },
                  ],
                },
                {
                  title: 'Exit & Risk Controls',
                  items: [
                    { key: 'smallCapEdgeMode', label: 'Small-Cap High-PF' },
                    { key: 'trailingStopEnabled', label: 'Trailing SL' },
                    { key: 'trailingTpEnabled', label: 'Trailing TP' },
                    { key: 'breakevenLockEnabled', label: 'Break-Even Lock' },
                    { key: 'earlyMomentumCutEnabled', label: 'Early Cut (5m/6m)' },
                    { key: 'timeExitEnabled', label: 'Time Exit (12m)' },
                    { key: 'circuitBreakerEnabled', label: 'Daily/Weekly Breaker' },
                    { key: 'autoDeleteEntryMsgEnabled', label: 'Auto-Del Entry (TP/SL)' },
                  ],
                },
              ] as const
            ).map((group) => (
              <div
                key={group.title}
                className="rounded-xl border border-white/10 bg-slate-950/50 p-3 space-y-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2.5 gap-y-1.5 text-xs">
                  {group.items.map((item) => (
                    <label key={item.key} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(config[item.key])}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setConfig((c) => ({ ...c, [item.key]: checked }));
                          setActiveStrategyPreset('CUSTOM');
                        }}
                        className="rounded border-white/20 bg-slate-900 accent-[#00FFA3]"
                      />
                      <span className="font-medium text-slate-300 truncate">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* v7 Market Regime Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-300">Market Regime Simulation:</span>
              {(['BULLISH', 'SIDEWAYS', 'HIGH_VOLATILITY', 'BEARISH'] as const).map((reg) => (
                <button
                  key={reg}
                  type="button"
                  onClick={() => setRegimeOverride(reg)}
                  className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] font-medium cursor-pointer transition-colors ${
                    regimeOverride === reg
                      ? 'bg-violet-500/20 text-violet-200 border-violet-400/40'
                      : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-white'
                  }`}
                >
                  {reg}
                </button>
              ))}
            </div>
            <div className="font-mono text-slate-400 tabular-nums">
              Rec Strategy: <strong className="text-white">{marketRegime.recommendedStrategy}</strong> ·
              MinAI: <strong className="text-[#00FFA3]">{marketRegime.minAiScoreThreshold}</strong> ·
              SizeMult: <strong className="text-white">{marketRegime.sizeMultiplier}x</strong>
            </div>
          </div>
        </div>

        {/* Numeric Threshold Inputs (12 balanced inputs: 6x2 desktop) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          <div>
            <label
              htmlFor="cfg-balance-sol"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Account Balance (SOL)
            </label>
            <input
              id="cfg-balance-sol"
              type="number"
              step="0.5"
              value={config.accountBalanceSol}
              onChange={(e) => updateNum('accountBalanceSol', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-risk-pct"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Risk / Trade (%)
            </label>
            <input
              id="cfg-risk-pct"
              type="number"
              step="0.25"
              value={config.riskPerTradePct}
              onChange={(e) => updateNum('riskPerTradePct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-daily-loss-pct"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Max Daily Loss (%)
            </label>
            <input
              id="cfg-daily-loss-pct"
              type="number"
              step="0.5"
              value={config.maxDailyLossPct}
              onChange={(e) => updateNum('maxDailyLossPct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-min-liq"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Min Liq ($)
            </label>
            <input
              id="cfg-min-liq"
              type="number"
              step="500"
              value={config.minLiquidityUsd}
              onChange={(e) => updateNum('minLiquidityUsd', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-lp-min"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Min LP Burn (%)
            </label>
            <input
              id="cfg-lp-min"
              type="number"
              value={config.minLpBurnedPct}
              onChange={(e) => updateNum('minLpBurnedPct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-vol-spike"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Min Vol Spike (x)
            </label>
            <input
              id="cfg-vol-spike"
              type="number"
              step="0.1"
              value={config.minVolumeSpikeRatio}
              onChange={(e) => updateNum('minVolumeSpikeRatio', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-jito-floor"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Live Jito Floor
            </label>
            <input
              id="cfg-jito-floor"
              type="number"
              step="0.0002"
              value={liveTipFloorSol}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) setLiveTipFloorSol(v);
              }}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-tp1"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              TP1 Target (%)
            </label>
            <input
              id="cfg-tp1"
              type="number"
              value={config.tp1Pct}
              onChange={(e) => updateNum('tp1Pct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-trail-tp-cb"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Trail TP CB (%)
            </label>
            <input
              id="cfg-trail-tp-cb"
              type="number"
              value={config.trailingTpCallbackPct}
              onChange={(e) => updateNum('trailingTpCallbackPct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-be-act"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              BE Lock (%)
            </label>
            <input
              id="cfg-be-act"
              type="number"
              value={config.breakevenActivatePct}
              onChange={(e) => updateNum('breakevenActivatePct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-hard-sl"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Hard SL (%)
            </label>
            <input
              id="cfg-hard-sl"
              type="number"
              value={config.hardSlPct}
              onChange={(e) => updateNum('hardSlPct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
          <div>
            <label
              htmlFor="cfg-max-heat"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Max Heat (%)
            </label>
            <input
              id="cfg-max-heat"
              type="number"
              value={config.maxPortfolioHeatPct}
              onChange={(e) => updateNum('maxPortfolioHeatPct', e.target.value)}
              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums border border-white/10 rounded-lg bg-slate-950/70 text-white focus:outline-none focus:border-[#00FFA3]/50"
            />
          </div>
        </div>
      </section>

      {/* Evaluation Output + Lifecycle Simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 glass-panel rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-white">
                5-Layer Security &amp; Autonomous Pipeline: {preset.token.symbol}
              </h3>
              <p className="text-xs font-mono text-slate-400 tabular-nums">
                {preset.token.dex} · {sizing.reason} · Tip {evaluation.effectiveJitoTipSol} SOL ({evaluation.feeRatioPct}%)
              </p>
            </div>
            <div className="text-right">
              <div
                className={`text-sm font-bold ${
                  evaluation.overallApproved ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                }`}
              >
                {evaluation.overallApproved ? 'APPROVED FOR ENTRY' : 'BLOCKED BY GUARDS'}
              </div>
              <div className="text-xs font-mono text-slate-400 tabular-nums">
                Security Score: {evaluation.securityScore}/100
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-950/60 text-xs font-medium text-slate-400">
                  <th className="py-2.5 px-6">Check Layer</th>
                  <th className="py-2.5 px-4">Result</th>
                  <th className="py-2.5 px-6">Telemetry Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {evaluation.layers.map((layer) => (
                  <tr key={layer.layer} className="hover:bg-white/5">
                    <td className="py-2.5 px-6 font-medium text-white">{layer.layer}</td>
                    <td
                      className={`py-2.5 px-4 font-mono text-xs font-semibold ${
                        layer.passed ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                      }`}
                    >
                      {layer.passed ? 'PASS' : 'FAIL'}
                    </td>
                    <td className="py-2.5 px-6 text-xs text-slate-300 font-mono">{layer.detail}</td>
                  </tr>
                ))}
                <tr className="hover:bg-white/5">
                  <td className="py-2.5 px-6 font-medium text-white">
                    Market &amp; Liquidity Gate
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono text-xs font-semibold ${
                      evaluation.marketGatePassed ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                    }`}
                  >
                    {evaluation.marketGatePassed ? 'PASS' : 'FAIL'}
                  </td>
                  <td className="py-2.5 px-6 text-xs text-slate-300 font-mono tabular-nums">
                    Liq=${(preset.token.liquidityUsd ?? 0).toLocaleString()}, Priced=
                    {preset.token.hasVerifiedPrice ? 'Yes' : 'No'}, Spread=
                    {preset.token.roundTripSpreadPct ?? 0}%
                  </td>
                </tr>
                <tr className="hover:bg-white/5">
                  <td className="py-2.5 px-6 font-medium text-white">
                    Orderflow &amp; Wash-Trade Guard
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono text-xs font-semibold ${
                      evaluation.orderflowPassed ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                    }`}
                  >
                    {evaluation.orderflowPassed ? 'PASS' : 'FAIL'}
                  </td>
                  <td className="py-2.5 px-6 text-xs text-slate-300 font-mono tabular-nums">
                    Buys={preset.token.buyCount}/{preset.token.sellCount} ({evaluation.buyToSellRatio}x),
                    VolSpike={evaluation.volumeSpikeRatio}x, Wash={evaluation.washTradeSuspected ? 'YES' : 'No'}
                  </td>
                </tr>
                <tr className="hover:bg-white/5">
                  <td className="py-2.5 px-6 font-medium text-white">
                    Auto {config.riskPerTradePct}% Risk + Liq Cap
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono text-xs font-semibold ${
                      sizing.allowed ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                    }`}
                  >
                    {sizing.allowed ? 'READY' : 'BLOCKED'}
                  </td>
                  <td className="py-2.5 px-6 text-xs text-slate-300 font-mono tabular-nums">
                    {sizing.reason} · LiqCap={sizing.liquidityCapSol} SOL · Impact={sizing.estimatedPriceImpactPct}% / ExitSlip={sizing.estimatedExitSlippagePct}%
                  </td>
                </tr>
                <tr className="hover:bg-white/5">
                  <td className="py-2.5 px-6 font-medium text-white">
                    v7 AI Prediction &amp; Smart Money
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono text-xs font-semibold ${
                      aiEval.passed ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                    }`}
                  >
                    {aiEval.passed ? 'PASS' : 'FILTERED'}
                  </td>
                  <td className="py-2.5 px-6 text-xs text-slate-300 font-mono tabular-nums">
                    {aiEval.reason} · SmartMoney={aiEval.smartMoneyScore} · Social={aiEval.socialScore} ({aiEval.narrative})
                  </td>
                </tr>
                <tr className="hover:bg-white/5">
                  <td className="py-2.5 px-6 font-medium text-white">
                    v7 Adaptive Entry (5 Strategies)
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono text-xs font-semibold ${
                      adaptiveEntry.approved ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                    }`}
                  >
                    {adaptiveEntry.approved ? 'APPROVED' : 'HOLD'}
                  </td>
                  <td className="py-2.5 px-6 text-xs text-slate-300 font-mono tabular-nums">
                    {adaptiveEntry.reasons.join(' | ')} · EstSlip={adaptiveEntry.estimatedEntrySlippagePct}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Position Lifecycle Output */}
        <section className="lg:col-span-5 glass-panel rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-white">
              Exit Strategy Execution Trace ({config.tradingMode})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{preset.trajectoryLabel}</p>
          </div>

          <div className="grid grid-cols-3 gap-4 py-3 border-y border-white/10 text-sm">
            <div>
              <div className="text-xs text-slate-400">Auto Size</div>
              <div className="text-base font-mono font-semibold text-white tabular-nums">
                {lifecycle.positionSizeSol} SOL
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Balance Impact</div>
              <div
                className={`text-base font-mono font-semibold tabular-nums ${
                  lifecycle.netPnlSol >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
                }`}
              >
                {lifecycle.netPnlSol >= 0 ? '+' : ''}
                {lifecycle.netPnlSol} SOL
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Close Trigger</div>
              <div className="text-sm font-mono font-semibold text-white mt-0.5">
                {lifecycle.closeReason ?? 'OPEN'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10 text-xs font-mono space-y-1">
            <div className="font-semibold text-white">Post-Trade On-Chain Reconciliation</div>
            <div className="text-slate-300 tabular-nums">
              Reconciled SOL={reconciliationSample.actualSolUi} · Fee={reconciliationSample.actualFeeSol}{' '}
              SOL · Slippage Drift={reconciliationSample.slippageDiffPct >= 0 ? '+' : ''}
              {reconciliationSample.slippageDiffPct}%
            </div>
            {lifecycle.events.length > 0 ? (
              <div
                className={
                  config.autoDeleteEntryMsgEnabled
                    ? 'text-[#00FFA3] font-medium pt-0.5'
                    : 'text-slate-400 pt-0.5'
                }
              >
                {config.autoDeleteEntryMsgEnabled
                  ? `In-App Entry Order Alert auto-deleted on ${lifecycle.events[0].action}`
                  : 'In-App Entry Order Alert kept (Auto-Delete OFF)'}
              </div>
            ) : null}
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-medium text-slate-400">Triggered Execution Legs</div>
            {lifecycle.events.length === 0 ? (
              <div className="text-xs text-slate-500">No exit legs triggered in horizon.</div>
            ) : (
              <ul className="divide-y divide-white/10 text-xs font-mono">
                {lifecycle.events.map((ev, idx) => (
                  <li key={idx} className="py-2 flex items-center justify-between gap-3">
                    <span className="font-semibold text-white">
                      {ev.minute}m · {ev.action}
                    </span>
                    <span className="text-slate-400 tabular-nums">{ev.multiplier.toFixed(2)}x</span>
                    <span className="text-[#00FFA3] tabular-nums">+{ev.solProceeds} SOL</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* v7 AI Token Intelligence + Adaptive Entry 5-Strategy Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 glass-panel rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div>
              <h3 className="text-base font-semibold text-white">
                AI Token Intelligence &amp; Calibration ({preset.token.symbol})
              </h3>
              <p className="text-xs text-slate-400">
                Calibrated logistic pump/rug probabilities with data-reliability shrinkage ({aiEval.dataConfidencePct}% verified).
              </p>
            </div>
            <span
              className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-lg border ${
                aiEval.passed
                  ? 'bg-[#00FFA3]/15 border-[#00FFA3]/30 text-[#00FFA3]'
                  : 'bg-[#FF3B6B]/15 border-[#FF3B6B]/30 text-[#FF3B6B]'
              }`}
            >
              Score {aiEval.tokenQualityScore}/100
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-2.5">
              <div className="text-slate-400">P(Pump)</div>
              <div className="text-base font-mono font-semibold text-[#00FFA3] tabular-nums">
                {Math.round(aiEval.pumpProbability * 100)}%
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-2.5">
              <div className="text-slate-400">P(Rug)</div>
              <div className="text-base font-mono font-semibold text-[#FF3B6B] tabular-nums">
                {Math.round(aiEval.rugProbability * 100)}%
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-2.5">
              <div className="text-slate-400">Confidence</div>
              <div className="text-base font-mono font-semibold text-white tabular-nums">
                {Math.round(aiEval.calibratedConfidence * 100)}%
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-2.5">
              <div className="text-slate-400">15m Exp Ret</div>
              <div className="text-base font-mono font-semibold text-white tabular-nums">
                {aiEval.expectedReturn15mPct >= 0 ? '+' : ''}
                {aiEval.expectedReturn15mPct}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono text-slate-300 pt-1">
            <div>Lifecycle: <strong className="text-white">{aiEval.lifecycleStage}</strong></div>
            <div>Timing: <strong className="text-white">{aiEval.entryTiming}</strong></div>
            <div>Momentum: <strong className="text-white">{aiEval.priceMomentumPrediction}</strong></div>
            <div>Liq Growth: <strong className="text-white">{aiEval.liquidityGrowthPrediction}</strong></div>
            <div>Narrative: <strong className="text-white">{aiEval.narrative}</strong></div>
            <div>SmartMoney: <strong className="text-[#00FFA3]">{aiEval.smartMoneyScore}/100</strong></div>
          </div>
        </section>

        <section className="lg:col-span-6 glass-panel rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div>
              <h3 className="text-base font-semibold text-white">
                Adaptive Entry Strategy Ranking ({adaptiveEntry.selectedStrategy})
              </h3>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                Rank {adaptiveEntry.entryRankScore} vs Dynamic Threshold {adaptiveEntry.dynamicThreshold} ({marketRegime.regime} regime).
              </p>
            </div>
            <span className="text-xs font-mono text-slate-300">
              MTF: <strong className="text-[#00FFA3]">{adaptiveEntry.multiTimeframeConfirmed ? 'CONFIRMED' : 'WEAK'}</strong>
            </span>
          </div>

          <div className="space-y-2">
            {(Object.entries(adaptiveEntry.strategyScores) as Array<[string, number]>).map(
              ([strat, score]) => {
                const isSelected = strat === adaptiveEntry.selectedStrategy;
                return (
                  <div key={strat} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className={isSelected ? 'font-bold text-[#00FFA3]' : 'text-slate-400'}>
                        {strat} {isSelected ? '★' : ''}
                      </span>
                      <span className="text-slate-200">{score}/100</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950/80 border border-white/5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isSelected ? 'bg-[#00FFA3]' : 'bg-violet-500/50'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(4, score))}%` }}
                      />
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </section>
      </div>

      {/* v7 Walk-Forward Backtest & Monte Carlo Validation Panel */}
      <section className="glass-panel rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              Walk-Forward Backtest &amp; Monte Carlo Stress Test (60 Snapshots · 300 Runs)
            </h3>
            <p className="text-xs text-slate-400">
              Strict chronological 65% In-Sample / 35% Out-of-Sample split with pool-adjusted slippage + round-trip fees. Updates live when toggles/thresholds change.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-400 tabular-nums">
            Rejected Pumped Counterfactual: <strong className="text-white">{backtestReport.rejectedPumpedPct}%</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-slate-400">Executed / Total</div>
            <div className="text-base font-mono font-semibold text-white tabular-nums">
              {backtestReport.totalTrades}/{backtestReport.sampleSize}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-slate-400">IS ➔ OOS Win Rate</div>
            <div className="text-base font-mono font-semibold text-[#00FFA3] tabular-nums">
              {backtestReport.inSampleWinRatePct}% ➔ {backtestReport.walkForwardOosWinRatePct}%
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-slate-400">OOS Profit Factor</div>
            <div className="text-base font-mono font-semibold text-[#00FFA3] tabular-nums">
              {backtestReport.walkForwardOosProfitFactor}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-slate-400">Net PnL (After Fees)</div>
            <div
              className={`text-base font-mono font-semibold tabular-nums ${
                backtestReport.netPnlAfterFeesSol >= 0 ? 'text-[#00FFA3]' : 'text-[#FF3B6B]'
              }`}
            >
              {backtestReport.netPnlAfterFeesSol >= 0 ? '+' : ''}
              {backtestReport.netPnlAfterFeesSol} SOL
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-slate-400">MC Median / P05</div>
            <div className="text-base font-mono font-semibold text-white tabular-nums">
              {backtestReport.monteCarloMedianReturnPct}% / {backtestReport.monteCarloP05ReturnPct}%
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-slate-400">MC 95% Worst DD</div>
            <div className="text-base font-mono font-semibold text-[#FF3B6B] tabular-nums">
              -{backtestReport.monteCarloWorstDdPct}%
            </div>
          </div>
        </div>
      </section>

      {/* Account Balance Curve & Balance Table (Replaces Profit Table) */}
      <section className="glass-panel rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">
              Bảng Balance &amp; Account Balance Curve (/balance)
            </h3>
            <p className="text-xs text-slate-400">
              Theo dõi biến động số dư tài khoản (SOL) theo từng lệnh ở mức rủi ro {config.riskPerTradePct}% Balance/lệnh.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs font-mono text-slate-400 tabular-nums">
              Start: <strong className="text-white">{analytics.initialBalanceSol} SOL</strong> ➔{' '}
              Current:{' '}
              <strong
                className={
                  analytics.currentBalanceSol >= analytics.initialBalanceSol
                    ? 'text-[#00FFA3]'
                    : 'text-[#FF3B6B]'
                }
              >
                {analytics.currentBalanceSol} SOL ({analytics.netReturnPct >= 0 ? '+' : ''}
                {analytics.netReturnPct}%)
              </strong>
            </div>
            <button
              type="button"
              onClick={() => {
                if (paperResetToZero) {
                  setPaperResetToZero(false);
                } else {
                  setConfig((c) => ({ ...c, accountBalanceSol: DEFAULT_STRATEGY_CONFIG.accountBalanceSol }));
                  setPaperResetToZero(true);
                }
              }}
              className="px-3 py-1.5 rounded-xl border border-white/10 bg-slate-950/60 text-xs font-medium text-slate-200 hover:bg-white/10 cursor-pointer"
            >
              {paperResetToZero ? 'Load Sample Curve' : 'Reset Paper (Bal/PnL/DD)'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 pt-3 border-t border-white/10">
          <div>
            <div className="text-xs text-slate-400">Starting Balance</div>
            <div className="text-xl font-mono font-semibold text-white tabular-nums">
              {analytics.initialBalanceSol} SOL
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Current Balance</div>
            <div className="text-xl font-mono font-semibold text-[#00FFA3] tabular-nums">
              {analytics.currentBalanceSol} SOL
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Peak Balance</div>
            <div className="text-xl font-mono font-semibold text-white tabular-nums">
              {analytics.peakBalanceSol} SOL
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Win Rate · PF</div>
            <div className="text-xl font-mono font-semibold text-white tabular-nums">
              {analytics.winRatePct}% · {analytics.profitFactor}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Max Balance DD</div>
            <div className="text-xl font-mono font-semibold text-[#FF3B6B] tabular-nums">
              -{analytics.maxDrawdownSol} SOL ({analytics.maxDrawdownPct}%)
            </div>
          </div>
        </div>

        {/* Balance Curve SVG + Balance Ledger Table */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-[#05070B] rounded-xl p-4 border border-white/10">
            <div className="text-xs font-mono text-slate-400 mb-2">
              Account Balance Curve (SOL) — Risking {config.riskPerTradePct}% per Trade
            </div>
            <svg
              viewBox={`0 0 ${balanceChartGeometry.width} ${balanceChartGeometry.height}`}
              className="w-full h-40 overflow-visible"
              role="img"
              aria-label="Account Balance Curve in SOL"
            >
              <path d={balanceChartGeometry.areaPath} fill="rgba(0, 255, 163, 0.16)" />
              <path
                d={balanceChartGeometry.linePath}
                fill="none"
                stroke="#00FFA3"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {balanceChartGeometry.coords.map((pt) => (
                <g key={pt.index}>
                  <circle cx={pt.x} cy={pt.y} r="4.5" fill="#00FFA3" stroke="#07090E" strokeWidth="1.5" />
                  <text
                    x={pt.x}
                    y={pt.y - 10}
                    textAnchor="middle"
                    fill="#e2e8f0"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {pt.balanceSol.toFixed(2)}
                  </text>
                  <text
                    x={pt.x}
                    y={balanceChartGeometry.height - 2}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    {pt.symbol}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <div className="lg:col-span-5 overflow-hidden border border-white/10 rounded-xl bg-slate-950/60">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/80 border-b border-white/10 text-slate-400 font-medium">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">Token</th>
                  <th className="py-2 px-3 text-right">Trade Delta</th>
                  <th className="py-2 px-3 text-right">Account Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 font-mono">
                {analytics.balanceCurve.map((row) => (
                  <tr key={row.index} className="hover:bg-white/5">
                    <td className="py-2 px-3 text-slate-400 tabular-nums">{row.index}</td>
                    <td className="py-2 px-3 font-semibold text-white">{row.symbol}</td>
                    <td
                      className={`py-2 px-3 text-right tabular-nums ${
                        row.pnlSol > 0
                          ? 'text-[#00FFA3]'
                          : row.pnlSol < 0
                            ? 'text-[#FF3B6B]'
                            : 'text-slate-500'
                      }`}
                    >
                      {row.index === 0
                        ? '—'
                        : `${row.pnlSol >= 0 ? '+' : ''}${row.pnlSol.toFixed(4)} SOL`}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-white tabular-nums">
                      {row.balanceSol.toFixed(4)} SOL
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
