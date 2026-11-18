import axios, { AxiosRequestConfig } from 'axios';

export interface HttpResilienceConfig {
  /** Initial delay (ms) before 1st retry when Retry-After header is absent (5000–10000ms recommended) */
  initialRetryDelayMs: number;
  /** Max retries per failed request (strictly clamped to 1..3, default 2) */
  maxRetries: number;
  /** Global cooldown duration (ms) when any stream hits HTTP 429 (30000–60000ms) */
  globalCooldownMs: number;
  /** Shared response cache TTL (ms) across all modules (5000–10000ms) */
  cacheTtlMs: number;
  /** Random jitter bounds added to retry/backoff waits (ms) */
  jitterMinMs: number;
  jitterMaxMs: number;
}

export interface HttpCacheEntry<T = unknown> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export interface HostCooldownEntry {
  host: string;
  remainingMs: number;
  reason: string;
}

export interface HttpResilienceStatus {
  globalCooldownActive: boolean;
  globalCooldownRemainingMs: number;
  globalCooldownReason: string;
  hostCooldowns: HostCooldownEntry[];
  cacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
  inFlightDedupHits: number;
  cooldownSkips: number;
  total429Events: number;
  totalRetries: number;
}

export class GlobalCooldownError extends Error {
  public readonly remainingMs: number;
  public readonly host?: string;
  constructor(remainingMs: number, reason: string, host?: string) {
    super(
      `API cooldown active${host && host !== '*' ? ` [${host}]` : ''} (${Math.ceil(remainingMs / 1000)}s remaining): ${reason}`,
    );
    this.name = 'GlobalCooldownError';
    this.remainingMs = remainingMs;
    this.host = host;
  }
}

export const DEFAULT_HOST_MIN_SPACING_MS: Record<string, number> = {
  'api.geckoterminal.com': 3_000,
  'api.dexscreener.com': 550,
  'api.rugcheck.xyz': 650,
  'quote-api.jup.ag': 600,
  'lite-api.jup.ag': 450,
};

export function extractHostname(urlOrHost?: string): string {
  if (!urlOrHost || !urlOrHost.trim()) return '*';
  const trimmed = urlOrHost.trim();
  if (trimmed === '*') return '*';
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      // Fallback string split below
    }
  }
  return trimmed.split('/')[0].split(':')[0].toLowerCase() || '*';
}

export function clampResilienceConfig(
  partial: Partial<HttpResilienceConfig>,
): HttpResilienceConfig {
  const initialRetryDelayMs = Math.max(
    5_000,
    Math.min(30_000, Math.round(partial.initialRetryDelayMs ?? 5_000)),
  );
  const maxRetries = Math.max(1, Math.min(3, Math.round(partial.maxRetries ?? 2)));
  const globalCooldownMs = Math.max(
    30_000,
    Math.min(60_000, Math.round(partial.globalCooldownMs ?? 45_000)),
  );
  const cacheTtlMs = Math.max(
    5_000,
    Math.min(10_000, Math.round(partial.cacheTtlMs ?? 8_000)),
  );
  const jitterMinMs = Math.max(500, Math.round(partial.jitterMinMs ?? 500));
  const jitterMaxMs = Math.max(jitterMinMs, Math.min(2_000, Math.round(partial.jitterMaxMs ?? 2_000)));
  return {
    initialRetryDelayMs,
    maxRetries,
    globalCooldownMs,
    cacheTtlMs,
    jitterMinMs,
    jitterMaxMs,
  };
}

/**
 * Parse Retry-After header (seconds integer/float or HTTP-date) case-insensitively.
 */
export function parseRetryAfterMs(
  headers?: Record<string, unknown> | null,
  now = Date.now(),
): number | null {
  if (!headers || typeof headers !== 'object') return null;

  let rawValue: unknown;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'retry-after') {
      rawValue = v;
      break;
    }
  }
  if (rawValue === undefined || rawValue === null) return null;

  const str = Array.isArray(rawValue) ? String(rawValue[0] ?? '') : String(rawValue).trim();
  if (!str) return null;

  const asSeconds = Number(str);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const parsedDate = Date.parse(str);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - now);
  }
  return null;
}

