import type { DexSource } from './quantEngine';

export type NetworkInterfaceKind = 'WIFI' | 'CELLULAR_4G' | 'UNKNOWN';
export type NetworkPolicyMode = 'WIFI_ONLY_LOCK' | 'ALLOW_4G_ULTRA_SAVER';
export type NetworkSourceOverride = 'AUTO' | 'FORCE_WIFI' | 'FORCE_4G';

export interface BrowserConnectionLike {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
}

export interface NetworkPolicyDecision {
  detectedKind: NetworkInterfaceKind;
  effectiveKind: 'WIFI' | 'CELLULAR_4G' | 'OFFLINE';
  scanningAllowed: boolean;
  pausedReason: string | null;
  useCompactPayload: boolean;
  pollIntervalMs: number;
  feedLimit: number;
  prefetchHeavyAssets: boolean;
}

export interface DataUsageStats {
  bytesUsed: number;
  bytesSaved: number;
  requestsCount: number;
  notModified304Count: number;
}

export interface LiveTokenSnapshot {
  mint: string;
  symbol: string;
  name: string;
  dex: DexSource;
  poolAddress: string;
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  fdvUsd: number;
  m5Buys: number;
  m5Sells: number;
  m5VolumeUsd: number;
  h1VolumeUsd: number;
  priceChangeM5Pct: number;
  ageMinutes: number;
  updatedAt: number;
}

export function detectBrowserNetworkInterface(
  conn?: BrowserConnectionLike | null,
): NetworkInterfaceKind {
  if (!conn) return 'UNKNOWN';
  const rawType = (conn.type ?? '').toLowerCase();
  if (rawType === 'wifi' || rawType === 'ethernet') {
    return 'WIFI';
  }
  if (rawType === 'cellular' || rawType === 'wimax' || rawType === 'bluetooth') {
    return 'CELLULAR_4G';
  }
  if (conn.saveData) {
    return 'CELLULAR_4G';
  }
  const eff = (conn.effectiveType ?? '').toLowerCase();
  if (eff === 'slow-2g' || eff === '2g' || eff === '3g') {
    return 'CELLULAR_4G';
  }
  // Desktop Chrome reports effectiveType='4g', downlink=10, type=undefined on wired/Wi-Fi.
  // Only classify undefined-type 4g as cellular when downlink is clearly mobile-throttled (< 3.5 Mbps).
  if (eff === '4g' && typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 3.5) {
    return 'CELLULAR_4G';
  }
  return 'UNKNOWN';
}

export function resolveEffectiveNetworkPolicy(params: {
  policyMode: NetworkPolicyMode;
  detectedKind: NetworkInterfaceKind;
  override: NetworkSourceOverride;
  isOnline: boolean;
}): NetworkPolicyDecision {
  if (!params.isOnline) {
    return {
      detectedKind: params.detectedKind,
      effectiveKind: 'OFFLINE',
      scanningAllowed: false,
      pausedReason: 'Thiết bị đang Offline — đã tạm dừng toàn bộ request mạng.',
      useCompactPayload: true,
      pollIntervalMs: 0,
      feedLimit: 5,
      prefetchHeavyAssets: false,
    };
  }

  let effectiveKind: 'WIFI' | 'CELLULAR_4G';
  if (params.override === 'FORCE_4G') {
    effectiveKind = 'CELLULAR_4G';
  } else if (params.override === 'FORCE_WIFI') {
    effectiveKind = 'WIFI';
  } else {
    // On iOS Safari where Network Information API is hidden ('UNKNOWN'), treat as WIFI unless user taps 4G or device sets cellular
    effectiveKind = params.detectedKind === 'CELLULAR_4G' ? 'CELLULAR_4G' : 'WIFI';
  }

  if (effectiveKind === 'CELLULAR_4G') {
    if (params.policyMode === 'WIFI_ONLY_LOCK') {
      return {
        detectedKind: params.detectedKind,
        effectiveKind: 'CELLULAR_4G',
        scanningAllowed: false,
        pausedReason:
          'Phát hiện mạng 4G/Di động — Chế độ Chỉ Wi-Fi đang khóa quét nền (0 KB tốn dung lượng).',
        useCompactPayload: true,
        pollIntervalMs: 0,
        feedLimit: 5,
        prefetchHeavyAssets: false,
      };
    }

    return {
      detectedKind: params.detectedKind,
      effectiveKind: 'CELLULAR_4G',
      scanningAllowed: true,
      pausedReason: null,
      useCompactPayload: true,
      pollIntervalMs: 45_000,
      feedLimit: 5,
      prefetchHeavyAssets: false,
    };
  }

  return {
    detectedKind: params.detectedKind,
    effectiveKind: 'WIFI',
    scanningAllowed: true,
    pausedReason: null,
    useCompactPayload: false,
    pollIntervalMs: 8_000,
    feedLimit: 10,
    prefetchHeavyAssets: true,
  };
}

