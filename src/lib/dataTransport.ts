import type { DexSource } from './quantEngine';
import type { LiveTokenSnapshot } from './networkPolicy';

export type DataTransportMode = 'AUTO' | 'CUSTOM_SERVER' | 'DIRECT_ONCHAIN';

export interface DataTransportConfig {
  mode: DataTransportMode;
  serverUrl: string;
  rpcUrl: string;
}

export interface TransportPingResult {
  ok: boolean;
  resolvedMode: 'WEB_ORIGIN' | 'CUSTOM_SERVER' | 'DIRECT_ONCHAIN';
  latencyMs: number;
  message: string;
}

export const TRANSPORT_STORAGE_KEY = 'solsniper_transport_v1';
export const DEFAULT_SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';
export const FALLBACK_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

export const DEFAULT_DATA_TRANSPORT_CONFIG: DataTransportConfig = {
  mode: 'AUTO',
  serverUrl: '',
  rpcUrl: DEFAULT_SOLANA_RPC_URL,
};

const EXCLUDED_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);
const EXCLUDED_SYMBOLS = new Set(['SOL', 'WSOL', 'USDC', 'USDT']);

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed || /\s/.test(trimmed)) return '';
  const withScheme = /^wss?:\/\//i.test(trimmed)
    ? trimmed.replace(/^ws/i, 'http')
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return '';
    }
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
  } catch {
    return '';
  }
}

export function validateHttpEndpoint(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }
  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      error: 'URL không được chứa khoảng trắng. Ví dụ: https://solana-rpc.publicnode.com',
    };
  }
  const normalized = normalizeServerUrl(trimmed);
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: 'URL không hợp lệ. Vui lòng nhập đúng định dạng https://domain.com',
    };
  }
  return { valid: true, normalized };
}

export function formatTransportErrorMessage(err: unknown, fallback = 'Timeout / CORS'): string {
  const raw = err instanceof Error ? err.message : '';
  if (!raw) return fallback;
  if (/expected pattern|invalid url/i.test(raw)) {
    return 'URL hoặc phản hồi JSON không hợp lệ (hãy kiểm tra lại Server URL / RPC Endpoint).';
  }
  return raw;
}

export function loadDataTransportConfig(): DataTransportConfig {
  try {
    const raw = localStorage.getItem(TRANSPORT_STORAGE_KEY);
    if (!raw) return DEFAULT_DATA_TRANSPORT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<DataTransportConfig>;
    return {
      mode:
        parsed.mode === 'CUSTOM_SERVER' || parsed.mode === 'DIRECT_ONCHAIN'
          ? parsed.mode
          : 'AUTO',
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '',
      rpcUrl:
        typeof parsed.rpcUrl === 'string' && parsed.rpcUrl.trim()
          ? parsed.rpcUrl.trim()
          : DEFAULT_SOLANA_RPC_URL,
    };
  } catch {
    return DEFAULT_DATA_TRANSPORT_CONFIG;
  }
}

export function saveDataTransportConfig(cfg: DataTransportConfig): void {
  try {
    localStorage.setItem(TRANSPORT_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage quota errors
  }
}

export function resolveEffectiveTransport(
  cfg: DataTransportConfig,
  isNativeCapacitor: boolean,
): {
  resolvedMode: 'WEB_ORIGIN' | 'CUSTOM_SERVER' | 'DIRECT_ONCHAIN';
  baseUrl: string;
} {
  const cleanServer = normalizeServerUrl(cfg.serverUrl);
  if (cfg.mode === 'DIRECT_ONCHAIN') {
    return { resolvedMode: 'DIRECT_ONCHAIN', baseUrl: '' };
  }
  if (cfg.mode === 'CUSTOM_SERVER') {
    if (cleanServer) {
      return { resolvedMode: 'CUSTOM_SERVER', baseUrl: cleanServer };
    }
    return isNativeCapacitor
      ? { resolvedMode: 'DIRECT_ONCHAIN', baseUrl: '' }
      : { resolvedMode: 'WEB_ORIGIN', baseUrl: '' };
  }
  // AUTO mode
  if (isNativeCapacitor) {
    return cleanServer
      ? { resolvedMode: 'CUSTOM_SERVER', baseUrl: cleanServer }
      : { resolvedMode: 'DIRECT_ONCHAIN', baseUrl: '' };
  }
  return cleanServer
    ? { resolvedMode: 'CUSTOM_SERVER', baseUrl: cleanServer }
    : { resolvedMode: 'WEB_ORIGIN', baseUrl: '' };
}

function mapDexId(raw?: string): DexSource {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('meteora')) return 'METEORA_DLMM';
  if (lower.includes('pump')) return 'PUMP_FUN';
  if (lower.includes('cpmm')) return 'RAYDIUM_CPMM';
  return 'RAYDIUM_V4';
}