export function computeRandomJitterMs(
  minMs = 500,
  maxMs = 2_000,
  rng: () => number = Math.random,
): number {
  const safeMin = Math.max(0, minMs);
  const safeMax = Math.max(safeMin, maxMs);
  return Math.round(safeMin + rng() * (safeMax - safeMin));
}

export function computeRetryDelayMs(params: {
  attemptIndex: number;
  initialRetryDelayMs: number;
  retryAfterMs?: number | null;
  jitterMinMs?: number;
  jitterMaxMs?: number;
  rng?: () => number;
}): number {
  const jitter = computeRandomJitterMs(
    params.jitterMinMs ?? 500,
    params.jitterMaxMs ?? 2_000,
    params.rng ?? Math.random,
  );
  if (params.retryAfterMs !== undefined && params.retryAfterMs !== null && params.retryAfterMs > 0) {
    return Math.round(params.retryAfterMs + jitter);
  }
  const expBase = Math.max(5_000, params.initialRetryDelayMs) * Math.pow(2, params.attemptIndex);
  return Math.round(Math.min(60_000, expBase) + jitter);
}

export function isHttp429Error(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 429) return true;
  }
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 429) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || msg.toLowerCase().includes('too many requests');
}

export function isRetryableHttpError(err: unknown): boolean {
  if (isHttp429Error(err)) return true;
  const status =
    (axios.isAxiosError(err) ? err.response?.status : undefined) ??
    (err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { status?: number } }).response?.status
      : undefined);

  if (status !== undefined) {
    return status === 408 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  if (
    code === 'ECONNABORTED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN'
  ) {
    return true;
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('timeout') || msg.includes('network') || msg.includes('socket hang up');
}

export function extractRetryAfterFromError(err: unknown): number | null {
  if (err && typeof err === 'object' && 'response' in err) {
    const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
    return parseRetryAfterMs(headers);
  }
  return null;
}

/**
 * Sequential API Request Queue:
 * Guarantees tasks in the same bucket (e.g. GECKO_NEW + GECKO_TREND) execute strictly one-by-one
 * with a minimum spacing interval (>= 2500ms) so endpoints never fire concurrently.
 */
export class SequentialApiQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastRunFinishedAt = 0;

  constructor(
    private readonly minSpacingMs = 2_500,
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.lastRunFinishedAt > 0) {
        const elapsed = Date.now() - this.lastRunFinishedAt;
        if (elapsed < this.minSpacingMs) {
          await this.sleepFn(this.minSpacingMs - elapsed);
        }
      }
      try {
        return await task();
      } finally {
        this.lastRunFinishedAt = Date.now();
      }
    });

    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public resetSpacingForTests(): void {
    this.lastRunFinishedAt = 0;
  }
}

export interface ResilientRequestOptions {
  /** Override cache TTL in ms (still clamped or custom >=0; 0 disables cache read/write) */
  cacheTtlMs?: number;
  /** Optional explicit cache key (defaults to GET:<url>?<params>) */
  cacheKey?: string;
  /** Allow serving stale cached entry (<= 60s) when host cooldown is active */
  allowStaleOnCooldown?: boolean;
  /** Retry even on HTTP 429 (default false so 429 trips host cooldown immediately without hammering) */
  retryOn429?: boolean;
  /** Override maxRetries for this request (clamped <= configured maxRetries) */
  maxRetries?: number;
  /** Custom Axios request config */
  axiosConfig?: AxiosRequestConfig;
}

/**
 * Centralized HTTP Resilience Layer:
 * - Per-Host 429 Cooldowns (30–60s isolated per domain so one rate-limited API doesn't freeze others)
 * - Per-Host Minimum Spacing Pacer (prevents parallel request bursts on the same API domain)
 * - Retry-After header parsing + Random Jitter (500–2000ms)
 * - Bounded Max Retries (1–3 max) & Initial Retry Delay (5000–10000ms)
 * - Shared TTL Response Cache (5–10s) + In-Flight Request Deduplication
 */
