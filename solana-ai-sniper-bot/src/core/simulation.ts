import { Connection, VersionedTransaction } from '@solana/web3.js';
import { sharedHttpClient } from './httpClient';

export interface SimulationOutcome {
  ok: boolean;
  unitsConsumed: number;
  logs: string[];
  error?: string;
}

export interface HoneypotSimResult {
  passed: boolean;
  indexed: boolean;
  estimatedTaxPct: number;
  roundTripLossPct: number;
  detail: string;
}

export class TransactionSimulator {
  public async simulateVersioned(
    connection: Connection,
    tx: VersionedTransaction,
  ): Promise<SimulationOutcome> {
    try {
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: 'processed',
      });

      if (sim.value.err) {
        return {
          ok: false,
          unitsConsumed: sim.value.unitsConsumed ?? 0,
          logs: sim.value.logs ?? [],
          error: JSON.stringify(sim.value.err),
        };
      }

      return {
        ok: true,
        unitsConsumed: sim.value.unitsConsumed ?? 0,
        logs: sim.value.logs ?? [],
      };
    } catch (err) {
      return {
        ok: false,
        unitsConsumed: 0,
        logs: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async fetchJupiterQuoteWithFallback(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
  }): Promise<{ outAmount?: string; swapMode?: string; [key: string]: unknown } | null> {
    // Prefer lite-api first (higher free rate budget), fallback to v6 only when healthy
    const endpoints = [
      'https://lite-api.jup.ag/swap/v1/quote',
      'https://quote-api.jup.ag/v6/quote',
    ];
    for (const url of endpoints) {
      if (sharedHttpClient.isHostCooldownActive(url)) continue;
      try {
        const data = await sharedHttpClient.get<{ outAmount?: string }>(url, {
          axiosConfig: { params, timeout: 1800 },
          maxRetries: 1,
        });
        if (data?.outAmount && Number(data.outAmount) > 0) {
          return data;
        }
      } catch {
        // Try fallback quote endpoint
      }
    }
    return null;
  }

  public async simulateSellHoneypotCheck(
    connection: Connection,
    mint: string,
    payerPublicKey: string,
    decimals: number,
    options?: {
      maxRoundtripLossPct?: number;
      requireIndexedRoute?: boolean;
    },
  ): Promise<HoneypotSimResult> {
    const WSOL_MINT = 'So11111111111111111111111111111111111111112';
    const testSolLamports = 20_000_000; // 0.02 SOL depth check
    const maxLossPct = options?.maxRoundtripLossPct ?? 15;
    const requireIndexedRoute = options?.requireIndexedRoute ?? true;

    try {
      // Step 1: Request Jupiter buy quote (Lite + v6 fallback) and immediate reverse sell quote
      const buyQuote = await this.fetchJupiterQuoteWithFallback({
        inputMint: WSOL_MINT,
        outputMint: mint,
        amount: testSolLamports,
        slippageBps: 1200,
      });

      if (!buyQuote || !buyQuote.outAmount || Number(buyQuote.outAmount) <= 0) {
        return {
          passed: !requireIndexedRoute,
          indexed: false,
          estimatedTaxPct: 0,
          roundTripLossPct: 100,
          detail: requireIndexedRoute
            ? 'Blocked: Buy route not indexed on Jupiter yet (unverified exit liquidity)'
            : 'Route not indexed on Jupiter yet (newly launched pool)',
        };
      }

      const sellQuote = await this.fetchJupiterQuoteWithFallback({
        inputMint: mint,
        outputMint: WSOL_MINT,
        amount: Number(buyQuote.outAmount),
        slippageBps: 1200,
      });

      const returnedSol = Number(sellQuote?.outAmount ?? 0);
      if (returnedSol <= 0) {
        return {
          passed: false,
          indexed: true,
          estimatedTaxPct: 100,
          roundTripLossPct: 100,
          detail: 'Sell quote returned 0 lamports (potential 100% sell tax / honeypot)',
        };
      }

      const roundTripLossPct = Math.max(
        0,
        ((testSolLamports - returnedSol) / testSolLamports) * 100,
      );

      if (roundTripLossPct > maxLossPct) {
        return {
          passed: false,
          indexed: true,
          estimatedTaxPct: Number(roundTripLossPct.toFixed(1)),
          roundTripLossPct: Number(roundTripLossPct.toFixed(1)),
          detail: `Excessive round-trip spread/tax detected: ${roundTripLossPct.toFixed(1)}% (max ${maxLossPct}%)`,
        };
      }

      // Step 2: Inspect simulated sell transaction logs for freeze / transfer-fee / blacklist hooks
      const swapUrl = 'https://quote-api.jup.ag/v6/swap';
      if (!sharedHttpClient.isHostCooldownActive(swapUrl)) {
        try {
          const swapData = await sharedHttpClient.post<{ swapTransaction?: string }>(
            swapUrl,
            {
              quoteResponse: sellQuote,
              userPublicKey: payerPublicKey,
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
            },
            { axiosConfig: { timeout: 1000 }, maxRetries: 0 },
          );

        if (swapData?.swapTransaction) {
          const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
          const vtx = VersionedTransaction.deserialize(txBuf);
          const sim = await this.simulateVersioned(connection, vtx);
          const joinedLogs = sim.logs.join('\n').toLowerCase();

          const honeypotSignals = [
            'transfer_fee',
            'frozen',
            'account is frozen',
            'non-transferable',
            'blacklist',
            'blocked',
            'permanent_delegate',
          ];

          for (const sig of honeypotSignals) {
            if (joinedLogs.includes(sig)) {
              return {
                passed: false,
                indexed: true,
                estimatedTaxPct: 100,
                roundTripLossPct: 100,
                detail: `RPC simulateTransaction flagged restriction: ${sig}`,
              };
            }
          }
        }
        } catch {
          // Zero balance or missing ATA cannot prevent buy/sell quote verification above
        }
      }

      const estimatedTax = Math.max(0, Number((roundTripLossPct - 1.5).toFixed(1)));
      return {
        passed: true,
        indexed: true,
        estimatedTaxPct: estimatedTax,
        roundTripLossPct: Number(roundTripLossPct.toFixed(1)),
        detail: `Sell route verified (decimals=${decimals}, roundtrip=${roundTripLossPct.toFixed(1)}%)`,
      };
    } catch {
      return {
        passed: !requireIndexedRoute,
        indexed: false,
        estimatedTaxPct: 0,
        roundTripLossPct: 100,
        detail: requireIndexedRoute
          ? 'Blocked: Jupiter quote unavailable / unindexed pool (cannot verify exit route)'
          : 'Jupiter not indexed yet; deferred to on-chain Authority & LP checks',
      };
    }
  }
}
