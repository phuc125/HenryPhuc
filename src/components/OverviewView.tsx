import { ArrowRight, Download, ShieldCheck, Terminal, Zap } from 'lucide-react';
import type { BotProjectTree } from '../types/studio';

interface OverviewViewProps {
  project: BotProjectTree | null;
  loading: boolean;
  onNavigate: (tab: 'scanner' | 'backtest' | 'wallet' | 'strategy' | 'explorer' | 'guide') => void;
  onDownloadZip: () => void;
}

const DEX_STREAMS = [
  {
    dex: 'Raydium AMM V4',
    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    trigger: 'initialize2 / InitializeInstruction2',
    commitment: 'processed',
    route: 'Direct Raydium / Jupiter V6',
  },
  {
    dex: 'Raydium CPMM',
    programId: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
    trigger: 'Instruction: Initialize',
    commitment: 'processed',
    route: 'Raydium SDK V2 Direct Swap',
  },
  {
    dex: 'Pump.fun',
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    trigger: 'Migration (Create disabled by default)',
    commitment: 'processed',
    route: 'Jupiter V6 + Jito Bundle',
  },
  {
    dex: 'Meteora DLMM',
    programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
    trigger: 'InitializeLbPair / Customizable',
    commitment: 'processed',
    route: 'Jupiter V6 + Jito Bundle',
  },
];

const ANTI_RUG_LAYERS = [
  {
    id: 'L1',
    name: 'On-Chain Authority & Token-2022',
    target: 'MintLayout + TLV Extensions',
    rule: 'Mint/Freeze revoked & no PermanentDelegate/Fee hook',
    latency: '~40ms',
  },
  {
    id: 'L2',
    name: 'LP Burn & Lock Verification',
    target: 'Burn Wallets + RugCheck Fallback',
    rule: 'Burned / Locked LP >= MIN_LP_BURNED_PCT (90%)',
    latency: '~65ms',
  },
  {
    id: 'L3',
    name: 'Holder & Creator Blacklist',
    target: 'getTokenLargestAccounts + SQLite',
    rule: 'Top 10 < 32%, Dev < 6%, Creator not in Rug Blacklist',
    latency: '~75ms',
  },
  {
    id: 'L4',
    name: 'Block-0 Anti-Bundle Detector',
    target: 'Jito Bundle Slot Scan',
    rule: 'Coordinated Block-0 accumulation <= 30% supply',
    latency: '~95ms',
  },
  {
    id: 'L5',
    name: 'RugCheck.xyz & Honeypot Sim',
    target: 'API (1600ms) + 2-Way Quote & Sim',
    rule: 'No Danger flags + live sell route & spread <= 12%',
    latency: '~240ms',
  },
];

