/**
 * Unit tests for DefaultLinkSuggestionGenerator.
 *
 * Verifies:
 *  1. All 14 platforms generate link candidates
 *  2. Each platform gets the correct category
 *  3. URLs contain the encoded keyword
 *  4. Ranks are sequential 1..N
 *  5. platformToCategory mapping is correct
 */
import { describe, it, expect } from "vitest";

import { DefaultLinkSuggestionGenerator } from "../../src/infrastructure/link-suggestion-generator.js";
import { platformToCategory, type LinkPlatform } from "../../src/domain/asset-schema.js";

describe("DefaultLinkSuggestionGenerator", (): void => {
  const generator = new DefaultLinkSuggestionGenerator();

  const input = {
    keyword: "测试关键词",
    matchedQueryId: "q-1-1",
    retrievedAt: "2025-01-01T00:00:00.000Z",
  };

  describe("generateLinks", (): void => {
    const links = generator.generateLinks(input);

    it("generates one link per platform (14 total)", (): void => {
      expect(links).toHaveLength(14);
    });

    it("assigns sequential ranks 1..14", (): void => {
      const ranks = links.map((l) => l.rank);
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it("includes all expected platforms", (): void => {
      const platforms = links.map((l) => l.platform);
      expect(platforms).toContain("xiaohongshu");
      expect(platforms).toContain("douyin");
      expect(platforms).toContain("bilibili");
      expect(platforms).toContain("kuaishou");
      expect(platforms).toContain("xigua");
      expect(platforms).toContain("youtube");
      expect(platforms).toContain("baotu");
      expect(platforms).toContain("588ku");
      expect(platforms).toContain("699pic");
      expect(platforms).toContain("mizhi");
      expect(platforms).toContain("zcool");
      expect(platforms).toContain("huaban");
      expect(platforms).toContain("weibo");
      expect(platforms).toContain("zhihu");
    });

    it("sets kind='link' on all candidates", (): void => {
      for (const link of links) {
        expect(link.kind).toBe("link");
      }
    });

    it("sets the keyword on all candidates", (): void => {
      for (const link of links) {
        expect(link.keyword).toBe("测试关键词");
      }
    });

    it("encodes the keyword in searchUrl", (): void => {
      const encoded = encodeURIComponent("测试关键词");
      for (const link of links) {
        expect(link.searchUrl).toContain(encoded);
      }
    });

    it("sets matchedQueryId and retrievedAt", (): void => {
      for (const link of links) {
        expect(link.matchedQueryId).toBe("q-1-1");
        expect(link.retrievedAt).toBe("2025-01-01T00:00:00.000Z");
      }
    });

    it("generates unique IDs per platform", (): void => {
      const ids = links.map((l) => l.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("category assignment", (): void => {
    const links = generator.generateLinks(input);

    it("assigns video_platform to xiaohongshu, douyin, bilibili, kuaishou, xigua, youtube", (): void => {
      const videoPlatforms = links.filter((l) => l.category === "video_platform");
      const platformNames = videoPlatforms.map((l) => l.platform);
      expect(platformNames.sort()).toEqual(
        ["bilibili", "douyin", "kuaishou", "xiaohongshu", "xigua", "youtube"].sort(),
      );
    });

    it("assigns stock_site to baotu, 588ku, 699pic, mizhi, zcool, huaban", (): void => {
      const stockSites = links.filter((l) => l.category === "stock_site");
      const platformNames = stockSites.map((l) => l.platform);
      expect(platformNames.sort()).toEqual(
        ["588ku", "699pic", "baotu", "huaban", "mizhi", "zcool"].sort(),
      );
    });

    it("assigns social_media to weibo, zhihu", (): void => {
      const socialMedia = links.filter((l) => l.category === "social_media");
      const platformNames = socialMedia.map((l) => l.platform);
      expect(platformNames.sort()).toEqual(["weibo", "zhihu"].sort());
    });

    it("every link has a category field", (): void => {
      for (const link of links) {
        expect(link.category).toBeDefined();
      }
    });
  });

  describe("platformToCategory", (): void => {
    const cases: Array<{ platform: LinkPlatform; expected: string }> = [
      { platform: "xiaohongshu", expected: "video_platform" },
      { platform: "douyin", expected: "video_platform" },
      { platform: "bilibili", expected: "video_platform" },
      { platform: "kuaishou", expected: "video_platform" },
      { platform: "xigua", expected: "video_platform" },
      { platform: "youtube", expected: "video_platform" },
      { platform: "baotu", expected: "stock_site" },
      { platform: "588ku", expected: "stock_site" },
      { platform: "699pic", expected: "stock_site" },
      { platform: "mizhi", expected: "stock_site" },
      { platform: "zcool", expected: "stock_site" },
      { platform: "huaban", expected: "stock_site" },
      { platform: "weibo", expected: "social_media" },
      { platform: "zhihu", expected: "social_media" },
    ];

    for (const { platform, expected } of cases) {
      it(`maps ${platform} → ${expected}`, (): void => {
        expect(platformToCategory(platform)).toBe(expected);
      });
    }
  });

  describe("URL construction", (): void => {
    const links = generator.generateLinks(input);
    const linkByPlatform = new Map(links.map((l) => [l.platform, l]));

    it("builds xiaohongshu search URL", (): void => {
      expect(linkByPlatform.get("xiaohongshu")!.searchUrl).toContain("xiaohongshu.com/search_result");
    });

    it("builds douyin search URL", (): void => {
      expect(linkByPlatform.get("douyin")!.searchUrl).toContain("douyin.com/search");
    });

    it("builds bilibili search URL", (): void => {
      expect(linkByPlatform.get("bilibili")!.searchUrl).toContain("search.bilibili.com");
    });

    it("builds kuaishou search URL", (): void => {
      expect(linkByPlatform.get("kuaishou")!.searchUrl).toContain("kuaishou.com/search");
    });

    it("builds xigua search URL", (): void => {
      expect(linkByPlatform.get("xigua")!.searchUrl).toContain("ixigua.com/search");
    });

    it("builds youtube search URL", (): void => {
      expect(linkByPlatform.get("youtube")!.searchUrl).toContain("youtube.com/results");
    });

    it("builds baotu search URL", (): void => {
      expect(linkByPlatform.get("baotu")!.searchUrl).toContain("ibaotu.com/sucai");
    });

    it("builds 588ku search URL", (): void => {
      expect(linkByPlatform.get("588ku")!.searchUrl).toContain("588ku.com/sucai");
    });

    it("builds 699pic search URL", (): void => {
      expect(linkByPlatform.get("699pic")!.searchUrl).toContain("699pic.com/search");
    });

    it("builds mizhi search URL", (): void => {
      expect(linkByPlatform.get("mizhi")!.searchUrl).toContain("51miz.com/search");
    });

    it("builds zcool search URL", (): void => {
      expect(linkByPlatform.get("zcool")!.searchUrl).toContain("zcool.com.cn/search");
    });

    it("builds huaban search URL", (): void => {
      expect(linkByPlatform.get("huaban")!.searchUrl).toContain("huaban.com/search");
    });

    it("builds weibo search URL", (): void => {
      expect(linkByPlatform.get("weibo")!.searchUrl).toContain("s.weibo.com/weibo");
    });

    it("builds zhihu search URL", (): void => {
      expect(linkByPlatform.get("zhihu")!.searchUrl).toContain("zhihu.com/search");
    });
  });
});
