import express from 'express';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_STRATEGY_CONFIG,
  evaluateTokenCandidate,
  StrategyConfig,
  TokenCandidateInput,
} from './src/lib/quantEngine';
import { buildDefaultOtaBundle, OTA_BUNDLE_VERSION } from './src/lib/otaHotUpdate';

interface ProjectFileEntry {
  path: string;
  name: string;
  sizeBytes: number;
  lines: number;
  content: string;
}

const BOT_ROOT = path.resolve(process.cwd(), 'solana-ai-sniper-bot');

function collectBotFiles(dir: string, prefix = ''): ProjectFileEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const results: ProjectFileEntry[] = [];
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'data' ||
      entry.name === '.rollback' ||
      entry.name === 'hot_updates'
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectBotFiles(fullPath, relPath));
    } else {
      const content = fs.readFileSync(fullPath, 'utf-8');
      results.push({
        path: relPath,
        name: entry.name,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        lines: content.split('\n').length,
        content,
      });
    }
  }
  return results;
}

async function buildZipBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  const rootFolder = zip.folder('solana-ai-sniper-bot');
  const files = collectBotFiles(BOT_ROOT);

  for (const file of files) {
    rootFolder?.file(file.path, file.content);
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

const IOS_KIT_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.playwright-cli',
  'data',
  '.rollback',
  'hot_updates',
  '.DerivedData',
]);

const IOS_KIT_SKIP_FILES = new Set(['solana-ai-sniper-bot.zip', 'SolSniperAI-Unsigned.ipa']);

function collectIosKitFiles(dir: string, prefix = ''): Array<{ path: string; data: Buffer }> {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const out: Array<{ path: string; data: Buffer }> = [];
  for (const entry of entries) {
    if (IOS_KIT_SKIP_DIRS.has(entry.name)) continue;
    if (!entry.isDirectory() && IOS_KIT_SKIP_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectIosKitFiles(fullPath, relPath));
    } else {
      out.push({ path: relPath, data: fs.readFileSync(fullPath) });
    }
  }
  return out;
}