function rankMemecoins(tokens: LiveTokenSnapshot[], limit: number): LiveTokenSnapshot[] {
  const dedup = new Map<string, LiveTokenSnapshot>();
  for (const t of tokens) {
    if (!t.mint || EXCLUDED_MINTS.has(t.mint)) continue;
    if (EXCLUDED_SYMBOLS.has(t.symbol.toUpperCase())) continue;
    if (t.liquidityUsd < 3500) continue;
    if (t.m5Buys <= 0 && t.m5VolumeUsd < 250) continue;
    const prev = dedup.get(t.mint);
    if (!prev || t.m5VolumeUsd > prev.m5VolumeUsd) {
      dedup.set(t.mint, t);
    }
  }
  return Array.from(dedup.values())
    .sort((a, b) => {
      const aSweet = a.liquidityUsd >= 4000 && a.liquidityUsd <= 500_000 ? 1 : 0;
      const bSweet = b.liquidityUsd >= 4000 && b.liquidityUsd <= 500_000 ? 1 : 0;
      if (aSweet !== bSweet) return bSweet - aSweet;
      return b.m5Buys * 120 + b.m5VolumeUsd - (a.m5Buys * 120 + a.m5VolumeUsd);
    })
    .slice(0, limit);
}

export async function fetchDirectSolanaFeed(
  limit: number,
  fetchFn: typeof fetch = fetch,
): Promise<{
  source: string;
  tokens: LiveTokenSnapshot[];
  bytesTransferred: number;
}> {
  let bytesTransferred = 0;

  try {
    const boostsRes = await fetchFn('https://api.dexscreener.com/token-boosts/latest/v1');
    if (boostsRes.ok) {
      const boostsText = await boostsRes.text();
      bytesTransferred += new Blob([boostsText]).size;
      const boosts = JSON.parse(boostsText) as Array<{
        chainId?: string;
        tokenAddress?: string;
      }>;
      const mints = Array.from(
        new Set(
          (Array.isArray(boosts) ? boosts : [])
            .filter(
              (b) =>
                b.chainId === 'solana' && b.tokenAddress && !EXCLUDED_MINTS.has(b.tokenAddress),
            )
            .map((b) => b.tokenAddress as string),
        ),
      ).slice(0, 14);

      if (mints.length > 0) {
        const pairsRes = await fetchFn(
          `https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`,
        );
        if (pairsRes.ok) {
          const pairsText = await pairsRes.text();
          bytesTransferred += new Blob([pairsText]).size;
          const json = JSON.parse(pairsText) as {
            pairs?: Array<{
              chainId?: string;
              dexId?: string;
              pairAddress?: string;
              baseToken?: { address?: string; symbol?: string; name?: string };
              priceUsd?: string;
              priceNative?: string;
              liquidity?: { usd?: number };
              fdv?: number;
              txns?: { m5?: { buys?: number; sells?: number } };
              volume?: { m5?: number; h1?: number };
              priceChange?: { m5?: number };
              pairCreatedAt?: number;
            }>;
          };
          const now = Date.now();
          const mapped: LiveTokenSnapshot[] = (json.pairs ?? [])
            .filter((p) => p.chainId === 'solana' && p.baseToken?.address)
            .map((p) => ({
              mint: p.baseToken?.address ?? '',
              symbol: (p.baseToken?.symbol ?? 'MEME').slice(0, 12),
              name: (p.baseToken?.name ?? p.baseToken?.symbol ?? 'Solana Token').slice(0, 28),
              dex: mapDexId(p.dexId),
              poolAddress: p.pairAddress ?? p.baseToken?.address ?? '',
              priceUsd: Number(p.priceUsd ?? 0) || 0.001,
              priceSol: Number(p.priceNative ?? 0) || 0.00001,
              liquidityUsd: Math.round(p.liquidity?.usd ?? 0),
              fdvUsd: Math.round(p.fdv ?? (p.liquidity?.usd ?? 0) * 6),
              m5Buys: p.txns?.m5?.buys ?? 0,
              m5Sells: p.txns?.m5?.sells ?? 0,
              m5VolumeUsd: Math.round(p.volume?.m5 ?? 0),
              h1VolumeUsd: Math.round(p.volume?.h1 ?? 0),
              priceChangeM5Pct: Number((p.priceChange?.m5 ?? 0).toFixed(2)),
              ageMinutes: p.pairCreatedAt
                ? Math.max(1, Math.round((now - p.pairCreatedAt) / 60_000))
                : 15,
              updatedAt: now,
            }));
          const ranked = rankMemecoins(mapped, limit);
          if (ranked.length > 0) {
            return { source: 'DIRECT_DEXSCREENER', tokens: ranked, bytesTransferred };
          }
        }
      }
    }
  } catch {
    // Fallback to GeckoTerminal direct
  }

  const geckoRes = await fetchFn(
    'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1',
  );
  if (!geckoRes.ok) {
    throw new Error(`Direct feed HTTP ${geckoRes.status}`);
  }
  const geckoText = await geckoRes.text();
  bytesTransferred += new Blob([geckoText]).size;
  const geckoJson = JSON.parse(geckoText) as {
    data?: Array<{
      attributes?: {
        address?: string;
        name?: string;
        base_token_price_usd?: string;
        base_token_price_native_currency?: string;
        reserve_in_usd?: string;
        fdv_usd?: string;
        pool_created_at?: string;
        price_change_percentage?: { m5?: string };
        volume_usd?: { m5?: string; h1?: string };
        transactions?: { m5?: { buys?: number; sells?: number } };
      };
      relationships?: {
        dex?: { data?: { id?: string } };
        base_token?: { data?: { id?: string } };
      };
    }>;
  };
  const now = Date.now();
  const geckoMapped: LiveTokenSnapshot[] = (geckoJson.data ?? []).map((item) => {
    const attr = item.attributes ?? {};
    const mint = (item.relationships?.base_token?.data?.id ?? '').replace(/^solana_/, '');
    const symbol = ((attr.name ?? 'TOKEN / SOL').split('/')[0] ?? 'MEME').trim().slice(0, 12);
    const liq = Math.round(Number(attr.reserve_in_usd ?? 0));
    const createdMs = attr.pool_created_at ? Date.parse(attr.pool_created_at) : now - 600_000;
    return {
      mint: mint || attr.address || '',
      symbol,
      name: symbol,
      dex: mapDexId(item.relationships?.dex?.data?.id),
      poolAddress: attr.address ?? '',
      priceUsd: Number(attr.base_token_price_usd ?? 0) || 0.001,
      priceSol: Number(attr.base_token_price_native_currency ?? 0) || 0.00001,
      liquidityUsd: liq,
      fdvUsd: Math.round(Number(attr.fdv_usd ?? liq * 5)),
      m5Buys: attr.transactions?.m5?.buys ?? 0,
      m5Sells: attr.transactions?.m5?.sells ?? 0,
      m5VolumeUsd: Math.round(Number(attr.volume_usd?.m5 ?? 0)),
      h1VolumeUsd: Math.round(Number(attr.volume_usd?.h1 ?? 0)),
      priceChangeM5Pct: Number(Number(attr.price_change_percentage?.m5 ?? 0).toFixed(2)),
      ageMinutes: Math.max(1, Math.round((now - createdMs) / 60_000)),
      updatedAt: now,
    };
  });

  return {
    source: 'DIRECT_GECKOTERMINAL',
    tokens: rankMemecoins(geckoMapped, limit),
    bytesTransferred,
  };
}