export function OverviewView({
  project,
  loading,
  onNavigate,
  onDownloadZip,
}: OverviewViewProps) {
  return (
    <div className="space-y-8">
      {/* Hero Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch glass-panel rounded-xl p-6 sm:p-8">
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <p className="text-xs font-mono font-medium text-[#00FFA3]">
              Solana TypeScript Autonomous AI-Quant Trading System (v7) · Paper &amp; Live Execution
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white text-balance">
              Autonomous AI-Quant Solana Multi-DEX Sniper Bot
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              Kiến trúc Quant &amp; AI hoàn chỉnh với <strong className="text-white">10 module mới + 14 module nâng cấp</strong>{' '}
              chạy ngay không cần RPC trả phí qua{' '}
              <code className="text-xs font-mono bg-slate-950/80 border border-white/10 text-[#00FFA3] px-1.5 py-0.5 rounded">DISCOVERY_MODE=FREE_FEED</code>.
              Tích hợp <strong className="text-white">AI Prediction Engine</strong>,{' '}
              <strong className="text-white">Smart Money &amp; Sybil Detection</strong>,{' '}
              <strong className="text-white">Chiến lược Vốn nhỏ High-PF</strong> tối ưu hóa Profit Factor cho tài khoản nhỏ,{' '}
              <strong className="text-white">Walk-Forward Backtest + Monte Carlo</strong>, cơ chế chống 429 đa tầng và{' '}
              <strong className="text-white">Auto Rent Reclaim / Cold Wallet Sweep</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onDownloadZip}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#00FFA3] to-emerald-400 text-slate-950 text-sm font-bold hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download .zip Package
            </button>
            <button
              type="button"
              onClick={() => onNavigate('explorer')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10 bg-slate-950/60 text-slate-200 text-sm font-medium hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Browse Source Files
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('guide')}
              className="text-sm font-medium text-[#00FFA3] hover:underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer px-2"
            >
              Hướng Dẫn A–Z
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 lg:border-l lg:border-white/10 lg:pl-8 flex flex-col justify-between space-y-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-white">Execution &amp; Delivery Package</h2>
            <p className="text-xs text-slate-400">
              Strict TypeScript build with zero stubbed methods or TODO placeholders.
            </p>
          </div>

          <dl className="divide-y divide-white/10 text-sm">
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-400">Packaged Source Files</dt>
              <dd className="font-mono font-semibold text-white tabular-nums">
                {loading ? '...' : `${project?.fileCount ?? 30} files`}
              </dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-400">Total Lines of Code</dt>
              <dd className="font-mono font-semibold text-white tabular-nums">
                {loading ? '...' : `${project?.totalLines.toLocaleString() ?? '6,500+'} LOC`}
              </dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-400">6-Stage Quant Pipeline</dt>
              <dd className="font-mono font-semibold text-[#00FFA3] text-xs">Scanner → Security → AI → Entry → Risk → Exec</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-400">Small-Capital PF Edge</dt>
              <dd className="font-mono font-semibold text-[#00FFA3] text-xs">Fee-Drag Cap + +3.5% BE Lock</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-400">Feature Toggles &amp; Treasury</dt>
              <dd className="font-mono font-medium text-slate-200 text-xs">27 Toggles · Rent Reclaim &amp; Cold Sweep</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-400">Execution Modes</dt>
              <dd className="font-mono font-medium text-[#00FFA3] text-xs">PAPER + LIVE + OTA</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Dual Execution Mode Comparison */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#F59E0B]" />
              Paper Simulation Mode
            </h2>
            <span className="text-xs font-mono font-medium text-[#F59E0B]">TRADING_MODE=PAPER</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Runs seamlessly without any paid RPC subscription via{' '}
            <code className="text-xs font-mono bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-slate-200">FREE_FEED</code>{' '}
            (GeckoTerminal + DexScreener + RugCheck), auto-sizes every buy from risk % of current balance, defends against wash-trades &amp; blacklisted devs, and plots live Equity growth.
          </p>
        </div>

        <div className="glass-panel rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#00FFA3]" />
              Live Mainnet Execution
            </h2>
            <span className="text-xs font-mono font-medium text-[#00FFA3]">TRADING_MODE=LIVE</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Routes orders across Direct Raydium AMM V4 &amp; CPMM SDK → Jupiter V6 → Jupiter Lite
            multi-route fallback, injects dynamic Jito floor tips by urgency, verifies post-buy token
            balances, and reconciles actual on-chain SOL fills &amp; slippage drift per trade.
          </p>
        </div>
      </section>

      {/* Concurrent Multi-DEX Listeners Table */}
      <section className="glass-panel rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              Multi-DEX Discovery (Free Feed + Optional WebSocket)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Zero-RPC-Plan rotating scanner (DexScreener ↔ GeckoTerminal 8s interval, tự động Failover khi 1 nguồn dính 429) + Pre-filter thanh khoản trước Audit.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('strategy')}
            className="text-xs font-medium text-[#00FFA3] hover:underline underline-offset-4 cursor-pointer"
          >
            Test Strategy &amp; Balance Lab
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-950/60 text-xs font-medium text-slate-400">
                <th className="py-2.5 px-6">DEX Stream</th>
                <th className="py-2.5 px-4">On-Chain Program ID</th>
                <th className="py-2.5 px-4">Trigger Instruction</th>
                <th className="py-2.5 px-4">Commitment</th>
                <th className="py-2.5 px-6">Execution Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {DEX_STREAMS.map((row) => (
                <tr key={row.dex} className="hover:bg-white/5 transition-colors">
                  <td className="py-3 px-6 font-medium text-white whitespace-nowrap">
                    {row.dex}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-400 tabular-nums">{row.programId}</td>
                  <td className="py-3 px-4 text-slate-300">{row.trigger}</td>
                  <td className="py-3 px-4 font-mono text-xs text-[#00FFA3]">{row.commitment}</td>
                  <td className="py-3 px-6 text-slate-300">{row.route}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5-Layer Anti-Rug Architecture Table */}
      <section className="glass-panel rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#00FFA3]" />
            <div>
              <h2 className="text-base font-semibold text-white">
                5-Layer Parallel Anti-Rug Pipeline
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Balanced verification executed via Promise.allSettled before every Paper or Live entry.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('backtest')}
            className="text-xs font-medium text-[#00FFA3] hover:underline underline-offset-4 cursor-pointer"
          >
            Mở Backtest Thời Gian Thực
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-950/60 text-xs font-medium text-slate-400">
                <th className="py-2.5 px-6">Layer</th>
                <th className="py-2.5 px-4">Verification Module</th>
                <th className="py-2.5 px-4">Inspection Target</th>
                <th className="py-2.5 px-4">Pass Threshold</th>
                <th className="py-2.5 px-6 text-right">Target Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {ANTI_RUG_LAYERS.map((layer) => (
                <tr key={layer.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-3 px-6 font-mono font-semibold text-[#00FFA3]">{layer.id}</td>
                  <td className="py-3 px-4 font-medium text-white">{layer.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-400">{layer.target}</td>
                  <td className="py-3 px-4 text-slate-300">{layer.rule}</td>
                  <td className="py-3 px-6 text-right font-mono text-slate-300 tabular-nums">
                    {layer.latency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* v7 10 New Quant & AI Modules Grid */}
      <section className="glass-panel rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              v7 AI-Quant Architecture: 10 New Specialized Modules
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tách module độc lập, dữ liệu minh bạch và kiểm thử Walk-Forward OOS trước khi triển khai Live.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('explorer')}
            className="text-xs font-medium text-[#00FFA3] hover:underline underline-offset-4 cursor-pointer"
          >
            Inspect All Modules in Source Explorer
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 p-6">
          {[
            { path: 'src/ai/', title: 'AI Token Intelligence', desc: 'Logistic P(pump)/P(rug), Calibration & Token Ranking' },
            { path: 'src/smartmoney/', title: 'Smart Money Intel', desc: 'Wallet Ranking, Clustering & Insider/Creator Alerts' },
            { path: 'src/market/', title: 'Market Regime', desc: 'Bull/Bear/Sideways/Vol & Auto Strategy Selection' },
            { path: 'src/strategy/entryEngine.ts', title: 'Adaptive Entry', desc: '5 Strategies + Multi-Timeframe & Slippage Guard' },
            { path: 'src/backtesting/', title: 'Backtesting Engine', desc: 'Fees/Slippage Model, Monte Carlo & Counterfactuals' },
            { path: 'src/optimization/', title: 'Strategy Optimizer', desc: 'Strict Chronological IS/OOS Walk-Forward Search' },
            { path: 'src/learning/', title: 'Continuous Learning', desc: 'Brier Score, Drift Detection & Gated Candidate Retrain' },
            { path: 'src/social/', title: 'Social & Narrative', desc: 'Narrative Classifier, Social Score & Fake Engagement' },
            { path: 'src/analytics/performance.ts', title: 'Perf Analytics', desc: 'Live vs Paper, Expectancy, Slippage & Latency Stats' },
            { path: 'src/agents/', title: 'Autonomous Agents', desc: 'Regime, Horizon 1m–24h Collector & Drift Monitors' },
          ].map((mod) => (
            <div key={mod.path} className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5 space-y-1.5">
              <div className="font-mono text-[11px] font-semibold text-[#00FFA3] truncate">
                {mod.path}
              </div>
              <div className="text-xs font-semibold text-white">{mod.title}</div>
              <p className="text-[11px] text-slate-400 leading-snug">{mod.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