async function buildIosKitZipBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  const rootFolder = zip.folder('solsniper-ai-ios-ipa-kit');
  const files = collectIosKitFiles(process.cwd());
  for (const file of files) {
    rootFolder?.file(file.path, file.data);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

function readBotPatchMap(): Record<string, string> {
  const targets = [
    'src/config/runtimeConfig.ts',
    'src/strategy/riskSizing.ts',
    'src/strategy/positionManager.ts',
  ];
  const patches: Record<string, string> = {};
  for (const rel of targets) {
    const abs = path.join(BOT_ROOT, rel);
    if (fs.existsSync(abs)) {
      patches[rel] = fs.readFileSync(abs, 'utf-8');
    }
  }
  return patches;
}

async function buildOtaBundleZipBuffer(): Promise<Buffer> {
  const patches = readBotPatchMap();
  const bundle = buildDefaultOtaBundle(patches);
  const zip = new JSZip();
  zip.file('solsniper-hotupdate-v2.2.json', JSON.stringify(bundle, null, 2));
  zip.file(
    'README-HOTUPDATE.md',
    [
      `# SolSniper AI Hot-Update Pack (${OTA_BUNDLE_VERSION})`,
      '',
      '## 1. Cập nhật nóng trực tiếp trong file .IPA cũ (không cần build lại Xcode)',
      '1. Mở app SolSniper trên iPhone -> bấm nút `.IPA / Hot-Update` ở góc phải trên cùng.',
      '2. Chọn tab **Hot-Update App .IPA cũ** -> bấm **Nạp file .json** và chọn `solsniper-hotupdate-v2.2.json`.',
      '3. Các thông số chiến lược Vốn nhỏ (High PF), TP1/SL và Jito Tip mới được kích hoạt ngay lập tức.',
      '',
      '## 2. Cập nhật nóng cho Server Bot (nếu đang nối VPS)',
      'Upload từng file `.ts` trong thư mục `bot-patches/` qua tab `Code/App -> Source & Hot-Update`, hoặc copy đè vào `solana-ai-sniper-bot/src/` rồi chạy `npm run build && pm2 restart solana-sniper`.',
    ].join('\n'),
  );
  const patchFolder = zip.folder('bot-patches');
  for (const [relPath, content] of Object.entries(patches)) {
    patchFolder?.file(relPath, content);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

interface LiveFeedToken {
  mint: string;
  symbol: string;
  name: string;
  dex: 'RAYDIUM_V4' | 'RAYDIUM_CPMM' | 'PUMP_FUN' | 'METEORA_DLMM';
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

const FALLBACK_SOLANA_TOKENS: LiveFeedToken[] = [
  {
    mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'SOLCAT',
    name: 'Solana Quant Cat',
    dex: 'RAYDIUM_V4',
    poolAddress: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
    priceUsd: 0.00428,
    priceSol: 0.0000285,
    liquidityUsd: 46800,
    fdvUsd: 428000,
    m5Buys: 38,
    m5Sells: 11,
    m5VolumeUsd: 11400,
    h1VolumeUsd: 52000,
    priceChangeM5Pct: 18.4,
    ageMinutes: 14,
    updatedAt: Date.now(),
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUPMEME',
    name: 'Jupiter Perp Pulse',
    dex: 'METEORA_DLMM',
    poolAddress: '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj',
    priceUsd: 0.0114,
    priceSol: 0.000076,
    liquidityUsd: 68500,
    fdvUsd: 1140000,
    m5Buys: 54,
    m5Sells: 19,
    m5VolumeUsd: 19200,
    h1VolumeUsd: 84000,
    priceChangeM5Pct: 12.1,
    ageMinutes: 27,
    updatedAt: Date.now(),
  },
  {
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: 'MEOWDL',
    name: 'Meteora Owl',
    dex: 'RAYDIUM_CPMM',
    poolAddress: '6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg',
    priceUsd: 0.00215,
    priceSol: 0.0000143,
    liquidityUsd: 24200,
    fdvUsd: 215000,
    m5Buys: 21,
    m5Sells: 7,
    m5VolumeUsd: 4950,
    h1VolumeUsd: 24800,
    priceChangeM5Pct: 9.7,
    ageMinutes: 9,
    updatedAt: Date.now(),
  },
  {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'AIBOT',
    name: 'Solana Neural Agent',
    dex: 'RAYDIUM_V4',
    poolAddress: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
    priceUsd: 0.0089,
    priceSol: 0.0000593,
    liquidityUsd: 33400,
    fdvUsd: 890000,
    m5Buys: 29,
    m5Sells: 12,
    m5VolumeUsd: 8300,
    h1VolumeUsd: 39100,
    priceChangeM5Pct: 15.6,
    ageMinutes: 19,
    updatedAt: Date.now(),
  },
  {
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIFQUANT',
    name: 'Wif Quant Index',
    dex: 'PUMP_FUN',
    poolAddress: 'EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKbd4Pm5c1q22',
    priceUsd: 0.00142,
    priceSol: 0.0000094,
    liquidityUsd: 14800,
    fdvUsd: 142000,
    m5Buys: 17,
    m5Sells: 9,
    m5VolumeUsd: 3200,
    h1VolumeUsd: 16400,
    priceChangeM5Pct: -4.2,
    ageMinutes: 6,
    updatedAt: Date.now(),
  },
  {
    mint: 'WashTrap11111111111111111111111111111111111',
    symbol: 'SPAMBOT',
    name: 'Wash Micro Bot',
    dex: 'RAYDIUM_CPMM',
    poolAddress: 'WashPool111111111111111111111111111111111111',
    priceUsd: 0.00051,
    priceSol: 0.0000034,
    liquidityUsd: 11200,
    fdvUsd: 510000,
    m5Buys: 74,
    m5Sells: 4,
    m5VolumeUsd: 260,
    h1VolumeUsd: 4800,
    priceChangeM5Pct: 1.8,
    ageMinutes: 31,
    updatedAt: Date.now(),
  },
];

let liveFeedCache: {
  fetchedAt: number;
  source: string;
  tokens: LiveFeedToken[];
} = {
  fetchedAt: 0,
  source: 'INIT',
  tokens: [],
};

let feedRotationCursor = 0;

function mapDexId(raw?: string): LiveFeedToken['dex'] {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('meteora')) return 'METEORA_DLMM';
  if (lower.includes('pump')) return 'PUMP_FUN';
  if (lower.includes('cpmm')) return 'RAYDIUM_CPMM';
  return 'RAYDIUM_V4';
}

const EXCLUDED_BASE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);
const EXCLUDED_BASE_SYMBOLS = new Set(['SOL', 'WSOL', 'USDC', 'USDT']);

function rankAndFilterLiveTokens(tokens: LiveFeedToken[]): LiveFeedToken[] {
  const dedup = new Map<string, LiveFeedToken>();
  for (const t of tokens) {
    if (!t.mint || EXCLUDED_BASE_MINTS.has(t.mint)) continue;
    if (EXCLUDED_BASE_SYMBOLS.has(t.symbol.toUpperCase())) continue;
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
    .slice(0, 12);
}

async function fetchExternalLiveFeed(): Promise<{ source: string; tokens: LiveFeedToken[] }> {
  const tryDexScreener = feedRotationCursor % 2 === 0;
  feedRotationCursor++;

  const parseDexScreener = async (): Promise<LiveFeedToken[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3800);
    try {
      const boostResp = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      if (!boostResp.ok) throw new Error(`DexScreener boosts HTTP ${boostResp.status}`);
      const boosts = (await boostResp.json()) as Array<{
        chainId?: string;
        tokenAddress?: string;
      }>;
      const mints = Array.from(
        new Set(
          (Array.isArray(boosts) ? boosts : [])
            .filter(
              (b) =>
                b.chainId === 'solana' &&
                b.tokenAddress &&
                !EXCLUDED_BASE_MINTS.has(b.tokenAddress),
            )
            .map((b) => b.tokenAddress as string),
        ),
      ).slice(0, 16);
      if (mints.length === 0) return [];

      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`DexScreener tokens HTTP ${resp.status}`);
      const json = (await resp.json()) as {
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
      const mapped = (json.pairs ?? [])
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
      return rankAndFilterLiveTokens(mapped);
    } finally {
      clearTimeout(timer);
    }
  };

  const parseGecko = async (): Promise<LiveFeedToken[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3800);
    try {
      const endpoint =
        feedRotationCursor % 3 === 0
          ? 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1'
          : 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1';
      const resp = await fetch(endpoint, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`GeckoTerminal HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        data?: Array<{
          id?: string;
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
      const mapped = (json.data ?? []).map((item) => {
        const attr = item.attributes ?? {};
        const rawBaseId = item.relationships?.base_token?.data?.id ?? '';
        const mint = rawBaseId.replace(/^solana_/, '');
        const nameParts = (attr.name ?? 'TOKEN / SOL').split('/');
        const symbol = (nameParts[0] ?? 'MEME').trim().slice(0, 12);
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
      return rankAndFilterLiveTokens(mapped);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const primary = tryDexScreener ? await parseDexScreener() : await parseGecko();
    if (primary.length >= 2) {
      return { source: tryDexScreener ? 'DEXSCREENER_LIVE' : 'GECKO_LIVE', tokens: primary };
    }
  } catch {
    // Fallback to secondary source
  }

  try {
    const secondary = tryDexScreener ? await parseGecko() : await parseDexScreener();
    if (secondary.length >= 2) {
      return { source: tryDexScreener ? 'GECKO_LIVE' : 'DEXSCREENER_LIVE', tokens: secondary };
    }
  } catch {
    // Fallback to simulated live jitter feed if offline/sandboxed
  }

  const now = Date.now();
  const jittered = FALLBACK_SOLANA_TOKENS.map((t, idx) => {
    const phase = ((now / 4000 + idx * 1.7) % (Math.PI * 2));
    const deltaPct = Number((Math.sin(phase) * 7.5).toFixed(2));
    const factor = 1 + deltaPct / 100;
    return {
      ...t,
      priceUsd: Number((t.priceUsd * factor).toFixed(6)),
      priceSol: Number((t.priceSol * factor).toFixed(7)),
      priceChangeM5Pct: Number((t.priceChangeM5Pct + deltaPct * 0.45).toFixed(2)),
      m5Buys: Math.max(1, t.m5Buys + Math.round(Math.cos(phase) * 4)),
      updatedAt: now,
    };
  });
  return { source: 'LIVE_SANDBOX_STREAM', tokens: jittered };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Allow requests from Capacitor WKWebView (capacitor://localhost) or custom mobile clients
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,If-None-Match');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'ETag,X-Feed-Source,X-Full-Bytes-Est',
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', botRootExists: fs.existsSync(BOT_ROOT) });
  });

  app.get('/api/live-feed', async (req, res) => {
    const compact = req.query.compact === '1' || req.query.compact === 'true';
    const rawLimit = Number(req.query.limit ?? (compact ? 5 : 10));
    const limit = Math.max(1, Math.min(12, Number.isFinite(rawLimit) ? rawLimit : 5));
    const cacheTtlMs = compact ? 45_000 : 8_000;

    if (Date.now() - liveFeedCache.fetchedAt > cacheTtlMs || liveFeedCache.tokens.length === 0) {
      const fresh = await fetchExternalLiveFeed();
      liveFeedCache = {
        fetchedAt: Date.now(),
        source: fresh.source,
        tokens: fresh.tokens,
      };
    }

    const slice = liveFeedCache.tokens.slice(0, limit);
    const fullPayload = {
      source: liveFeedCache.source,
      compact: false,
      ts: liveFeedCache.fetchedAt,
      tokens: liveFeedCache.tokens.slice(0, 10),
    };
    const fullBytesEst = Buffer.byteLength(JSON.stringify(fullPayload), 'utf-8');

    const etagPayload = slice
      .map((t) => `${t.mint}:${t.priceSol}:${t.m5Buys}:${t.liquidityUsd}`)
      .join('|');
    const etag = `W/"${compact ? 'c' : 'f'}-${Buffer.from(etagPayload).toString('base64').slice(0, 20)}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', compact ? 'public, max-age=45' : 'public, max-age=8');
    res.setHeader('X-Feed-Source', liveFeedCache.source);
    res.setHeader('X-Full-Bytes-Est', String(fullBytesEst));

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    if (compact) {
      // Ultra-low-data 4G compact tuple format: [mint, symbol, dexIdx, liqUsd, buys, sells, chg5m, priceSol, vol5mUsd]
      const dexMap: Record<LiveFeedToken['dex'], number> = {
        RAYDIUM_V4: 0,
        RAYDIUM_CPMM: 1,
        PUMP_FUN: 2,
        METEORA_DLMM: 3,
      };
      const rows = slice.map((t) => [
        t.mint,
        t.symbol,
        dexMap[t.dex],
        t.liquidityUsd,
        t.m5Buys,
        t.m5Sells,
        t.priceChangeM5Pct,
        t.priceSol,
        t.m5VolumeUsd,
      ]);
      res.json({ c: 1, src: liveFeedCache.source === 'LIVE_SANDBOX_STREAM' ? 0 : 1, r: rows });
      return;
    }

    res.json({
      source: liveFeedCache.source,
      compact: false,
      ts: liveFeedCache.fetchedAt,
      fullBytesEst,
      tokens: slice,
    });
  });

  app.get('/api/sol-balance', async (req, res) => {
    const address = String(req.query.address ?? '').trim();
    if (!address || address.length < 32 || address.length > 48) {
      res.status(400).json({ error: 'Invalid Solana address' });
      return;
    }
    const rpcs = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-rpc.publicnode.com',
    ];
    for (const rpcUrl of rpcs) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const rpcRes = await fetch(rpcUrl, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [address, { commitment: 'confirmed' }],
          }),
        });
        if (!rpcRes.ok) continue;
        const payload = (await rpcRes.json()) as { result?: { value?: number } };
        if (typeof payload.result?.value === 'number') {
          res.json({
            address,
            sol: Number((payload.result.value / 1_000_000_000).toFixed(5)),
            source: rpcUrl.includes('publicnode') ? 'PUBLICNODE' : 'MAINNET_RPC',
          });
          return;
        }
      } catch {
        // Try next RPC
      } finally {
        clearTimeout(timer);
      }
    }
    res.json({ address, sol: 0, source: 'OFFLINE_FALLBACK' });
  });

  app.get('/api/project-tree', (_req, res) => {
    const files = collectBotFiles(BOT_ROOT);
    const totalBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);
    const totalLines = files.reduce((acc, f) => acc + f.lines, 0);
    res.json({
      projectName: 'solana-ai-sniper-bot',
      fileCount: files.length,
      totalBytes,
      totalLines,
      files,
    });
  });

  app.get('/api/download-zip', async (_req, res) => {
    try {
      const zipBuffer = await buildZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="solana-ai-sniper-bot.zip"');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to package project zip',
      });
    }
  });

  app.get('/api/download-ios-kit', async (_req, res) => {
    try {
      const zipBuffer = await buildIosKitZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="SolSniperAI-iOS-IPA-Kit.zip"');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to package iOS IPA kit',
      });
    }
  });

  app.get('/api/ota/manifest', (_req, res) => {
    const bundle = buildDefaultOtaBundle(readBotPatchMap());
    res.json(bundle);
  });

  app.get('/api/ota/download-json', (_req, res) => {
    const bundle = buildDefaultOtaBundle(readBotPatchMap());
    const payload = JSON.stringify(bundle, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="solsniper-hotupdate-v2.2.json"');
    res.setHeader('Content-Length', String(Buffer.byteLength(payload, 'utf-8')));
    res.send(payload);
  });

  app.get('/api/ota/download-zip', async (_req, res) => {
    try {
      const zipBuffer = await buildOtaBundleZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="solsniper-hotupdate-bundle.zip"');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to package OTA hot-update bundle',
      });
    }
  });

  app.post('/api/evaluate', (req, res) => {
    const body = req.body as {
      token?: TokenCandidateInput;
      config?: Partial<StrategyConfig>;
    };
    if (!body?.token) {
      res.status(400).json({ error: 'token payload is required' });
      return;
    }
    const cfg: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG, ...(body.config ?? {}) };
    const result = evaluateTokenCandidate(body.token, cfg);
    res.json(result);
  });

  app.post('/api/bot/hot-update', async (req, res) => {
    try {
      const body = req.body as {
        fileName?: string;
        targetPath?: string;
        content?: string;
      };
      const rawHint = (body?.targetPath || body?.fileName || '').trim().replace(/\\/g, '/');
      const rawContent = typeof body?.content === 'string' ? body.content : '';
      if (!rawHint || !rawContent) {
        res.status(400).json({ success: false, error: 'fileName/targetPath and content are required.' });
        return;
      }

      if (rawHint.includes('..') || rawHint.includes('\0')) {
        res.status(400).json({ success: false, error: 'Invalid file path.' });
        return;
      }

      const ext = path.extname(rawHint).toLowerCase();
      if (ext !== '.ts' && ext !== '.json') {
        res.status(400).json({ success: false, error: 'Only .ts and .json bot files are supported.' });
        return;
      }

      const botFiles = collectBotFiles(BOT_ROOT);
      let relTarget = rawHint.replace(/^solana-ai-sniper-bot\//, '').replace(/^\/+/, '');
      if (!relTarget.startsWith('src/') && relTarget !== 'tsconfig.json') {
        const base = path.posix.basename(relTarget);
        const match = botFiles.find((f) => f.path.startsWith('src/') && path.posix.basename(f.path) === base);
        relTarget = match ? match.path : `src/custom/${base}`;
      }

      const absTarget = path.resolve(BOT_ROOT, relTarget);
      if (!absTarget.startsWith(BOT_ROOT + path.sep)) {
        res.status(400).json({ success: false, error: 'Target escapes bot directory.' });
        return;
      }

      // Backup original file
      const rollbackDir = path.join(BOT_ROOT, '.rollback', `studio-${Date.now()}`);
      const existedBefore = fs.existsSync(absTarget);
      if (existedBefore) {
        const backupPath = path.join(rollbackDir, relTarget);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(absTarget, backupPath);
      }

      // Deterministic auto-fix pass (strip markdown fences & bad .ts import suffixes)
      const autoFixLogs: string[] = [];
      let nextContent = rawContent;
      const trimmed = nextContent.trim();
      const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
      if (fenceMatch) {
        nextContent = `${fenceMatch[1]}\n`;
        autoFixLogs.push(`Stripped accidental Markdown code fence in ${relTarget}`);
      }
      if (ext === '.ts') {
        const cleanedImports = nextContent.replace(
          /(from\s+['"]\.[^'"]+)\.ts(['"])/g,
          '$1$2',
        );
        if (cleanedImports !== nextContent) {
          nextContent = cleanedImports;
          autoFixLogs.push(`Removed mistaken .ts extension in relative import (${relTarget})`);
        }
      }

      // Validate syntax before keeping changes
      let compileOk = true;
      let compileOutput = 'TypeScript syntax check passed (0 errors)';
      try {
        if (ext === '.json') {
          JSON.parse(nextContent);
          compileOutput = 'JSON validation passed';
        } else {
          const esbuild = await import('esbuild');
          await esbuild.transform(nextContent, { loader: 'ts', sourcefile: relTarget });
          compileOutput = 'esbuild TS transpile check passed (0 syntax errors)';
        }
      } catch (err) {
        compileOk = false;
        compileOutput = err instanceof Error ? err.message : String(err);
      }

      if (!compileOk) {
        // Do not persist broken file; keep original intact
        res.json({
          success: false,
          compiled: false,
          autoFixed: autoFixLogs.length > 0,
          rolledBack: existedBefore,
          filePath: relTarget,
          autoFixLogs,
          compilerOutput: compileOutput,
          error: 'Syntax/compile check failed. Kept previous working file safe.',
        });
        return;
      }

      fs.mkdirSync(path.dirname(absTarget), { recursive: true });
      fs.writeFileSync(absTarget, nextContent, 'utf-8');

      res.json({
        success: true,
        compiled: true,
        autoFixed: autoFixLogs.length > 0,
        rolledBack: false,
        filePath: relTarget,
        rollbackDir: existedBefore ? path.relative(BOT_ROOT, rollbackDir) : null,
        autoFixLogs,
        compilerOutput: compileOutput,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Hot update failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
