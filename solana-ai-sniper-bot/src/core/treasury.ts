import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createCloseAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { RuntimeConfig } from '../config/runtimeConfig';
import { RpcManager } from './rpc';
import { WalletManager } from './wallet';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const BASE58_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const ESTIMATED_SPL_RENT_SOL = 0.00203928;

export interface TokenAccountSnapshot {
  pubkey: string;
  mint: string;
  rawAmount: string;
  uiAmount: number;
  lamports: number;
  programId: string;
}

export interface ConsolidationPlanInput {
  liveBalanceSol: number;
  openExposureSol?: number;
  coldWalletAddress: string;
  hotWalletAddress: string;
  thresholdSol: number;
  keepReserveSol: number;
  minTransferSol?: number;
}

export interface ConsolidationPlan {
  shouldConsolidate: boolean;
  transferSol: number;
  transferLamports: number;
  keepAfterSol: number;
  reason: string;
}

export interface RentReclaimResult {
  mode: 'PAPER' | 'LIVE';
  closedCount: number;
  reclaimedSol: number;
  signatures: string[];
  closedMints: string[];
  skippedReason?: string;
}

export interface ConsolidationResult {
  executed: boolean;
  transferredSol: number;
  signature?: string;
  coldWalletAddress?: string;
  remainingBalanceSol?: number;
  reason: string;
}

export interface TreasuryTelemetry {
  totalAccountsClosed: number;
  totalRentReclaimedSol: number;
  paperAccountsClosed: number;
  paperRentReclaimedSol: number;
  totalConsolidatedSol: number;
  consolidationCount: number;
  lastSweepAt: number | null;
  lastConsolidationAt: number | null;
  lastConsolidationSig: string | null;
  lastError: string | null;
}

export function isValidSolanaAddress(address?: string | null): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  if (!BASE58_PUBKEY_RE.test(trimmed)) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure filter for empty SPL / Token-2022 accounts safe to close & reclaim SOL rent.
 * Never closes WSOL, active open position mints, or non-zero token balances.
 */
export function filterClosableEmptyTokenAccounts(
  accounts: TokenAccountSnapshot[],
  excludedMints: Set<string> = new Set(),
  specificMint?: string,
): TokenAccountSnapshot[] {
  return accounts
    .filter((acc) => {
      if (!acc.pubkey || !acc.mint) return false;
      if (acc.mint === WSOL_MINT) return false;
      if (excludedMints.has(acc.mint)) return false;
      if (specificMint && acc.mint !== specificMint) return false;
      const rawZero = acc.rawAmount === '0' || acc.rawAmount === '';
      const uiZero = !Number.isFinite(acc.uiAmount) || acc.uiAmount <= 0;
      return rawZero && uiZero;
    })
    .sort((a, b) => b.lamports - a.lamports);
}

/**
 * Pure calculator for sweeping surplus SOL profits to cold wallet while preserving gas & trading reserve.
 */