export function createInitialDataUsage(): DataUsageStats {
  return {
    bytesUsed: 0,
    bytesSaved: 0,
    requestsCount: 0,
    notModified304Count: 0,
  };
}

export function recordDataUsage(
  prev: DataUsageStats,
  bytesTransferred: number,
  fullEquivalentBytes: number,
  was304 = false,
): DataUsageStats {
  const safeTransferred = Math.max(0, Math.round(bytesTransferred));
  const safeFull = Math.max(safeTransferred, Math.round(fullEquivalentBytes));
  const saved = Math.max(0, safeFull - safeTransferred);
  return {
    bytesUsed: prev.bytesUsed + safeTransferred,
    bytesSaved: prev.bytesSaved + saved,
    requestsCount: prev.requestsCount + 1,
    notModified304Count: prev.notModified304Count + (was304 ? 1 : 0),
  };
}

export function formatBytesCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const COMPACT_DEX_MAP: DexSource[] = [
  'RAYDIUM_V4',
  'RAYDIUM_CPMM',
  'PUMP_FUN',
  'METEORA_DLMM',
];

export function decodeCompactLiveFeed(raw: unknown): {
  source: string;
  tokens: LiveTokenSnapshot[];
} {
  if (!raw || typeof raw !== 'object') {
    return { source: 'EMPTY', tokens: [] };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.c === 1 && Array.isArray(obj.r)) {
    const now = Date.now();
    const tokens: LiveTokenSnapshot[] = [];
    for (const row of obj.r) {
      if (!Array.isArray(row) || row.length < 9) continue;
      const dexIdx = Number(row[2] ?? 0);
      const liq = Number(row[3] ?? 0);
      const vol5 = Number(row[8] ?? 0);
      tokens.push({
        mint: String(row[0] ?? ''),
        symbol: String(row[1] ?? 'SOL'),
        name: String(row[1] ?? 'SOL'),
        dex: COMPACT_DEX_MAP[dexIdx] ?? 'RAYDIUM_V4',
        poolAddress: String(row[0] ?? ''),
        priceSol: Number(row[7] ?? 0.00001),
        priceUsd: Number(row[7] ?? 0.00001) * 150,
        liquidityUsd: liq,
        fdvUsd: liq * 6,
        m5Buys: Number(row[4] ?? 0),
        m5Sells: Number(row[5] ?? 0),
        m5VolumeUsd: vol5,
        h1VolumeUsd: vol5 * 5,
        priceChangeM5Pct: Number(row[6] ?? 0),
        ageMinutes: 12,
        updatedAt: now,
      });
    }
    return {
      source: obj.src === 1 ? '4G_COMPACT_LIVE' : '4G_COMPACT_SANDBOX',
      tokens,
    };
  }

  const tokens = Array.isArray(obj.tokens) ? (obj.tokens as LiveTokenSnapshot[]) : [];
  return {
    source: typeof obj.source === 'string' ? obj.source : 'LIVE_FEED',
    tokens,
  };
}
