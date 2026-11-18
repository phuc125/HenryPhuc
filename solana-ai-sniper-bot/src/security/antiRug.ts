import { Connection, PublicKey } from '@solana/web3.js';
import { sharedHttpClient } from '../core/httpClient';
import {
  ExtensionType,
  getExtensionTypes,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';
import { RuntimeConfig } from '../config/runtimeConfig';
import { RpcManager } from '../core/rpc';
import { TransactionSimulator } from '../core/simulation';
import { AntiRugReport, DexSource, SecurityLayerResult } from '../core/types';

const BURN_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  '1nc1nerator11111111111111111111111111111111',
  'deadbeef11111111111111111111111111111111111',
]);

const KNOWN_POOL_AUTHORITIES = new Set([
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
  'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
]);

const DANGEROUS_TOKEN_2022_EXTENSIONS = new Set<ExtensionType>([
  ExtensionType.PermanentDelegate,
  ExtensionType.NonTransferable,
  ExtensionType.TransferHook,
  ExtensionType.TransferFeeConfig,
]);

export interface AntiRugCheckInput {
  mint: string;
  dex?: DexSource;
  poolAddress?: string;
  lpMint?: string;
  creatorAddress?: string;
  launchSlot?: number;
  payerPublicKey: string;
}

interface RugCheckFullReport {
  available: boolean;
  score: number | null;
  risks: Array<{ name: string; level: string }>;
  bestLpLockedPct: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  hasAuthoritiesData: boolean;
  creator: string | null;
  topHolders: Array<{
    address?: string;
    owner?: string;
    pct?: number;
    insider?: boolean;
  }>;
  insidersDetected: number;
}

export interface ContinuousPositionSecurityStatus {
  safe: boolean;
  top10HoldersPct: number;
  lpBurnedPct: number;
  lpDropAlert: boolean;
  concentrationSpikeAlert: boolean;
  mintOrFreezeChangedAlert: boolean;
  dangerAlert: boolean;
  reason: string;
}

export class AntiRugEngine {
  constructor(
    private readonly rpcManager: RpcManager,
    private readonly simulator: TransactionSimulator,
    private readonly blacklistChecker?: (
      creatorAddress?: string | null,
    ) => { blacklisted: boolean; reason?: string; strikes?: number },
  ) {}