export function calculateConsolidationPlan(input: ConsolidationPlanInput): ConsolidationPlan {
  const cold = input.coldWalletAddress?.trim() || '';
  if (!isValidSolanaAddress(cold)) {
    return {
      shouldConsolidate: false,
      transferSol: 0,
      transferLamports: 0,
      keepAfterSol: input.liveBalanceSol,
      reason: 'COLD_WALLET_ADDRESS chưa cấu hình hoặc không hợp lệ',
    };
  }
  if (cold === input.hotWalletAddress) {
    return {
      shouldConsolidate: false,
      transferSol: 0,
      transferLamports: 0,
      keepAfterSol: input.liveBalanceSol,
      reason: 'Ví lạnh trùng với ví bot đang giao dịch',
    };
  }

  const safeKeepSol = Math.max(0.05, input.keepReserveSol);
  const feeBufferSol = 0.0005;
  const minTransferSol = Math.max(0.01, input.minTransferSol ?? 0.05);
  const effectiveThreshold = Math.max(input.thresholdSol, safeKeepSol + minTransferSol + feeBufferSol);

  if (input.liveBalanceSol < effectiveThreshold) {
    return {
      shouldConsolidate: false,
      transferSol: 0,
      transferLamports: 0,
      keepAfterSol: input.liveBalanceSol,
      reason: `Balance ${input.liveBalanceSol.toFixed(4)} SOL chưa đạt ngưỡng gom ${effectiveThreshold.toFixed(4)} SOL`,
    };
  }

  const surplusSol = input.liveBalanceSol - safeKeepSol - feeBufferSol;
  if (surplusSol < minTransferSol) {
    return {
      shouldConsolidate: false,
      transferSol: 0,
      transferLamports: 0,
      keepAfterSol: input.liveBalanceSol,
      reason: `Lợi nhuận dư (${surplusSol.toFixed(4)} SOL) nhỏ hơn mức tối thiểu ${minTransferSol} SOL`,
    };
  }

  const transferSol = Number(surplusSol.toFixed(6));
  const transferLamports = Math.floor(transferSol * LAMPORTS_PER_SOL);
  const keepAfterSol = Number((input.liveBalanceSol - transferSol).toFixed(6));

  return {
    shouldConsolidate: transferLamports > 0,
    transferSol,
    transferLamports,
    keepAfterSol,
    reason: `Sẵn sàng gom ${transferSol.toFixed(4)} SOL về ví lạnh (giữ lại ~${keepAfterSol.toFixed(4)} SOL trên hot wallet)`,
  };
}

/**
 * Auto-Consolidate & Rent Reclaim Manager:
 * - Automatically closes empty SPL & Token-2022 accounts after full position exit to reclaim ~0.00204 SOL rent each.
 * - Sweeps surplus SOL profit above threshold safely to a configured cold wallet.
 */
export class TreasuryManager {
  private isSweeping = false;
  private telemetry: TreasuryTelemetry = {
    totalAccountsClosed: 0,
    totalRentReclaimedSol: 0,
    paperAccountsClosed: 0,
    paperRentReclaimedSol: 0,
    totalConsolidatedSol: 0,
    consolidationCount: 0,
    lastSweepAt: null,
    lastConsolidationAt: null,
    lastConsolidationSig: null,
    lastError: null,
  };

  constructor(
    private readonly rpcManager: RpcManager,
    private readonly wallet: WalletManager,
  ) {}

  public getTelemetry(): TreasuryTelemetry {
    return { ...this.telemetry };
  }

  private async fetchOwnerTokenAccounts(conn: Connection): Promise<TokenAccountSnapshot[]> {
    const owner = this.wallet.publicKey;
    const programs = [
      { id: TOKEN_PROGRAM_ID, label: TOKEN_PROGRAM_ID.toBase58() },
      { id: TOKEN_2022_PROGRAM_ID, label: TOKEN_2022_PROGRAM_ID.toBase58() },
    ];

    const out: TokenAccountSnapshot[] = [];
    for (const prog of programs) {
      try {
        const res = await conn.getParsedTokenAccountsByOwner(owner, { programId: prog.id }, 'confirmed');
        for (const item of res.value ?? []) {
          const parsed = (
            item.account?.data as {
              parsed?: {
                info?: {
                  mint?: string;
                  tokenAmount?: { amount?: string; uiAmount?: number | null };
                };
              };
            }
          )?.parsed?.info;
          const mint = parsed?.mint ?? '';
          const rawAmount = String(parsed?.tokenAmount?.amount ?? '0');
          const uiAmount = Number(parsed?.tokenAmount?.uiAmount ?? 0);
          out.push({
            pubkey: item.pubkey.toBase58(),
            mint,
            rawAmount,
            uiAmount,
            lamports: Number(item.account?.lamports ?? Math.round(ESTIMATED_SPL_RENT_SOL * LAMPORTS_PER_SOL)),
            programId: prog.label,
          });
        }
      } catch {
        // Ignore single token program query error if other succeeds
      }
    }
    return out;
  }

