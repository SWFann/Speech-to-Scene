/**
 * LinkSuggestionGenerator implementation.
 *
 * Pure function that generates "search link card" candidates (kind: "link")
 * for platforms without a usable search API.
 *
 * Platforms are grouped into three categories:
 * - video_platform: 小红书, 抖音, B站, 快手, 西瓜视频, YouTube
 * - stock_site: 包图网, 千图网, 摄图网, 觅知网, 站酷, 花瓣网
 * - social_media: 微博, 知乎
 *
 * No network, no I/O, no side effects. Easy to unit-test.
 */

import type { LinkSuggestionGenerator } from "../application/search-project-assets.js";
import type {
  AssetCandidateLink,
  LinkPlatform,
  CandidateCategory,
} from "../domain/asset-schema.js";
import { platformToCategory } from "../domain/asset-schema.js";

// ---------------------------------------------------------------------------
// Platform definitions
// ---------------------------------------------------------------------------

interface PlatformConfig {
  readonly platform: LinkPlatform;
  readonly buildUrl: (encodedKeyword: string) => string;
  readonly category: CandidateCategory;
}

const PLATFORMS: readonly PlatformConfig[] = [
  // Video platforms
  {
    platform: "xiaohongshu",
    buildUrl: (kw) => `https://www.xiaohongshu.com/search_result?keyword=${kw}`,
    category: "video_platform",
  },
  {
    platform: "douyin",
    buildUrl: (kw) => `https://www.douyin.com/search/${kw}`,
    category: "video_platform",
  },
  {
    platform: "bilibili",
    buildUrl: (kw) => `https://search.bilibili.com/all?keyword=${kw}`,
    category: "video_platform",
  },
  {
    platform: "kuaishou",
    buildUrl: (kw) => `https://www.kuaishou.com/search/video?searchKey=${kw}`,
    category: "video_platform",
  },
  {
    platform: "xigua",
    buildUrl: (kw) => `https://www.ixigua.com/search/${kw}/`,
    category: "video_platform",
  },
  {
    platform: "youtube",
    buildUrl: (kw) => `https://www.youtube.com/results?search_query=${kw}`,
    category: "video_platform",
  },
  // Stock material sites
  {
    platform: "baotu",
    buildUrl: (kw) => `https://ibaotu.com/sucai/${kw}-0-0-0-0-0-0-0-1.html`,
    category: "stock_site",
  },
  {
    platform: "588ku",
    buildUrl: (kw) => `https://588ku.com/sucai/${kw}.html`,
    category: "stock_site",
  },
  {
    platform: "699pic",
    buildUrl: (kw) => `https://699pic.com/search-${kw}.html`,
    category: "stock_site",
  },
  {
    platform: "mizhi",
    buildUrl: (kw) => `https://www.51miz.com/search/${kw}/`,
    category: "stock_site",
  },
  {
    platform: "zcool",
    buildUrl: (kw) => `https://www.zcool.com.cn/search/content?word=${kw}`,
    category: "stock_site",
  },
  {
    platform: "huaban",
    buildUrl: (kw) => `https://huaban.com/search/${kw}`,
    category: "stock_site",
  },
  // Social media
  {
    platform: "weibo",
    buildUrl: (kw) => `https://s.weibo.com/weibo?q=${kw}`,
    category: "social_media",
  },
  {
    platform: "zhihu",
    buildUrl: (kw) => `https://www.zhihu.com/search?q=${kw}&type=content`,
    category: "social_media",
  },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Default LinkSuggestionGenerator implementation.
 *
 * Generates one link candidate per platform from a single keyword.
 * Each candidate includes a `category` field for UI grouping.
 * Ranks are assigned in platform order (1..N).
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
        category: platformToCategory(config.platform),
      };
      results.push(candidate);
    });

    return results;
  }
}