  public async runFiveLayerAudit(
    input: AntiRugCheckInput,
    cfg: RuntimeConfig,
  ): Promise<AntiRugReport> {
    const startMs = Date.now();
    const mintPubkey = new PublicKey(input.mint);
    const conn: Connection = this.rpcManager.getConnection('confirmed');

    const [rugCheck, mintAccountInfo] = await Promise.all([
      this.fetchRugCheckFullReport(input.mint),
      this.rpcManager
        .withFallback((c) => c.getAccountInfo(mintPubkey, 'confirmed'))
        .catch(() => null),
    ]);

    const resolvedCreator = input.creatorAddress ?? rugCheck.creator ?? undefined;
    const blStatus = this.blacklistChecker
      ? this.blacklistChecker(resolvedCreator)
      : { blacklisted: false, strikes: 0 };

    const l1 = await this.layer1AuthorityCheck(mintPubkey, rugCheck, mintAccountInfo).catch(
      (err): {
        layer: string;
        passed: boolean;
        verified: boolean;
        detail: string;
        durationMs: number;
        critical: boolean;
        mintAuthorityRevoked: boolean;
        freezeAuthorityRevoked: boolean;
        decimals: number;
        totalSupplyUi: number | null;
      } => ({
        layer: 'L1_AUTHORITY',
        passed: false,
        verified: false,
        detail: `Authority check error: ${String(err)}`,
        durationMs: Date.now() - startMs,
        critical: true,
        mintAuthorityRevoked: false,
        freezeAuthorityRevoked: false,
        decimals: 6,
        totalSupplyUi: null,
      }),
    );

    const l1CleanVerified = l1.verified && l1.mintAuthorityRevoked && l1.freezeAuthorityRevoked;

    // Gate Jupiter Honeypot Simulation: skip wasted API calls when L1 fails or creator is blacklisted
    const preHpRes =
      cfg.honeypotSimEnabled && l1CleanVerified && !blStatus.blacklisted
        ? await this.simulator
            .simulateSellHoneypotCheck(conn, input.mint, input.payerPublicKey, l1.decimals || 6, {
              maxRoundtripLossPct: cfg.spreadGuardEnabled ? cfg.maxRoundtripSpreadPct : 95,
              requireIndexedRoute: false,
            })
            .catch(() => null)
        : null;

    const [lpRes, holderRes, bundleRes, rugHpRes] = await Promise.allSettled([
      this.layer2LpBurnCheck(
        input.lpMint,
        input.dex,
        cfg.minLpBurnedPct,
        rugCheck,
        cfg.lpLockCheckEnabled,
        l1CleanVerified,
      ),
      this.layer3HolderAndDevCheck(
        mintPubkey,
        input.poolAddress,
        resolvedCreator,
        cfg.maxTop10HoldersPct,
        cfg.maxDevHoldPct,
        rugCheck,
        l1.totalSupplyUi,
      ),
      this.layer4AntiBundleAndSybil(
        mintPubkey,
        input.launchSlot,
        cfg.maxBundleSupplyPct,
        rugCheck,
        cfg.discoveryMode,
        cfg.antiBundleCheckEnabled,
        l1.totalSupplyUi,
      ),
      this.layer5RugCheckAndHoneypot(cfg, rugCheck, preHpRes),
    ]);

    const layers: SecurityLayerResult[] = [];
    layers.push(l1);

    const l2 =
      lpRes.status === 'fulfilled'
        ? lpRes.value
        : {
            layer: 'L2_LP_BURN',
            passed: false,
            verified: false,
            detail: `LP check unverified: ${String(lpRes.reason)}`,
            durationMs: Date.now() - startMs,
            critical: cfg.lpLockCheckEnabled,
            lpBurnedPct: 0,
            lpBurnVerified: false,
          };
    layers.push(l2);

    const l3 =
      holderRes.status === 'fulfilled'
        ? holderRes.value
        : {
            layer: 'L3_HOLDERS_DEV',
            passed: false,
            verified: false,
            detail: `UNVERIFIED Holder telemetry: ${String(holderRes.reason)}`,
            durationMs: Date.now() - startMs,
            critical: true,
            top10HoldersPct: 100,
            devHoldPct: 0,
            sybilScore: 50,
          };

    if (blStatus.blacklisted && resolvedCreator) {
      l3.passed = false;
      l3.verified = true;
      l3.critical = true;
      l3.detail = `BLACKLISTED CREATOR (${resolvedCreator.slice(0, 6)}...): ${blStatus.reason ?? 'Repeat rugger'}`;
    }
    layers.push(l3);

    const l4 =
      bundleRes.status === 'fulfilled'
        ? bundleRes.value
        : {
            layer: 'L4_ANTI_BUNDLE',
            passed: false,
            verified: false,
            detail: `UNVERIFIED Anti-bundle check: ${String(bundleRes.reason)}`,
            durationMs: Date.now() - startMs,
            critical: cfg.antiBundleCheckEnabled,
            bundleSupplyPct: 0,
            sybilScore: 40,
            insidersDetected: rugCheck.insidersDetected,
          };
    layers.push(l4);

    const l5 =
      rugHpRes.status === 'fulfilled'
        ? rugHpRes.value
        : {
            layer: 'L5_RUGCHECK_HONEYPOT',
            passed: false,
            verified: false,
            detail: `UNVERIFIED RugCheck/Honeypot: ${String(rugHpRes.reason)}`,
            durationMs: Date.now() - startMs,
            critical: true,
            rugcheckScore: null,
            rugcheckRiskLevel: 'Unverified',
            honeypotPassed: false,
          };
    layers.push(l5);

    const unverifiedLayers = layers.filter((l) => !l.verified).map((l) => l.layer);
    const verifiedLayersCount = layers.length - unverifiedLayers.length;
    const dataConfidencePct = Math.round((verifiedLayersCount / layers.length) * 100);

    const elapsedMs = Date.now() - startMs;
    // Only give full weight to PASSED + VERIFIED checks; unverified passes receive half credit at most
    let scoreAccum = 0;
    for (const l of layers) {
      if (l.passed && l.verified) scoreAccum += 20;
      else if (l.passed && !l.verified) scoreAccum += 8;
    }
    let securityScore = Math.min(100, Math.round(scoreAccum));
    if (!l1.mintAuthorityRevoked || !l1.freezeAuthorityRevoked || !l1.verified) {
      securityScore = Math.min(securityScore, 25);
    }
    if (!l5.honeypotPassed || blStatus.blacklisted) {
      securityScore = 0;
    }

    const creatorReputationScore = blStatus.blacklisted
      ? 0
      : l3.devHoldPct <= 3 && !rugCheck.risks.some((r) => r.level?.toLowerCase() === 'danger')
        ? 82
        : Math.max(15, 70 - l3.devHoldPct * 5 - (blStatus.strikes ?? 0) * 20);

    const sybilScore = Math.min(100, Math.round(((l4.sybilScore ?? 0) + (l3.sybilScore ?? 0)) / 2));
    const unlockedLpExposure = Math.max(0, 100 - l2.lpBurnedPct);
    const liquidityWithdrawalRiskPct = Number(
      Math.min(
        100,
        unlockedLpExposure * 0.65 +
          (l1.mintAuthorityRevoked ? 0 : 30) +
          Math.max(0, l3.devHoldPct * 1.8) +
          (l2.lpBurnVerified ? 0 : 12),
      ).toFixed(1),
    );

    const criticalFailed = layers.some((l) => l.critical && !l.passed);
    // Require L1 on-chain/RugCheck verified AND at least 2 verified layers (40%) so fresh pools aren't auto-dropped solely for pending index
    const criticalUnverifiedBlock = !l1.verified || dataConfidencePct < 40;
    const overallSafe = !blStatus.blacklisted && !criticalFailed && !criticalUnverifiedBlock;

    return {
      mint: input.mint,
      overallSafe,
      securityScore,
      dataConfidencePct,
      unverifiedLayers,
      elapsedMs,
      mintAuthorityRevoked: l1.mintAuthorityRevoked,
      freezeAuthorityRevoked: l1.freezeAuthorityRevoked,
      lpBurnedPct: l2.lpBurnedPct,
      lpBurnVerified: l2.lpBurnVerified,
      top10HoldersPct: l3.top10HoldersPct,
      devHoldPct: l3.devHoldPct,
      bundleSupplyPct: l4.bundleSupplyPct,
      sybilScore,
      insiderWalletsCount: rugCheck.insidersDetected,
      creatorReputationScore,
      liquidityWithdrawalRiskPct,
      rugcheckScore: l5.rugcheckScore,
      rugcheckRiskLevel: l5.rugcheckRiskLevel,
      honeypotPassed: l5.honeypotPassed,
      roundTripLossPct: preHpRes?.indexed ? preHpRes.roundTripLossPct : null,
      creatorAddress: resolvedCreator,
      creatorBlacklisted: blStatus.blacklisted,
      layers: layers.map(({ layer, passed, verified, detail, durationMs, critical }) => ({
        layer,
        passed,
        verified,
        detail,
        durationMs,
        critical,
      })),
    };
  }