  public async reclaimEmptyTokenAccounts(params: {
    mode: 'PAPER' | 'LIVE';
    specificMint?: string;
    openMints?: Set<string>;
  }): Promise<RentReclaimResult> {
    if (params.mode === 'PAPER' || this.wallet.isEphemeralPaperWallet) {
      if (params.specificMint && params.specificMint !== WSOL_MINT) {
        this.telemetry.paperAccountsClosed++;
        this.telemetry.paperRentReclaimedSol = Number(
          (this.telemetry.paperRentReclaimedSol + ESTIMATED_SPL_RENT_SOL).toFixed(6),
        );
        this.telemetry.lastSweepAt = Date.now();
        return {
          mode: 'PAPER',
          closedCount: 1,
          reclaimedSol: Number(ESTIMATED_SPL_RENT_SOL.toFixed(6)),
          signatures: [`PAPER_RECLAIM_${Date.now()}`],
          closedMints: [params.specificMint],
        };
      }
      return {
        mode: 'PAPER',
        closedCount: 0,
        reclaimedSol: 0,
        signatures: [],
        closedMints: [],
        skippedReason: 'Paper mode simulation: no live on-chain ATAs to close',
      };
    }

    if (this.isSweeping) {
      return {
        mode: 'LIVE',
        closedCount: 0,
        reclaimedSol: 0,
        signatures: [],
        closedMints: [],
        skippedReason: 'Sweep already in progress',
      };
    }

    this.isSweeping = true;
    try {
      const allAccounts = await this.rpcManager.withFallback((conn) =>
        this.fetchOwnerTokenAccounts(conn),
      );
      const closable = filterClosableEmptyTokenAccounts(
        allAccounts,
        params.openMints ?? new Set<string>(),
        params.specificMint,
      );

      if (closable.length === 0) {
        this.telemetry.lastSweepAt = Date.now();
        return {
          mode: 'LIVE',
          closedCount: 0,
          reclaimedSol: 0,
          signatures: [],
          closedMints: [],
        };
      }

      const signatures: string[] = [];
      const closedMints: string[] = [];
      let totalLamports = 0;

      // Batch up to 8 closeAccount instructions per transaction
      for (let i = 0; i < closable.length; i += 8) {
        const batch = closable.slice(i, i + 8);
        const tx = new Transaction();
        for (const acc of batch) {
          const progId =
            acc.programId === TOKEN_2022_PROGRAM_ID.toBase58()
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID;
          tx.add(
            createCloseAccountInstruction(
              new PublicKey(acc.pubkey),
              this.wallet.publicKey,
              this.wallet.publicKey,
              [],
              progId,
            ),
          );
          totalLamports += acc.lamports;
          closedMints.push(acc.mint);
        }

        const sig = await this.rpcManager.withFallback((conn) =>
          sendAndConfirmTransaction(conn, tx, [this.wallet.keypair], {
            commitment: 'confirmed',
          }),
        );
        signatures.push(sig);
      }

      const reclaimedSol = Number((totalLamports / LAMPORTS_PER_SOL).toFixed(6));
      this.telemetry.totalAccountsClosed += closedMints.length;
      this.telemetry.totalRentReclaimedSol = Number(
        (this.telemetry.totalRentReclaimedSol + reclaimedSol).toFixed(6),
      );
      this.telemetry.lastSweepAt = Date.now();
      this.telemetry.lastError = null;

      return {
        mode: 'LIVE',
        closedCount: closedMints.length,
        reclaimedSol,
        signatures,
        closedMints,
      };
    } catch (err) {
      this.telemetry.lastError = err instanceof Error ? err.message : String(err);
      return {
        mode: 'LIVE',
        closedCount: 0,
        reclaimedSol: 0,
        signatures: [],
        closedMints: [],
        skippedReason: this.telemetry.lastError,
      };
    } finally {
      this.isSweeping = false;
    }
  }

