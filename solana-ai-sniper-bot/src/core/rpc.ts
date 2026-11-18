import { Connection, Commitment } from '@solana/web3.js';
import { EnvConfig } from '../config/env';

export interface RpcEndpointHealth {
  url: string;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  cooldownUntil: number;
  healthy: boolean;
}

interface RpcPoolEntry {
  url: string;
  connection: Connection;
  cooldownUntil: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
}

export class RpcManager {
  public readonly primary: Connection;
  public readonly fallback: Connection;
  public readonly processedConnection: Connection;
  private readonly pool: RpcPoolEntry[];
  private readonly hasPaidRpcPlan: boolean;
  private poolIndex = 0;
  private activeConnection: Connection;
  private lastRpcCallAt = 0;
  private rpcQueue: Promise<unknown> = Promise.resolve();

  constructor(env: EnvConfig) {
    this.hasPaidRpcPlan = env.hasPaidRpcPlan;
    this.primary = new Connection(env.rpcHttpsUrl, {
      commitment: 'confirmed',
      wsEndpoint: env.rpcWssUrl,
      confirmTransactionInitialTimeout: 30_000,
    });

    this.processedConnection = new Connection(env.rpcHttpsUrl, {
      commitment: 'processed',
      wsEndpoint: env.rpcWssUrl,
    });

    this.fallback = new Connection(env.rpcFallbackUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30_000,
    });

    this.pool = env.rpcPoolUrls.map((url) => ({
      url,
      connection: new Connection(url, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 25_000,
      }),
      cooldownUntil: 0,
      successCount: 0,
      errorCount: 0,
      avgLatencyMs: 120,
    }));

    this.activeConnection = this.primary;
  }

  public isPaidPlan(): boolean {
    return this.hasPaidRpcPlan;
  }

  public getHealthReport(): RpcEndpointHealth[] {
    const now = Date.now();
    return this.pool.map((p) => ({
      url: p.url,
      successCount: p.successCount,
      errorCount: p.errorCount,
      avgLatencyMs: Math.round(p.avgLatencyMs),
      cooldownUntil: p.cooldownUntil,
      healthy: p.cooldownUntil <= now,
    }));
  }

  public getConnection(commitment?: Commitment): Connection {
    if (commitment === 'processed') {
      return this.processedConnection;
    }
    const now = Date.now();
    const healthy = this.pool
      .filter((p) => p.cooldownUntil <= now)
      .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
    if (healthy.length > 0 && !this.hasPaidRpcPlan) {
      this.poolIndex = (this.poolIndex + 1) % healthy.length;
      return healthy[this.poolIndex].connection;
    }
    return healthy[0]?.connection ?? this.activeConnection;
  }

  private async paceIfPublicRpc(): Promise<void> {
    if (this.hasPaidRpcPlan) return;
    const minSpacingMs = 130;
    const elapsed = Date.now() - this.lastRpcCallAt;
    if (elapsed < minSpacingMs) {
      await new Promise((r) => setTimeout(r, minSpacingMs - elapsed));
    }
    this.lastRpcCallAt = Date.now();
  }

  public async withFallback<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    const runAttempt = async (): Promise<T> => {
      const now = Date.now();
      const healthySorted = this.pool
        .filter((p) => p.cooldownUntil <= now)
        .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
      const cooledSorted = this.pool
        .filter((p) => p.cooldownUntil > now)
        .sort((a, b) => a.cooldownUntil - b.cooldownUntil);
      const ordered = [...healthySorted, ...cooledSorted].slice(0, 3);

      let lastErr: unknown;
      for (const entry of ordered) {
        await this.paceIfPublicRpc();
        const t0 = Date.now();
        try {
          const result = await fn(entry.connection);
          const lat = Math.max(5, Date.now() - t0);
          entry.successCount++;
          entry.avgLatencyMs = entry.avgLatencyMs * 0.75 + lat * 0.25;
          entry.cooldownUntil = 0;
          this.activeConnection = entry.connection;
          return result;
        } catch (err) {
          lastErr = err;
          entry.errorCount++;
          const msg = err instanceof Error ? err.message : String(err);
          const isRateOrNetwork =
            msg.includes('429') ||
            msg.includes('403') ||
            msg.includes('502') ||
            msg.includes('503') ||
            msg.includes('ECONNRESET') ||
            msg.includes('ETIMEDOUT') ||
            msg.includes('fetch failed');

          if (!isRateOrNetwork) {
            throw err;
          }
          const jitter = Math.round(500 + Math.random() * 1500);
          entry.cooldownUntil = Date.now() + Math.min(60_000, 15_000 + entry.errorCount * 5_000) + jitter;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('All Solana RPC endpoints throttled');
    };

    if (this.hasPaidRpcPlan) {
      return runAttempt();
    }

    const queued = this.rpcQueue.then(runAttempt, runAttempt);
    this.rpcQueue = queued.catch(() => {});
    return queued;
  }

  public async getDynamicPriorityFeeMicroLamports(
    maxCapMicroLamports: number,
    urgency: 'NORMAL' | 'HIGH_CONVICTION' | 'EMERGENCY' = 'NORMAL',
  ): Promise<number> {
    const urgencyMult = urgency === 'EMERGENCY' ? 1.5 : urgency === 'HIGH_CONVICTION' ? 1.25 : 1.0;
    try {
      const recentFees = await this.withFallback((conn) => conn.getRecentPrioritizationFees());
      if (!recentFees.length) {
        return Math.min(Math.round(50_000 * urgencyMult), maxCapMicroLamports);
      }
      const sorted = recentFees
        .map((f) => f.prioritizationFee)
        .filter((fee) => fee > 0)
        .sort((a, b) => a - b);

      if (sorted.length === 0) {
        return Math.min(Math.round(50_000 * urgencyMult), maxCapMicroLamports);
      }

      const p75Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
      const p75Fee = sorted[p75Index];
      const boosted = Math.ceil(p75Fee * 1.25 * urgencyMult);
      return Math.max(10_000, Math.min(boosted, maxCapMicroLamports));
    } catch {
      return Math.min(Math.round(50_000 * urgencyMult), maxCapMicroLamports);
    }
  }
}