export class ApiResilienceClient {
  private config: HttpResilienceConfig;
  private readonly cache = new Map<string, HttpCacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly hostCooldowns = new Map<string, { until: number; reason: string }>();
  private readonly hostNextAllowedAt = new Map<string, number>();
  private readonly hostQueueTails = new Map<string, Promise<void>>();
  private readonly hostSpacingMs: Record<string, number>;
  private globalCooldownUntil = 0;
  private globalCooldownReason = '';
  private stats = {
    cacheHits: 0,
    cacheMisses: 0,
    inFlightDedupHits: 0,
    cooldownSkips: 0,
    total429Events: 0,
    totalRetries: 0,
  };

  constructor(
    initialConfig: Partial<HttpResilienceConfig> = {},
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly rng: () => number = Math.random,
    hostSpacingOverrides: Record<string, number> = {},
  ) {
    this.config = clampResilienceConfig(initialConfig);
    this.hostSpacingMs = { ...DEFAULT_HOST_MIN_SPACING_MS, ...hostSpacingOverrides };
  }

  public configure(partial: Partial<HttpResilienceConfig>): HttpResilienceConfig {
    this.config = clampResilienceConfig({ ...this.config, ...partial });
    return { ...this.config };
  }

  public getConfig(): HttpResilienceConfig {
    return { ...this.config };
  }

  public isHostCooldownActive(urlOrHost: string, now = Date.now()): boolean {
    if (now < this.globalCooldownUntil) return true;
    const host = extractHostname(urlOrHost);
    if (host === '*') return false;
    const entry = this.hostCooldowns.get(host);
    return Boolean(entry && now < entry.until);
  }

  public getHostCooldownRemainingMs(urlOrHost: string, now = Date.now()): number {
    const wildcardRemaining = Math.max(0, this.globalCooldownUntil - now);
    const host = extractHostname(urlOrHost);
    if (host === '*') return wildcardRemaining;
    const entry = this.hostCooldowns.get(host);
    const hostRemaining = entry ? Math.max(0, entry.until - now) : 0;
    return Math.max(wildcardRemaining, hostRemaining);
  }

  public isGlobalCooldownActive(now = Date.now()): boolean {
    if (now < this.globalCooldownUntil) return true;
    for (const entry of this.hostCooldowns.values()) {
      if (now < entry.until) return true;
    }
    return false;
  }

  public getGlobalCooldownRemainingMs(now = Date.now()): number {
    let maxRemaining = Math.max(0, this.globalCooldownUntil - now);
    for (const entry of this.hostCooldowns.values()) {
      maxRemaining = Math.max(maxRemaining, entry.until - now);
    }
    return maxRemaining;
  }

  public getHostCooldownStatus(now = Date.now()): HostCooldownEntry[] {
    const out: HostCooldownEntry[] = [];
    if (now < this.globalCooldownUntil) {
      out.push({
        host: '*',
        remainingMs: this.globalCooldownUntil - now,
        reason: this.globalCooldownReason || 'Global 429 cooldown',
      });
    }
    for (const [host, entry] of this.hostCooldowns.entries()) {
      if (now < entry.until) {
        out.push({
          host,
          remainingMs: entry.until - now,
          reason: entry.reason,
        });
      }
    }
    return out;
  }

  public triggerHostCooldown(
    urlOrHost: string,
    reason: string,
    retryAfterMs?: number | null,
  ): number {
    return this.triggerGlobalCooldown(reason, retryAfterMs, urlOrHost);
  }

