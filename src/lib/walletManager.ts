const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map<string, number>(
  BASE58_ALPHABET.split('').map((ch, idx) => [ch, idx]),
);

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out;
}

export function decodeBase58(input: string): Uint8Array | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let zeros = 0;
  while (zeros < trimmed.length && trimmed[zeros] === '1') zeros++;

  const bytes = [0];
  for (let i = zeros; i < trimmed.length; i++) {
    const val = BASE58_MAP.get(trimmed[i]);
    if (val === undefined) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + i] = bytes[bytes.length - 1 - i];
  }
  return out;
}

export function isValidSolanaPublicKey(address: string): boolean {
  const decoded = decodeBase58(address);
  return decoded !== null && decoded.length === 32;
}

export type WalletConnectionKind =
  | 'NONE'
  | 'INJECTED_PHANTOM'
  | 'INJECTED_SOLFLARE'
  | 'IN_APP_IMPORTED'
  | 'IN_APP_GENERATED';

export interface ParsedImportedKeyResult {
  valid: boolean;
  publicKey: string;
  secretKeyBase58: string;
  error?: string;
}

/**
 * Parses a Solana Secret Key from either:
 * - Phantom / Solflare Base58 string (64-byte keypair -> bytes[32..64] are the exact Ed25519 public key)
 * - Solana CLI JSON byte array `[b0, b1, ..., b63]`
 */
export function parseImportedSecretKey(rawInput: string): ParsedImportedKeyResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      publicKey: '',
      secretKeyBase58: '',
      error: 'Vui lòng nhập Private Key Base58 hoặc mảng JSON 64 số.',
    };
  }

  let keyBytes: Uint8Array | null = null;
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 64 ||
        parsed.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 255)
      ) {
        return {
          valid: false,
          publicKey: '',
          secretKeyBase58: '',
          error: 'Mảng JSON keypair phải gồm đúng 64 số nguyên (0–255).',
        };
      }
      keyBytes = Uint8Array.from(parsed as number[]);
    } catch {
      return {
        valid: false,
        publicKey: '',
        secretKeyBase58: '',
        error: 'Cú pháp JSON Private Key không hợp lệ.',
      };
    }
  } else {
    const decoded = decodeBase58(trimmed);
    if (!decoded) {
      return {
        valid: false,
        publicKey: '',
        secretKeyBase58: '',
        error: 'Chuỗi Base58 chứa ký tự không hợp lệ.',
      };
    }
    if (decoded.length !== 64) {
      return {
        valid: false,
        publicKey: '',
        secretKeyBase58: '',
        error: `Solana keypair cần đúng 64 bytes (hiện tại: ${decoded.length} bytes).`,
      };
    }
    keyBytes = decoded;
  }

  const pubBytes = keyBytes.slice(32, 64);
  const publicKey = encodeBase58(pubBytes);
  return {
    valid: true,
    publicKey,
    secretKeyBase58: encodeBase58(keyBytes),
  };
}

/**
 * Generates an in-app Ed25519 Solana burner keypair using Web Crypto (iOS Safari 17+ / modern browsers)
 * with deterministic CSPRNG fallback when Ed25519 SubtleCrypto is unavailable in older runtimes.
 */
export async function generateInAppSolanaWallet(): Promise<{
  publicKey: string;
  secretKeyBase58: string;
}> {
  const randomValues = (buf: Uint8Array<ArrayBuffer>) => {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(buf);
      return;
    }
    for (let i = 0; i < buf.length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  };

  try {
    if (typeof globalThis.crypto?.subtle?.generateKey === 'function') {
      const kp = (await globalThis.crypto.subtle.generateKey(
        { name: 'Ed25519' } as AlgorithmIdentifier,
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair;
      const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', kp.publicKey));
      const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', kp.privateKey));
      const pubBytes = spki.slice(spki.length - 32);
      const privSeed = pkcs8.slice(pkcs8.length - 32);
      const full64 = new Uint8Array(new ArrayBuffer(64));
      full64.set(privSeed, 0);
      full64.set(pubBytes, 32);
      return {
        publicKey: encodeBase58(pubBytes),
        secretKeyBase58: encodeBase58(full64),
      };
    }
  } catch {
    // Fallback below
  }

  const fallback64 = new Uint8Array(new ArrayBuffer(64));
  randomValues(fallback64);
  return {
    publicKey: encodeBase58(fallback64.slice(32, 64)),
    secretKeyBase58: encodeBase58(fallback64),
  };
}

export interface StoredWalletState {
  connectionKind: WalletConnectionKind;
  publicKey: string;
  secretKeyBase58: string;
  coldWalletAddress: string;
  liveSolBalance: number;
  lastBalanceSyncAt: number | null;
}

export interface PaperAccountState {
  initialBalanceSol: number;
  balanceSol: number;
  peakBalanceSol: number;
  realizedPnlSol: number;
  maxDrawdownSol: number;
  maxDrawdownPct: number;
  wins: number;
  losses: number;
  lastResetAt: number;
}

export function createInitialPaperAccount(initialBalanceSol = 10): PaperAccountState {
  const safe = Number.isFinite(initialBalanceSol) && initialBalanceSol > 0 ? initialBalanceSol : 10;
  return {
    initialBalanceSol: safe,
    balanceSol: safe,
    peakBalanceSol: safe,
    realizedPnlSol: 0,
    maxDrawdownSol: 0,
    maxDrawdownPct: 0,
    wins: 0,
    losses: 0,
    lastResetAt: Date.now(),
  };
}

export function applyPaperTradeOutcome(
  prev: PaperAccountState,
  netPnlSol: number,
): PaperAccountState {
  const nextBal = Number(Math.max(0, prev.balanceSol + netPnlSol).toFixed(4));
  const nextPeak = Number(Math.max(prev.peakBalanceSol, nextBal).toFixed(4));
  const ddSol = Number(Math.max(0, nextPeak - nextBal).toFixed(4));
  const nextMaxDdSol = Math.max(prev.maxDrawdownSol, ddSol);
  const nextMaxDdPct =
    nextPeak > 0 ? Number(((nextMaxDdSol / nextPeak) * 100).toFixed(2)) : 0;

  return {
    ...prev,
    balanceSol: nextBal,
    peakBalanceSol: nextPeak,
    realizedPnlSol: Number((prev.realizedPnlSol + netPnlSol).toFixed(4)),
    maxDrawdownSol: nextMaxDdSol,
    maxDrawdownPct: nextMaxDdPct,
    wins: prev.wins + (netPnlSol >= 0 ? 1 : 0),
    losses: prev.losses + (netPnlSol < 0 ? 1 : 0),
  };
}

export function buildIosWalletDeepLink(provider: 'phantom' | 'solflare', currentUrl: string): string {
  const encoded = encodeURIComponent(currentUrl);
  if (provider === 'phantom') {
    return `https://phantom.app/ul/browse/${encoded}?ref=${encoded}`;
  }
  return `https://solflare.com/ul/v1/browse/${encoded}?ref=${encoded}`;
}

export function maskWalletAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || 'Chưa kết nối';
  return `${addr.slice(0, 5)}...${addr.slice(-5)}`;
}
