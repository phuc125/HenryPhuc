import axios from 'axios';
import bs58 from 'bs58';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';

const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

export interface JitoBundleResult {
  submitted: boolean;
  bundleId?: string;
  error?: string;
}

export type TipUrgency = 'NORMAL' | 'HIGH_CONVICTION' | 'EMERGENCY';

export interface DynamicTipPlan {
  tipSol: number;
  tipFloorSol: number | null;
  source: 'LIVE_TIP_FLOOR' | 'STATIC_CFG';
  urgency: TipUrgency;
}

export class JitoClient {
  private cachedTipFloorSol: number | null = null;
  private cachedTipFloorAt = 0;

  constructor(private readonly blockEngineUrl: string) {}

  public pickRandomTipAccount(): PublicKey {
    const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[idx]);
  }

  public createTipInstruction(payer: PublicKey, tipSol: number): TransactionInstruction {
    const lamports = Math.max(1_000, Math.floor(tipSol * LAMPORTS_PER_SOL));
    return SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: this.pickRandomTipAccount(),
      lamports,
    });
  }

  public async fetchLiveTipFloorSol(): Promise<number | null> {
    const now = Date.now();
    if (this.cachedTipFloorSol !== null && now - this.cachedTipFloorAt < 20_000) {
      return this.cachedTipFloorSol;
    }
    try {
      const res = await axios.get<
        Array<{
          landed_tips_50th_percentile?: number;
          landed_tips_75th_percentile?: number;
        }>
      >('https://bundles.jito.wtf/api/v1/bundles/tip_floor', { timeout: 1200 });
      const row = res.data?.[0];
      const p75 = Number(row?.landed_tips_75th_percentile ?? row?.landed_tips_50th_percentile ?? 0);
      if (Number.isFinite(p75) && p75 > 0) {
        this.cachedTipFloorSol = Math.min(0.01, Math.max(0.00005, p75));
        this.cachedTipFloorAt = now;
        return this.cachedTipFloorSol;
      }
    } catch {
      // Fall back gracefully when offline or rate-limited
    }
    return this.cachedTipFloorSol;
  }

  public async computeDynamicTip(params: {
    baseTipSol: number;
    buyAmountSol: number;
    maxFeeRatioPct: number;
    dynamicEnabled: boolean;
    urgency: TipUrgency;
  }): Promise<DynamicTipPlan> {
    const liveFloor = params.dynamicEnabled ? await this.fetchLiveTipFloorSol() : null;
    const urgencyMult =
      params.urgency === 'EMERGENCY' ? 1.5 : params.urgency === 'HIGH_CONVICTION' ? 1.25 : 1.0;

    let targetTip = params.baseTipSol * urgencyMult;
    if (params.dynamicEnabled && liveFloor !== null) {
      // Blend live Jito p75 floor with configured base tip
      targetTip = Math.max(params.baseTipSol, liveFloor) * urgencyMult;
    }

    const effectiveFeeRatio =
      params.urgency === 'EMERGENCY' ? params.maxFeeRatioPct * 1.6 : params.maxFeeRatioPct;
    const basePriorityTotal = 0.0004;
    const maxBudgetSol = Math.max(0.0005, params.buyAmountSol * (effectiveFeeRatio / 100));
    const maxAllowedTipPerSide = Math.max(0.00005, (maxBudgetSol - basePriorityTotal) / 2);

    const tipSol = Number(Math.min(targetTip, maxAllowedTipPerSide, 0.01).toFixed(6));
    return {
      tipSol,
      tipFloorSol: liveFloor,
      source: liveFloor !== null && params.dynamicEnabled ? 'LIVE_TIP_FLOOR' : 'STATIC_CFG',
      urgency: params.urgency,
    };
  }

  public async sendBundle(transactions: VersionedTransaction[]): Promise<JitoBundleResult> {
    try {
      const encodedTxs = transactions.map((tx) => bs58.encode(tx.serialize()));
      const response = await axios.post<{ result?: string; error?: { message: string } }>(
        this.blockEngineUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [encodedTxs],
        },
        {
          timeout: 3000,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (response.data?.error) {
        return {
          submitted: false,
          error: response.data.error.message,
        };
      }

      if (response.data?.result) {
        return {
          submitted: true,
          bundleId: response.data.result,
        };
      }

      return { submitted: false, error: 'Empty Jito bundle response' };
    } catch (err) {
      return {
        submitted: false,
        error: err instanceof Error ? err.message : 'Jito bundle request failed',
      };
    }
  }

  public async getBundleStatus(bundleId: string): Promise<'Landed' | 'Pending' | 'Failed'> {
    try {
      const statusUrl = this.blockEngineUrl.replace(/\/bundles$/, '/getBundleStatuses');
      const response = await axios.post<{
        result?: { value?: Array<{ confirmation_status?: string; err?: unknown }> };
      }>(
        statusUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        },
        { timeout: 2500 },
      );

      const entry = response.data?.result?.value?.[0];
      if (!entry) return 'Pending';
      if (entry.err) return 'Failed';
      if (
        entry.confirmation_status === 'confirmed' ||
        entry.confirmation_status === 'finalized'
      ) {
        return 'Landed';
      }
      return 'Pending';
    } catch {
      return 'Pending';
    }
  }
}
