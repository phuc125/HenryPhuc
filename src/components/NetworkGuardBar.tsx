import { Signal, Wifi, WifiOff } from 'lucide-react';
import {
  DataUsageStats,
  formatBytesCompact,
  NetworkPolicyDecision,
  NetworkPolicyMode,
  NetworkSourceOverride,
} from '../lib/networkPolicy';

interface NetworkGuardBarProps {
  policyMode: NetworkPolicyMode;
  sourceOverride: NetworkSourceOverride;
  decision: NetworkPolicyDecision;
  usage: DataUsageStats;
  onChangePolicyMode: (mode: NetworkPolicyMode) => void;
  onChangeSourceOverride: (override: NetworkSourceOverride) => void;
}

export function NetworkGuardBar({
  policyMode,
  sourceOverride,
  decision,
  usage,
  onChangePolicyMode,
  onChangeSourceOverride,
}: NetworkGuardBarProps) {
  const isBlocked4G = !decision.scanningAllowed && decision.effectiveKind === 'CELLULAR_4G';
  const isSaver4G = decision.scanningAllowed && decision.effectiveKind === 'CELLULAR_4G';
  const totalEquivalent = usage.bytesUsed + usage.bytesSaved;
  const savedPct =
    totalEquivalent > 0 ? Math.round((usage.bytesSaved / totalEquivalent) * 100) : 0;

  return (
    <section
      aria-label="Kiểm soát Wi-Fi và Tối ưu 4G"
      className={`rounded-xl border backdrop-blur-xl px-4 py-3 transition-colors ${
        isBlocked4G
          ? 'bg-[#FF3B6B]/10 border-[#FF3B6B]/40'
          : isSaver4G
            ? 'bg-[#F59E0B]/10 border-[#F59E0B]/40'
            : 'bg-slate-900/45 border-white/10'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
              isBlocked4G
                ? 'bg-[#FF3B6B]/15 border-[#FF3B6B]/40 text-[#FF3B6B]'
                : isSaver4G
                  ? 'bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#F59E0B]'
                  : 'bg-[#00FFA3]/15 border-[#00FFA3]/30 text-[#00FFA3]'
            }`}
          >
            {decision.effectiveKind === 'OFFLINE' ? (
              <WifiOff className="w-4 h-4" />
            ) : decision.effectiveKind === 'CELLULAR_4G' ? (
              <Signal className="w-4 h-4" />
            ) : (
              <Wifi className="w-4 h-4" />
            )}
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-slate-100">
              <span>
                {decision.effectiveKind === 'OFFLINE'
                  ? 'Mất kết nối mạng'
                  : decision.effectiveKind === 'CELLULAR_4G'
                    ? isBlocked4G
                      ? 'Đang dùng 4G — Tạm dừng (Chỉ Wi-Fi)'
                      : 'Đang dùng 4G — Tiết kiệm tối đa'
                    : 'Wi-Fi Guard (Full Speed)'}
              </span>
              <span className="font-mono text-[11px] font-medium text-slate-400 tabular-nums">
                {decision.scanningAllowed
                  ? `${Math.round(decision.pollIntervalMs / 1000)}s/tick · ${
                      decision.useCompactPayload ? 'Compact 4G (Top 5)' : 'Full Feed'
                    }`
                  : '0 KB/phút'}
              </span>
            </div>

            <div className="text-[11px] font-mono text-slate-400 tabular-nums">
              Đã dùng: <strong className="text-slate-200">{formatBytesCompact(usage.bytesUsed)}</strong>
              {' · '}
              Tiết kiệm: <strong className="text-[#00FFA3]">{formatBytesCompact(usage.bytesSaved)}</strong>
              {savedPct > 0 ? ` (-${savedPct}%)` : ''}
              {usage.notModified304Count > 0 ? ` · ${usage.notModified304Count}x 304 Cache` : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-950/70 border border-white/10 p-1">
            <button
              type="button"
              onClick={() => onChangePolicyMode('WIFI_ONLY_LOCK')}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                policyMode === 'WIFI_ONLY_LOCK'
                  ? 'bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Chỉ Wi-Fi
            </button>
            <button
              type="button"
              onClick={() => onChangePolicyMode('ALLOW_4G_ULTRA_SAVER')}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                policyMode === 'ALLOW_4G_ULTRA_SAVER'
                  ? 'bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              4G Tiết kiệm
            </button>
          </div>

          <div className="inline-flex rounded-xl bg-slate-950/70 border border-white/10 p-1">
            {(
              [
                { id: 'AUTO', label: 'Auto' },
                { id: 'FORCE_WIFI', label: 'Wi-Fi' },
                { id: 'FORCE_4G', label: '4G' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeSourceOverride(opt.id)}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  sourceOverride === opt.id
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {decision.pausedReason ? (
        <div className="mt-2.5 pt-2.5 border-t border-[#FF3B6B]/30 flex flex-wrap items-center justify-between gap-2 text-xs text-[#FF3B6B]">
          <span>{decision.pausedReason}</span>
          {isBlocked4G ? (
            <button
              type="button"
              onClick={() => onChangePolicyMode('ALLOW_4G_ULTRA_SAVER')}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#FF3B6B] text-white font-semibold hover:brightness-110 whitespace-nowrap cursor-pointer"
            >
              Bật Chế Độ 4G Siêu Tiết Kiệm
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