  /**
   * Re-assesses an already open position for LP removal, top-holder spike, or re-enabled authority flags.
   */
  public async reassessOpenPositionSecurity(params: {
    mint: string;
    poolAddress?: string;
    initialLpBurnedPct?: number;
  }): Promise<ContinuousPositionSecurityStatus> {
    const rugCheck = await this.fetchRugCheckFullReport(params.mint);
    if (!rugCheck.available) {
      return {
        safe: true,
        top10HoldersPct: 0,
        lpBurnedPct: params.initialLpBurnedPct ?? 100,
        lpDropAlert: false,
        concentrationSpikeAlert: false,
        mintOrFreezeChangedAlert: false,
        dangerAlert: false,
        reason: 'Re-assessment skipped (RugCheck temporarily unavailable)',
      };
    }

    const dangerRisk = rugCheck.risks.find((r) => r.level?.toLowerCase() === 'danger');
    const lpBurnedPct = rugCheck.bestLpLockedPct ?? params.initialLpBurnedPct ?? 100;
    const lpDropAlert =
      rugCheck.bestLpLockedPct !== null && rugCheck.bestLpLockedPct < 55;

    let top10 = 0;
    let counted = 0;
    for (const h of rugCheck.topHolders) {
      if (h.owner === params.poolAddress || h.address === params.poolAddress) continue;
      if (counted < 10) {
        top10 += Number(h.pct ?? 0);
        counted++;
      }
    }
    const concentrationSpikeAlert = top10 > 58;
    const mintOrFreezeChangedAlert =
      rugCheck.hasAuthoritiesData && (Boolean(rugCheck.mintAuthority) || Boolean(rugCheck.freezeAuthority));

    const safe = !dangerRisk && !lpDropAlert && !mintOrFreezeChangedAlert && !concentrationSpikeAlert;
    const reasons: string[] = [];
    if (dangerRisk) reasons.push(`Danger: ${dangerRisk.name}`);
    if (lpDropAlert) reasons.push(`LP Lock dropped to ${lpBurnedPct.toFixed(1)}%`);
    if (concentrationSpikeAlert) reasons.push(`Top10 concentration spiked to ${top10.toFixed(1)}%`);
    if (mintOrFreezeChangedAlert) reasons.push('Mint/Freeze authority reactivated');

    return {
      safe,
      top10HoldersPct: Number(top10.toFixed(1)),
      lpBurnedPct: Number(lpBurnedPct.toFixed(1)),
      lpDropAlert,
      concentrationSpikeAlert,
      mintOrFreezeChangedAlert,
      dangerAlert: Boolean(dangerRisk),
      reason: safe ? 'Open position security intact' : reasons.join(' | '),
    };
  }

  private async fetchRugCheckFullReport(mint: string): Promise<RugCheckFullReport> {
    try {
      const data = await sharedHttpClient.get<{
        score?: number;
        risks?: Array<{ name: string; level: string }>;
        markets?: Array<{ lp?: { lpLockedPct?: number; lpBurnedPct?: number } }>;
        token?: { mintAuthority?: string | null; freezeAuthority?: string | null; decimals?: number };
        creator?: string | null;
        topHolders?: Array<{
          address?: string;
          owner?: string;
          pct?: number;
          insider?: boolean;
        }>;
      }>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
        axiosConfig: { timeout: 1700 },
        maxRetries: 1,
      });

      const markets = data?.markets ?? [];
      let bestLp: number | null = null;
      for (const m of markets) {
        const locked = Math.max(m.lp?.lpLockedPct ?? 0, m.lp?.lpBurnedPct ?? 0);
        if (bestLp === null || locked > bestLp) {
          bestLp = locked;
        }
      }