export async function fetchDirectSolBalance(
  address: string,
  rpcUrl: string = DEFAULT_SOLANA_RPC_URL,
  fetchFn: typeof fetch = fetch,
): Promise<{ address: string; sol: number; source: string; bytesTransferred: number }> {
  const safeCustom = normalizeServerUrl(rpcUrl);
  const candidates = Array.from(
    new Set([safeCustom || DEFAULT_SOLANA_RPC_URL, FALLBACK_SOLANA_RPC_URL]),
  );
  let bytesTransferred = 0;

  for (const endpoint of candidates) {
    try {
      const resp = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address, { commitment: 'confirmed' }],
        }),
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      bytesTransferred += new Blob([text]).size;
      const json = JSON.parse(text) as { result?: { value?: number } };
      if (typeof json.result?.value === 'number') {
        return {
          address,
          sol: Number((json.result.value / 1_000_000_000).toFixed(5)),
          source: endpoint.includes('publicnode') ? 'DIRECT_PUBLICNODE_RPC' : 'DIRECT_SOLANA_RPC',
          bytesTransferred,
        };
      }
    } catch {
      // try fallback RPC
    }
  }
  return { address, sol: 0, source: 'RPC_UNREACHABLE', bytesTransferred };
}

export async function pingDataTransport(
  cfg: DataTransportConfig,
  isNativeCapacitor: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<TransportPingResult> {
  const serverCheck = validateHttpEndpoint(cfg.serverUrl);
  if (!serverCheck.valid) {
    return {
      ok: false,
      resolvedMode: 'CUSTOM_SERVER',
      latencyMs: 0,
      message: serverCheck.error ?? 'Server URL không hợp lệ.',
    };
  }

  const rpcCheck = validateHttpEndpoint(cfg.rpcUrl);
  if (!rpcCheck.valid) {
    return {
      ok: false,
      resolvedMode: 'DIRECT_ONCHAIN',
      latencyMs: 0,
      message: rpcCheck.error ?? 'RPC Endpoint không hợp lệ.',
    };
  }

  const { resolvedMode, baseUrl } = resolveEffectiveTransport(cfg, isNativeCapacitor);
  const started = Date.now();
  try {
    if (resolvedMode === 'DIRECT_ONCHAIN') {
      const rpcEndpoint = rpcCheck.normalized || DEFAULT_SOLANA_RPC_URL;
      const res = await fetchFn(rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return {
          ok: false,
          resolvedMode,
          latencyMs,
          message: `Solana RPC trả HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        resolvedMode,
        latencyMs,
        message: `Kết nối Direct DEX/RPC (${rpcEndpoint.replace(/^https?:\/\//, '')}) thành công (${latencyMs}ms)`,
      };
    }

    const res = await fetchFn(`${baseUrl}/api/health`);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        resolvedMode,
        latencyMs,
        message: `Server trả HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      resolvedMode,
      latencyMs,
      message:
        resolvedMode === 'CUSTOM_SERVER'
          ? `Kết nối Server (${baseUrl}) thành công (${latencyMs}ms · Hỗ trợ Compact 4G)`
          : `Kết nối Server gốc thành công (${latencyMs}ms)`,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    return {
      ok: false,
      resolvedMode,
      latencyMs,
      message: `Lỗi kết nối: ${formatTransportErrorMessage(err)}`,
    };
  }
}