  public triggerGlobalCooldown(
    reason: string,
    retryAfterMs?: number | null,
    urlOrHost?: string,
  ): number {
    const jitter = computeRandomJitterMs(
      this.config.jitterMinMs,
      this.config.jitterMaxMs,
      this.rng,
    );
    const minWindow = Math.max(30_000, this.config.globalCooldownMs);
    const durationMs =
      retryAfterMs !== undefined && retryAfterMs !== null && retryAfterMs > 0
        ? Math.max(30_000, Math.min(180_000, retryAfterMs)) + jitter
        : Math.min(60_000, minWindow) + Math.min(jitter, 60_000 - Math.min(60_000, minWindow));

    const finalDuration = Math.max(30_000, durationMs);
    const nextUntil = Date.now() + finalDuration;
    const host = extractHostname(urlOrHost);

    if (host === '*') {
      if (nextUntil > this.globalCooldownUntil) {
        this.globalCooldownUntil = nextUntil;
        this.globalCooldownReason = reason;
      }
    } else {
      const prev = this.hostCooldowns.get(host);
      if (!prev || nextUntil > prev.until) {
        this.hostCooldowns.set(host, { until: nextUntil, reason });
      }
    }
    this.stats.total429Events++;
    return finalDuration;
  }

  private async runWithHostSpacing<T>(url: string, task: () => Promise<T>): Promise<T> {
    const host = extractHostname(url);
    const spacingMs = this.hostSpacingMs[host] ?? 0;
    if (spacingMs <= 0) {
      return task();
    }

    const prevTail = this.hostQueueTails.get(host) ?? Promise.resolve();
    const run = prevTail.then(async () => {
      const now = Date.now();
      const nextAllowed = this.hostNextAllowedAt.get(host) ?? 0;
      if (now < nextAllowed) {
        await this.sleepFn(nextAllowed - now);
      }
      try {
        return await task();
      } finally {
        this.hostNextAllowedAt.set(host, Date.now() + spacingMs);
      }
    });

    this.hostQueueTails.set(
      host,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  public buildCacheKey(url: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return `GET:${url}`;
    }
    const qs = Object.keys(params)
      .sort()
      .map((k) => `${k}=${String(params[k] ?? '')}`)
      .join('&');
    return `GET:${url}?${qs}`;
  }

  public primeCache<T>(url: string, data: T, ttlMs?: number, params?: Record<string, unknown>): void {
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.config.cacheTtlMs;
    if (effectiveTtl <= 0) return;
    const key = this.buildCacheKey(url, params);
    this.cache.set(key, {
      data,
      cachedAt: now,
      expiresAt: now + effectiveTtl,
    });
    this.pruneCache(now);
  }

  public getCachedOnly<T>(url: string, params?: Record<string, unknown>): T | undefined {
    const key = this.buildCacheKey(url, params);
    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      return hit.data as T;
    }
    return undefined;
  }

  public async get<T>(url: string, options: ResilientRequestOptions = {}): Promise<T> {
    const now = Date.now();
    const params = options.axiosConfig?.params as Record<string, unknown> | undefined;
    const cacheKey = options.cacheKey ?? this.buildCacheKey(url, params);
    const effectiveTtl =
      options.cacheTtlMs !== undefined ? Math.max(0, options.cacheTtlMs) : this.config.cacheTtlMs;

    if (effectiveTtl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        this.stats.cacheHits++;
        return cached.data as T;
      }
    }

    if (this.isHostCooldownActive(url, now)) {
      if (options.allowStaleOnCooldown !== false) {
        const stale = this.cache.get(cacheKey);
        if (stale && now - stale.cachedAt <= 60_000) {
          this.stats.cacheHits++;
          return stale.data as T;
        }
      }
      this.stats.cooldownSkips++;
      const host = extractHostname(url);
      const reason =
        this.hostCooldowns.get(host)?.reason ??
        this.globalCooldownReason ??
        '429 rate-limit protection';
      throw new GlobalCooldownError(this.getHostCooldownRemainingMs(url, now), reason, host);
    }

    const existingFlight = this.inFlight.get(cacheKey);
    if (existingFlight) {
      this.stats.inFlightDedupHits++;
      return (await existingFlight) as T;
    }

    this.stats.cacheMisses++;

