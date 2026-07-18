/**
 * LinkSuggestionGenerator implementation.
 *
 * Pure function that generates "search link card" candidates (kind: "link")
 * for platforms without a usable search API (Xiaohongshu/Douyin/Bilibili/YouTube).
 *
 * No network, no I/O, no side effects. Easy to unit-test.
 */

import type { LinkSuggestionGenerator } from "../application/search-project-assets.js";
import type { AssetCandidateLink } from "../domain/asset-schema.js";

// ---------------------------------------------------------------------------
// Platform definitions
// ---------------------------------------------------------------------------

interface PlatformConfig {
  readonly platform: "xiaohongshu" | "douyin" | "bilibili" | "youtube";
  readonly buildUrl: (encodedKeyword: string) => string;
}

const PLATFORMS: readonly PlatformConfig[] = [
  {
    platform: "xiaohongshu",
    buildUrl: (kw) => `https://www.xiaohongshu.com/search_result?keyword=${kw}`,
  },
  {
    platform: "douyin",
    buildUrl: (kw) => `https://www.douyin.com/search/${kw}`,
  },
  {
    platform: "bilibili",
    buildUrl: (kw) => `https://search.bilibili.com/all?keyword=${kw}`,
  },
  {
    platform: "youtube",
    buildUrl: (kw) => `https://www.youtube.com/results?search_query=${kw}`,
  },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Default LinkSuggestionGenerator implementation.
 *
 * Generates one link candidate per platform (4 total) from a single keyword.
 * Ranks are assigned in platform order (1..4).
 */
export class DefaultLinkSuggestionGenerator implements LinkSuggestionGenerator {
  generateLinks(input: {
    readonly keyword: string;
    readonly matchedQueryId: string;
    readonly retrievedAt: string;
  }): AssetCandidateLink[] {
    const encodedKeyword = encodeURIComponent(input.keyword);
    const results: AssetCandidateLink[] = [];

    PLATFORMS.forEach((config, index) => {
      const rank = index + 1;
      const searchUrl = config.buildUrl(encodedKeyword);
      const candidate: AssetCandidateLink = {
        kind: "link",
        id: `link-${config.platform}-${input.matchedQueryId}`,
        platform: config.platform,
        searchUrl,
        keyword: input.keyword,
        retrievedAt: input.retrievedAt,
        matchedQueryId: input.matchedQueryId,
        rank,
      };
      results.push(candidate);
    });

    return results;
  }
}