  public async consolidateProfitToColdWallet(params: {
    cfg: RuntimeConfig;
    openExposureSol?: number;
    force?: boolean;
  }): Promise<ConsolidationResult> {
    if (!params.force && !params.cfg.autoConsolidateEnabled) {
      return {
        executed: false,
        transferredSol: 0,
        reason: 'Auto-Consolidate đang tắt',
      };
    }

    if (params.cfg.tradingMode === 'PAPER' || this.wallet.isEphemeralPaperWallet) {
      return {
        executed: false,
        transferredSol: 0,
        reason: 'Auto-Consolidate on-chain chỉ thực thi ở chế độ LIVE có PRIVATE_KEY',
      };
    }

    try {
      const liveBalanceSol = await this.rpcManager.withFallback((conn) =>
        this.wallet.getLiveSolBalance(conn),
      );
      const plan = calculateConsolidationPlan({
        liveBalanceSol,
        openExposureSol: params.openExposureSol ?? 0,
        coldWalletAddress: params.cfg.coldWalletAddress,
        hotWalletAddress: this.wallet.publicKey.toBase58(),
        thresholdSol: params.cfg.consolidateThresholdSol,
        keepReserveSol: params.cfg.consolidateKeepSol,
      });

      if (!plan.shouldConsolidate || plan.transferLamports <= 0) {
        return {
          executed: false,
          transferredSol: 0,
          remainingBalanceSol: liveBalanceSol,
          reason: plan.reason,
        };
      }

      const coldPubkey = new PublicKey(params.cfg.coldWalletAddress.trim());
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: coldPubkey,
          lamports: plan.transferLamports,
        }),
      );

      const sig = await this.rpcManager.withFallback((conn) =>
        sendAndConfirmTransaction(conn, tx, [this.wallet.keypair], {
          commitment: 'confirmed',
        }),
      );

      this.telemetry.totalConsolidatedSol = Number(
        (this.telemetry.totalConsolidatedSol + plan.transferSol).toFixed(6),
      );
      this.telemetry.consolidationCount++;
      this.telemetry.lastConsolidationAt = Date.now();
      this.telemetry.lastConsolidationSig = sig;
      this.telemetry.lastError = null;

      return {
        executed: true,
        transferredSol: plan.transferSol,
        signature: sig,
        coldWalletAddress: coldPubkey.toBase58(),
        remainingBalanceSol: plan.keepAfterSol,
        reason: `Đã gom ${plan.transferSol.toFixed(4)} SOL về ví lạnh ${coldPubkey.toBase58()}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.telemetry.lastError = msg;
      return {
        executed: false,
        transferredSol: 0,
        reason: `Lỗi gom SOL về ví lạnh: ${msg}`,
      };
    }
  }

  public async onPositionClosed(params: {
    mint: string;
    mode: 'PAPER' | 'LIVE';
    cfg: RuntimeConfig;
    openMints?: Set<string>;
    openExposureSol?: number;
  }): Promise<{ reclaim?: RentReclaimResult; consolidation?: ConsolidationResult }> {
    let reclaim: RentReclaimResult | undefined;
    let consolidation: ConsolidationResult | undefined;

    if (params.cfg.autoRentReclaimEnabled) {
      reclaim = await this.reclaimEmptyTokenAccounts({
        mode: params.mode,
        specificMint: params.mint,
        openMints: params.openMints,
      });
    }

    if (params.cfg.autoConsolidateEnabled && params.mode === 'LIVE') {
      consolidation = await this.consolidateProfitToColdWallet({
        cfg: params.cfg,
        openExposureSol: params.openExposureSol,
      });
    }

    return { reclaim, consolidation };
  }
}