    const execPromise = this.runWithHostSpacing(url, () =>
      this.executeWithRetry<T>(
        () => axios.get<T>(url, options.axiosConfig).then((res) => res.data),
        url,
        options,
      ),
    )
      .then((data) => {
        if (effectiveTtl > 0) {
          const ts = Date.now();
          this.cache.set(cacheKey, {
            data,
            cachedAt: ts,
            expiresAt: ts + effectiveTtl,
          });
          this.pruneCache(ts);
        }
        return data;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, execPromise);
    return execPromise;
  }

  public async post<T>(
    url: string,
    body: unknown,
    options: Omit<ResilientRequestOptions, 'cacheTtlMs' | 'cacheKey'> = {},
  ): Promise<T> {
    const now = Date.now();
    if (this.isHostCooldownActive(url, now)) {
      this.stats.cooldownSkips++;
      const host = extractHostname(url);
      const reason =
        this.hostCooldowns.get(host)?.reason ??
        this.globalCooldownReason ??
        '429 rate-limit protection';
      throw new GlobalCooldownError(this.getHostCooldownRemainingMs(url, now), reason, host);
    }

    return this.runWithHostSpacing(url, () =>
      this.executeWithRetry<T>(
        () => axios.post<T>(url, body, options.axiosConfig).then((res) => res.data),
        url,
        options,
      ),
    );
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    url: string,
    options: Pick<ResilientRequestOptions, 'retryOn429' | 'maxRetries'>,
  ): Promise<T> {
    const maxRetries =
      options.maxRetries !== undefined
        ? Math.max(0, Math.min(this.config.maxRetries, options.maxRetries))
        : this.config.maxRetries;

    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        const retryAfterMs = extractRetryAfterFromError(err);
        const is429 = isHttp429Error(err);

        if (is429) {
          this.triggerHostCooldown(url, `${extractHostname(url)} returned HTTP 429`, retryAfterMs);
          if (!options.retryOn429 || attempt >= maxRetries) {
            throw err;
          }
        } else if (!isRetryableHttpError(err) || attempt >= maxRetries) {
          throw err;
        }

        const waitMs = computeRetryDelayMs({
          attemptIndex: attempt,
          initialRetryDelayMs: this.config.initialRetryDelayMs,
          retryAfterMs,
          jitterMinMs: this.config.jitterMinMs,
          jitterMaxMs: this.config.jitterMaxMs,
          rng: this.rng,
        });
        this.stats.totalRetries++;
        attempt++;
        await this.sleepFn(waitMs);
      }
    }
  }

  private pruneCache(now: number): void {
    if (this.cache.size <= 500) return;
    for (const [k, v] of this.cache.entries()) {
      if (now >= v.expiresAt || this.cache.size > 500) {
        this.cache.delete(k);
      }
    }
  }

  public getStatus(now = Date.now()): HttpResilienceStatus {
    const activeHosts = this.getHostCooldownStatus(now);
    const topReason =
      activeHosts[0]?.reason ?? this.globalCooldownReason ?? '';
    return {
      globalCooldownActive: this.isGlobalCooldownActive(now),
      globalCooldownRemainingMs: this.getGlobalCooldownRemainingMs(now),
      globalCooldownReason: topReason,
      hostCooldowns: activeHosts,
      cacheEntries: this.cache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      inFlightDedupHits: this.stats.inFlightDedupHits,
      cooldownSkips: this.stats.cooldownSkips,
      total429Events: this.stats.total429Events,
      totalRetries: this.stats.totalRetries,
    };
  }

  public resetStateForTests(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.hostCooldowns.clear();
    this.hostNextAllowedAt.clear();
    this.hostQueueTails.clear();
    this.globalCooldownUntil = 0;
    this.globalCooldownReason = '';
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      inFlightDedupHits: 0,
      cooldownSkips: 0,
      total429Events: 0,
      totalRetries: 0,
    };
  }
}

export const sharedHttpClient = new ApiResilienceClient();
