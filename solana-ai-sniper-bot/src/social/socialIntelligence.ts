import { sharedHttpClient } from '../core/httpClient';
import {
  NarrativeCategory,
  SocialIntelligenceResult,
  TokenMetadata,
} from '../core/types';

/**
 * Module 12: Social & Narrative Intelligence Engine
 * - Classifies memecoin narratives (AI_AGENT, MEME_CULTURE, POLITIFI, DEFI_UTILITY, GAMING)
 * - Evaluates X/Twitter (optional bearer search) + Telegram + Website presence
 * - Detects fake boosted engagement when social hype spikes without organic buyer depth
 */
export class SocialIntelligenceEngine {
  constructor(private readonly twitterBearerToken = '') {}

  public classifyNarrative(name: string, symbol: string, description: string): NarrativeCategory {
    const text = `${name} ${symbol} ${description}`.toLowerCase();
    if (/(ai|agent|gpt|llm|neural|claude|grok|bot|compute|agi)/.test(text)) {
      return 'AI_AGENT';
    }
    if (/(trump|biden|maga|politi|usa|senate|vote|presiden)/.test(text)) {
      return 'POLITIFI';
    }
    if (/(swap|dex|yield|stake|vault|bridge|defi|protocol|lend)/.test(text)) {
      return 'DEFI_UTILITY';
    }
    if (/(game|rpg|quest|play|arena|pixel|nft|metaverse)/.test(text)) {
      return 'GAMING';
    }
    if (text.trim().length > 2) {
      return 'MEME_CULTURE';
    }
    return 'UNKNOWN';
  }

  public async analyzeSocial(params: {
    metadata: TokenMetadata;
    uniqueBuyers: number;
    buyCount: number;
    dexBoosted?: boolean;
  }): Promise<SocialIntelligenceResult> {
    const { metadata, uniqueBuyers, buyCount } = params;
    const twitterPresent = Boolean(metadata.twitter && metadata.twitter.length > 5);
    const telegramPresent = Boolean(metadata.telegram && metadata.telegram.length > 5);
    const websitePresent = Boolean(metadata.website && metadata.website.length > 5);
    const dexBoosted = Boolean(params.dexBoosted || metadata.dexBoosted);

    const narrative = this.classifyNarrative(
      metadata.name,
      metadata.symbol,
      metadata.description,
    );

    let twitterMentionsRecent = 0;
    let influencerSignalScore = 0;

    // Optional live X/Twitter v2 recent search when bearer token is configured
    if (this.twitterBearerToken && metadata.symbol.length >= 2) {
      try {
        const query = encodeURIComponent(`($${metadata.symbol} OR ${metadata.mint}) solana -is:retweet`);
        const data = await sharedHttpClient.get<{
          meta?: { result_count?: number };
          data?: Array<{ public_metrics?: { like_count?: number; retweet_count?: number } }>;
        }>(`https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=public_metrics`, {
          axiosConfig: {
            headers: { Authorization: `Bearer ${this.twitterBearerToken}` },
            timeout: 1800,
          },
          maxRetries: 1,
        });
        twitterMentionsRecent = data?.meta?.result_count ?? 0;
        const totalLikes = (data?.data ?? []).reduce(
          (acc, t) => acc + (t.public_metrics?.like_count ?? 0) + (t.public_metrics?.retweet_count ?? 0) * 2,
          0,
        );
        influencerSignalScore = Math.min(100, twitterMentionsRecent * 3 + Math.round(totalLikes / 4));
      } catch {
        // Non-fatal rate limit / missing permissions
      }
    }

    // Mention velocity approximation from on-chain buyer velocity + DexScreener boosts + X telemetry
    const ageMin = Math.max(1, metadata.ageMinutes ?? 5);
    const buyerVelocityPerHr = (Math.max(uniqueBuyers, buyCount) / ageMin) * 60;
    const mentionVelocityPerHr = Number(
      (twitterMentionsRecent * 6 + buyerVelocityPerHr * 0.4 + (dexBoosted ? 15 : 0)).toFixed(1),
    );

    // Fake engagement detection: DexScreener paid boost or Twitter mention burst with < 4 organic buyers
    const fakeEngagementSuspected =
      (dexBoosted && uniqueBuyers < 4) ||
      (twitterMentionsRecent >= 12 && uniqueBuyers < 3) ||
      (twitterPresent && !telegramPresent && buyCount >= 12 && uniqueBuyers <= 3);

    const linkBonus =
      (twitterPresent ? 16 : 0) +
      (telegramPresent ? 14 : 0) +
      (websitePresent ? 8 : 0) +
      (dexBoosted ? 6 : 0);

    const narrativeBonus =
      narrative === 'AI_AGENT' ? 12 : narrative === 'MEME_CULTURE' ? 7 : narrative === 'DEFI_UTILITY' ? 8 : 4;

    if (influencerSignalScore === 0 && twitterPresent) {
      influencerSignalScore = dexBoosted ? 45 : 30;
    }

    const sentimentScore = Number(
      Math.max(
        15,
        Math.min(
          95,
          42 + linkBonus * 0.6 + narrativeBonus + Math.min(25, buyerVelocityPerHr * 0.15) - (fakeEngagementSuspected ? 28 : 0),
        ),
      ).toFixed(1),
    );

    const narrativeGrowthScore = Number(
      Math.max(
        10,
        Math.min(
          98,
          35 + narrativeBonus * 1.4 + Math.min(35, mentionVelocityPerHr * 0.25) - (fakeEngagementSuspected ? 25 : 0),
        ),
      ).toFixed(1),
    );

    let socialScore = 30 + linkBonus + narrativeBonus + Math.min(20, Math.round(mentionVelocityPerHr * 0.15));
    if (fakeEngagementSuspected) socialScore -= 24;
    socialScore = Number(Math.max(5, Math.min(100, socialScore)).toFixed(1));

    return {
      socialScore,
      narrative,
      twitterPresent,
      telegramPresent,
      websitePresent,
      mentionVelocityPerHr,
      fakeEngagementSuspected,
      influencerSignalScore,
      narrativeGrowthScore,
      sentimentScore,
      reason: `Social=${socialScore}/100 (${narrative}) | X=${twitterPresent ? 'Y' : 'N'} TG=${telegramPresent ? 'Y' : 'N'} Web=${websitePresent ? 'Y' : 'N'}${fakeEngagementSuspected ? ' | ⚠️ FAKE_HYPE_RISK' : ''}`,
    };
  }
}