      const topHolders = data?.topHolders ?? [];
      const insidersDetected = topHolders.filter((h) => h.insider).length;

      return {
        available: true,
        score: typeof data?.score === 'number' ? data.score : 0,
        risks: data?.risks ?? [],
        bestLpLockedPct: bestLp,
        mintAuthority: data?.token?.mintAuthority ?? null,
        freezeAuthority: data?.token?.freezeAuthority ?? null,
        hasAuthoritiesData: Boolean(data?.token),
        creator: data?.creator ?? null,
        topHolders,
        insidersDetected,
      };
    } catch {
      return {
        available: false,
        score: null,
        risks: [],
        bestLpLockedPct: null,
        mintAuthority: null,
        freezeAuthority: null,
        hasAuthoritiesData: false,
        creator: null,
        topHolders: [],
        insidersDetected: 0,
      };
    }
  }

  private async layer1AuthorityCheck(
    mint: PublicKey,
    rugCheck: RugCheckFullReport,
    prefetchedAccountInfo?: Awaited<ReturnType<Connection['getAccountInfo']>> | null,
  ) {
    const t0 = Date.now();
    try {
      const accountInfo =
        prefetchedAccountInfo ??
        (await this.rpcManager.withFallback((conn) => conn.getAccountInfo(mint, 'confirmed')));
      if (accountInfo && accountInfo.data.length >= MintLayout.span) {
        const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
        if (isToken2022) {
          const mintObj = unpackMint(mint, accountInfo, TOKEN_2022_PROGRAM_ID);
          const extensions = getExtensionTypes(mintObj.tlvData);
          const dangerous = extensions.filter((ext) => DANGEROUS_TOKEN_2022_EXTENSIONS.has(ext));
          const mintAuthorityRevoked = mintObj.mintAuthority === null;
          const freezeAuthorityRevoked = mintObj.freezeAuthority === null;
          const totalSupplyUi = Number(mintObj.supply) / Math.pow(10, mintObj.decimals);

          if (dangerous.length > 0) {
            return {
              layer: 'L1_AUTHORITY',
              passed: false,
              verified: true,
              detail: `Blocked Token-2022 dangerous extensions (${dangerous.join(', ')})`,
              durationMs: Date.now() - t0,
              critical: true,
              mintAuthorityRevoked,
              freezeAuthorityRevoked,
              decimals: mintObj.decimals,
              totalSupplyUi: Number.isFinite(totalSupplyUi) && totalSupplyUi > 0 ? totalSupplyUi : null,
            };
          }

          return {
            layer: 'L1_AUTHORITY',
            passed: mintAuthorityRevoked && freezeAuthorityRevoked,
            verified: true,
            detail: `Token-2022 MintAuth=${mintAuthorityRevoked ? 'REVOKED' : 'ACTIVE'}, FreezeAuth=${
              freezeAuthorityRevoked ? 'REVOKED' : 'ACTIVE'
            }`,
            durationMs: Date.now() - t0,
            critical: true,
            mintAuthorityRevoked,
            freezeAuthorityRevoked,
            decimals: mintObj.decimals,
            totalSupplyUi: Number.isFinite(totalSupplyUi) && totalSupplyUi > 0 ? totalSupplyUi : null,
          };
        }

        const decoded = MintLayout.decode(accountInfo.data.subarray(0, MintLayout.span));
        const mintAuthorityRevoked = decoded.mintAuthorityOption === 0;
        const freezeAuthorityRevoked = decoded.freezeAuthorityOption === 0;
        const totalSupplyUi = Number(decoded.supply) / Math.pow(10, decoded.decimals);
        return {
          layer: 'L1_AUTHORITY',
          passed: mintAuthorityRevoked && freezeAuthorityRevoked,
          verified: true,
          detail: `MintAuth=${mintAuthorityRevoked ? 'REVOKED' : 'ACTIVE'}, FreezeAuth=${
            freezeAuthorityRevoked ? 'REVOKED' : 'ACTIVE'
          }`,
          durationMs: Date.now() - t0,
          critical: true,
          mintAuthorityRevoked,
          freezeAuthorityRevoked,
          decimals: decoded.decimals,
          totalSupplyUi: Number.isFinite(totalSupplyUi) && totalSupplyUi > 0 ? totalSupplyUi : null,
        };
      }
    } catch {
      // Fall back to RugCheck authority state if free RPC is congested
    }

    if (rugCheck.available && rugCheck.hasAuthoritiesData) {
      const mintAuthorityRevoked = !rugCheck.mintAuthority;
      const freezeAuthorityRevoked = !rugCheck.freezeAuthority;
      return {
        layer: 'L1_AUTHORITY',
        passed: mintAuthorityRevoked && freezeAuthorityRevoked,
        verified: true,
        detail: `RugCheck MintAuth=${mintAuthorityRevoked ? 'REVOKED' : 'ACTIVE'}, FreezeAuth=${
          freezeAuthorityRevoked ? 'REVOKED' : 'ACTIVE'
        }`,
        durationMs: Date.now() - t0,
        critical: true,
        mintAuthorityRevoked,
        freezeAuthorityRevoked,
        decimals: 6,
        totalSupplyUi: null,
      };
    }

    return {
      layer: 'L1_AUTHORITY',
      passed: false,
      verified: false,
      detail: 'UNVERIFIED: Mint authority check failed (RPC & RugCheck unavailable)',
      durationMs: Date.now() - t0,
      critical: true,
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: false,
      decimals: 6,
      totalSupplyUi: null,
    };
  }

  private async layer2LpBurnCheck(
    lpMintAddress: string | undefined,
    dex: DexSource | undefined,
    minLpBurnedPct: number,
    rugCheck: RugCheckFullReport,
    lpLockCheckEnabled = true,
    l1CleanVerified = false,
  ) {
    const t0 = Date.now();

    if (!lpLockCheckEnabled) {
      return {
        layer: 'L2_LP_BURN',
        passed: true,
        verified: false,
        detail: 'LP Lock Check OFF (Unverified fast entry)',
        durationMs: Date.now() - t0,
        critical: false,
        lpBurnedPct: 0,
        lpBurnVerified: false,
      };
    }

    if (dex === 'PUMPSWAP' || dex === 'METEORA_DLMM') {
      const pct = rugCheck.bestLpLockedPct ?? 100;
      const effectivePct = pct === 0 ? 100 : Number(pct.toFixed(2));
      return {
        layer: 'L2_LP_BURN',
        passed: true,
        verified: true,
        detail: `${dex} protocol-custody pool (LP Lock=${effectivePct}%)`,
        durationMs: Date.now() - t0,
        critical: false,
        lpBurnedPct: effectivePct,
        lpBurnVerified: true,
      };
    }

    if (rugCheck.bestLpLockedPct !== null) {
      const pct = Number(rugCheck.bestLpLockedPct.toFixed(2));
      return {
        layer: 'L2_LP_BURN',
        passed: pct >= minLpBurnedPct,
        verified: true,
        detail: `RugCheck LP Locked/Burned=${pct}% (min=${minLpBurnedPct}%)`,
        durationMs: Date.now() - t0,
        critical: true,
        lpBurnedPct: pct,
        lpBurnVerified: true,
      };
    }

    if (!lpMintAddress) {
      if (dex === 'PUMP_FUN') {
        return {
          layer: 'L2_LP_BURN',
          passed: true,
          verified: true,
          detail: `${dex} bonding-curve custody`,
          durationMs: Date.now() - t0,
          critical: false,
          lpBurnedPct: 100,
          lpBurnVerified: true,
        };
      }

      const hasDanger =
        rugCheck.available && rugCheck.risks.some((r) => r.level?.toLowerCase() === 'danger');
      // If L1 Mint & Freeze Auth are verified revoked on-chain and RugCheck isn't reporting Danger, treat missing LP index as soft penalty (non-critical) rather than blind hard block
      if (hasDanger) {
        return {
          layer: 'L2_LP_BURN',
          passed: false,
          verified: true,
          detail: 'Blocked: RugCheck flagged Danger risk with unverified LP lock',
          durationMs: Date.now() - t0,
          critical: true,
          lpBurnedPct: 0,
          lpBurnVerified: false,
        };
      }

      return {
        layer: 'L2_LP_BURN',
        passed: l1CleanVerified || rugCheck.available,
        verified: false,
        detail: l1CleanVerified
          ? 'UNVERIFIED LP lock pending RugCheck index (L1 verified; size scaled conservatively)'
          : 'UNVERIFIED LP lock (L1 & RugCheck unavailable)',
        durationMs: Date.now() - t0,
        critical: !l1CleanVerified,
        lpBurnedPct: 0,
        lpBurnVerified: false,
      };
    }

    try {
      const lpMint = new PublicKey(lpMintAddress);
      const [supplyRes, largestRes] = await Promise.all([
        this.rpcManager.withFallback((conn) => conn.getTokenSupply(lpMint, 'confirmed')),
        this.rpcManager.withFallback((conn) => conn.getTokenLargestAccounts(lpMint, 'confirmed')),
      ]);

      const totalSupply = Number(supplyRes.value.uiAmount ?? 0);
      if (totalSupply <= 0) {
        return {
          layer: 'L2_LP_BURN',
          passed: true,
          verified: true,
          detail: '100% LP supply burned to zero supply',
          durationMs: Date.now() - t0,
          critical: true,
          lpBurnedPct: 100,
          lpBurnVerified: true,
        };
      }

      let burnedOrLocked = 0;
      const topLp = largestRes.value.slice(0, 5);
      const parsedAccounts = await this.rpcManager.withFallback((conn) =>
        conn.getMultipleParsedAccounts(
          topLp.map((a) => a.address),
          { commitment: 'confirmed' },
        ),
      );

      for (let i = 0; i < topLp.length; i++) {
        const info = parsedAccounts.value[i]?.data;
        if (info && 'parsed' in info) {
          const owner = String((info.parsed as { info?: { owner?: string } }).info?.owner ?? '');
          if (BURN_ADDRESSES.has(owner)) {
            burnedOrLocked += Number(topLp[i].uiAmount ?? 0);
          }
        }
      }

      const lpBurnedPct = Math.min(100, Number(((burnedOrLocked / totalSupply) * 100).toFixed(2)));
      return {
        layer: 'L2_LP_BURN',
        passed: lpBurnedPct >= minLpBurnedPct,
        verified: true,
        detail: `LP Burned/Locked=${lpBurnedPct}% (min=${minLpBurnedPct}%)`,
        durationMs: Date.now() - t0,
        critical: true,
        lpBurnedPct,
        lpBurnVerified: true,
      };
    } catch {
      return {
        layer: 'L2_LP_BURN',
        passed: false,
        verified: false,
        detail: 'UNVERIFIED: Unable to verify LP burn ratio on-chain',
        durationMs: Date.now() - t0,
        critical: true,
        lpBurnedPct: 0,
        lpBurnVerified: false,
      };
    }
  }

  private async layer3HolderAndDevCheck(
    mint: PublicKey,
    poolAddress: string | undefined,
    creatorAddress: string | undefined,
    maxTop10HoldersPct: number,
    maxDevHoldPct: number,
    rugCheck: RugCheckFullReport,
    prefetchedSupplyUi?: number | null,
  ) {
    const t0 = Date.now();

    if (rugCheck.available && rugCheck.topHolders.length > 0) {
      const effectiveCreator = creatorAddress ?? rugCheck.creator ?? undefined;
      let top10Sum = 0;
      let counted = 0;
      let devHoldPct = 0;
      const pctBuckets = new Map<string, number>();

      for (let i = 0; i < rugCheck.topHolders.length; i++) {
        const h = rugCheck.topHolders[i];
        const owner = h.owner ?? '';
        const addr = h.address ?? '';
        const pct = Number(h.pct ?? 0);
        const isUnflaggedPoolVault =
          i === 0 && pct >= 40 && !h.insider && (!effectiveCreator || owner !== effectiveCreator);
        const isPool =
          addr === poolAddress ||
          owner === poolAddress ||
          KNOWN_POOL_AUTHORITIES.has(owner) ||
          BURN_ADDRESSES.has(owner) ||
          isUnflaggedPoolVault;
        if (isPool) continue;

        if (counted < 10) {
          top10Sum += pct;
          counted++;
          const roundedKey = pct.toFixed(2);
          pctBuckets.set(roundedKey, (pctBuckets.get(roundedKey) ?? 0) + 1);
        }
        if (effectiveCreator && owner === effectiveCreator) {
          devHoldPct += pct;
        }
      }

      // Sybil clone-wallet signature: multiple top holders holding near-identical % allocations
      const maxSameAlloc = Math.max(0, ...Array.from(pctBuckets.values()));
      const sybilScore = maxSameAlloc >= 3 ? Math.min(100, maxSameAlloc * 22) : 0;

      const top10HoldersPct = Number(top10Sum.toFixed(2));
      const devPct = Number(devHoldPct.toFixed(2));
      const passed =
        top10HoldersPct <= maxTop10HoldersPct &&
        devPct <= maxDevHoldPct &&
        sybilScore < 70;

      return {
        layer: 'L3_HOLDERS_DEV',
        passed,
        verified: true,
        detail: `Top10=${top10HoldersPct}% (max=${maxTop10HoldersPct}%), Dev=${devPct}% (max=${maxDevHoldPct}%), Sybil=${sybilScore}`,
        durationMs: Date.now() - t0,
        critical: false,
        top10HoldersPct,
        devHoldPct: devPct,
        sybilScore,
      };
    }

    try {
      const [supplyUiResolved, largestRes] = await Promise.all([
        prefetchedSupplyUi && prefetchedSupplyUi > 0
          ? Promise.resolve(prefetchedSupplyUi)
          : this.rpcManager
              .withFallback((conn) => conn.getTokenSupply(mint, 'confirmed'))
              .then((r) => Number(r.value.uiAmount ?? 0)),
        this.rpcManager.withFallback((conn) => conn.getTokenLargestAccounts(mint, 'confirmed')),
      ]);

      const totalSupply = supplyUiResolved;
      if (totalSupply <= 0) {
        return {
          layer: 'L3_HOLDERS_DEV',
          passed: false,
          verified: true,
          detail: 'Token total supply is 0',
          durationMs: Date.now() - t0,
          critical: true,
          top10HoldersPct: 100,
          devHoldPct: 0,
          sybilScore: 0,
        };
      }

      let nonPoolTop10Sum = 0;
      let counted = 0;
      let devHoldAmount = 0;

      const topAccounts = largestRes.value.slice(0, 15);
      const parsedInfos = await this.rpcManager.withFallback((conn) =>
        conn.getMultipleParsedAccounts(
          topAccounts.map((a) => a.address),
          { commitment: 'confirmed' },
        ),
      );

      for (let i = 0; i < topAccounts.length; i++) {
        const acc = topAccounts[i];
        const accInfo = parsedInfos.value[i];
        let owner = '';
        if (accInfo && accInfo.data && 'parsed' in accInfo.data) {
          owner = String((accInfo.data.parsed as { info?: { owner?: string } }).info?.owner ?? '');
        }

        const amt = Number(acc.uiAmount ?? 0);
        const pct = totalSupply > 0 ? (amt / totalSupply) * 100 : 0;
        const isUnflaggedPoolVault =
          i === 0 && pct >= 40 && (!creatorAddress || owner !== creatorAddress);

        const isPool =
          acc.address.toBase58() === poolAddress ||
          owner === poolAddress ||
          KNOWN_POOL_AUTHORITIES.has(owner) ||
          BURN_ADDRESSES.has(owner) ||
          isUnflaggedPoolVault;

        if (isPool) continue;

        if (counted < 10) {
          nonPoolTop10Sum += amt;
          counted++;
        }
        if (creatorAddress && owner === creatorAddress) {
          devHoldAmount += amt;
        }
      }

      const top10HoldersPct = Number(((nonPoolTop10Sum / totalSupply) * 100).toFixed(2));
      const devHoldPct = Number(((devHoldAmount / totalSupply) * 100).toFixed(2));
      const passed = top10HoldersPct <= maxTop10HoldersPct && devHoldPct <= maxDevHoldPct;

      return {
        layer: 'L3_HOLDERS_DEV',
        passed,
        verified: true,
        detail: `RPC Top10=${top10HoldersPct}% (max=${maxTop10HoldersPct}%), Dev=${devHoldPct}% (max=${maxDevHoldPct}%)`,
        durationMs: Date.now() - t0,
        critical: false,
        top10HoldersPct,
        devHoldPct,
        sybilScore: 0,
      };
    } catch {
      return {
        layer: 'L3_HOLDERS_DEV',
        passed: false,
        verified: false,
        detail: 'UNVERIFIED: Holder telemetry unavailable from both RugCheck & RPC',
        durationMs: Date.now() - t0,
        critical: false,
        top10HoldersPct: 0,
        devHoldPct: 0,
        sybilScore: 40,
      };
    }
  }

  private async layer4AntiBundleAndSybil(
    mint: PublicKey,
    launchSlot: number | undefined,
    maxBundleSupplyPct: number,
    rugCheck: RugCheckFullReport,
    discoveryMode: RuntimeConfig['discoveryMode'],
    antiBundleCheckEnabled = true,
    prefetchedSupplyUi?: number | null,
  ) {
    const t0 = Date.now();

    if (!antiBundleCheckEnabled) {
      return {
        layer: 'L4_ANTI_BUNDLE',
        passed: true,
        verified: false,
        detail: 'Anti-Bundle Check OFF (Unverified fast entry)',
        durationMs: Date.now() - t0,
        critical: false,
        bundleSupplyPct: 0,
        sybilScore: 0,
        insidersDetected: rugCheck.insidersDetected,
      };
    }

    if (discoveryMode === 'FREE_FEED' && !this.rpcManager.isPaidPlan()) {
      if (rugCheck.available) {
        const insiderPct = Number(
          rugCheck.topHolders
            .filter((h) => h.insider)
            .reduce((sum, h) => sum + Number(h.pct ?? 0), 0)
            .toFixed(2),
        );
        const passed = insiderPct <= maxBundleSupplyPct;
        return {
          layer: 'L4_ANTI_BUNDLE',
          passed,
          verified: true,
          detail: `RugCheck Insiders=${rugCheck.insidersDetected} (${insiderPct}% <= ${maxBundleSupplyPct}%)`,
          durationMs: Date.now() - t0,
          critical: true,
          bundleSupplyPct: insiderPct,
          sybilScore: Math.min(100, rugCheck.insidersDetected * 16),
          insidersDetected: rugCheck.insidersDetected,
        };
      }
      return {
        layer: 'L4_ANTI_BUNDLE',
        passed: true,
        verified: false,
        detail: 'UNVERIFIED: RugCheck bundle telemetry pending',
        durationMs: Date.now() - t0,
        critical: false,
        bundleSupplyPct: 0,
        sybilScore: 25,
        insidersDetected: 0,
      };
    }

    try {
      const [totalSupply, sigs] = await Promise.all([
        prefetchedSupplyUi && prefetchedSupplyUi > 0
          ? Promise.resolve(prefetchedSupplyUi)
          : this.rpcManager
              .withFallback((conn) => conn.getTokenSupply(mint, 'confirmed'))
              .then((r) => Number(r.value.uiAmount ?? 0)),
        this.rpcManager.withFallback((conn) =>
          conn.getSignaturesForAddress(mint, { limit: 20 }, 'confirmed'),
        ),
      ]);
      if (totalSupply <= 0 || sigs.length === 0) {
        return {
          layer: 'L4_ANTI_BUNDLE',
          passed: true,
          verified: true,
          detail: 'No Block-0 bundle anomalies detected',
          durationMs: Date.now() - t0,
          critical: true,
          bundleSupplyPct: 0,
          sybilScore: 0,
          insidersDetected: rugCheck.insidersDetected,
        };
      }

      const targetSlot = launchSlot || sigs[sigs.length - 1].slot;
      const blockZeroSigs = sigs
        .filter((s) => !s.err && Math.abs(s.slot - targetSlot) <= 1)
        .map((s) => s.signature)
        .slice(0, 10);

      if (blockZeroSigs.length < 2) {
        return {
          layer: 'L4_ANTI_BUNDLE',
          passed: true,
          verified: true,
          detail: `Block-0 tx count=${blockZeroSigs.length} (no coordinated bundle)`,
          durationMs: Date.now() - t0,
          critical: true,
          bundleSupplyPct: 0,
          sybilScore: 0,
          insidersDetected: rugCheck.insidersDetected,
        };
      }

      const parsedTxs = await this.rpcManager.withFallback((conn) =>
        conn.getParsedTransactions(blockZeroSigs, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }),
      );

      const slotAccumulatedTokens = new Map<string, number>();
      for (const tx of parsedTxs) {
        if (!tx?.meta?.postTokenBalances) continue;
        const preMap = new Map<string, number>();
        for (const pre of tx.meta.preTokenBalances ?? []) {
          if (pre.mint === mint.toBase58() && pre.owner) {
            preMap.set(pre.owner, Number(pre.uiTokenAmount.uiAmount ?? 0));
          }
        }
        for (const post of tx.meta.postTokenBalances) {
          if (post.mint === mint.toBase58() && post.owner) {
            const delta = Number(post.uiTokenAmount.uiAmount ?? 0) - (preMap.get(post.owner) ?? 0);
            if (delta > 0) {
              slotAccumulatedTokens.set(
                post.owner,
                (slotAccumulatedTokens.get(post.owner) ?? 0) + delta,
              );
            }
          }
        }
      }

      const totalBundledTokens = Array.from(slotAccumulatedTokens.values()).reduce(
        (acc, val) => acc + val,
        0,
      );
      const bundleSupplyPct = Number(((totalBundledTokens / totalSupply) * 100).toFixed(2));
      const sybilScore = Math.min(100, slotAccumulatedTokens.size >= 4 ? Math.round(bundleSupplyPct * 2) : 0);
      const passed =
        slotAccumulatedTokens.size <= 2 || bundleSupplyPct <= maxBundleSupplyPct;

      return {
        layer: 'L4_ANTI_BUNDLE',
        passed,
        verified: true,
        detail: `Block-0 wallets=${slotAccumulatedTokens.size}, bundled=${bundleSupplyPct}% (max=${maxBundleSupplyPct}%)`,
        durationMs: Date.now() - t0,
        critical: true,
        bundleSupplyPct,
        sybilScore,
        insidersDetected: rugCheck.insidersDetected,
      };
    } catch {
      return {
        layer: 'L4_ANTI_BUNDLE',
        passed: false,
        verified: false,
        detail: 'UNVERIFIED: Block-0 bundle scan failed/timed out',
        durationMs: Date.now() - t0,
        critical: true,
        bundleSupplyPct: 0,
        sybilScore: 50,
        insidersDetected: rugCheck.insidersDetected,
      };
    }
  }

  private async layer5RugCheckAndHoneypot(
    cfg: RuntimeConfig,
    rugRes: RugCheckFullReport,
    preHpRes: Awaited<ReturnType<TransactionSimulator['simulateSellHoneypotCheck']>> | null,
  ) {
    const t0 = Date.now();
    const hpVerified = !cfg.honeypotSimEnabled ? false : preHpRes !== null && preHpRes.indexed;
    const hpRes = !cfg.honeypotSimEnabled
      ? {
          passed: true,
          indexed: false,
          estimatedTaxPct: 0,
          roundTripLossPct: 0,
          detail: 'Honeypot Sim OFF (Unverified fast entry)',
        }
      : preHpRes ?? {
          passed: false,
          indexed: false,
          estimatedTaxPct: 100,
          roundTripLossPct: 100,
          detail: 'UNVERIFIED Honeypot Sim failed/timed out',
        };

    const dangerRisk = rugRes.risks.find((r) => r.level?.toLowerCase() === 'danger');
    const rugcheckRiskLevel = !rugRes.available
      ? 'Unindexed'
      : dangerRisk
        ? `Danger: ${dangerRisk.name}`
        : rugRes.score !== null && rugRes.score > 2000
          ? `Warn (${rugRes.score})`
          : 'Good';

    const rugPassed = !rugRes.available || !dangerRisk;
    const verified = rugRes.available || hpVerified;
    const passed = hpRes.passed && rugPassed;

    return {
      layer: 'L5_RUGCHECK_HONEYPOT',
      passed,
      verified,
      detail: `RugCheck=${rugcheckRiskLevel} | Honeypot=${hpRes.passed ? 'OK' : 'BLOCKED'} (${hpRes.detail})`,
      durationMs: Date.now() - t0,
      critical: true,
      rugcheckScore: rugRes.score,
      rugcheckRiskLevel,
      honeypotPassed: hpRes.passed,
    };
  }
}
