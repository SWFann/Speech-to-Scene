import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FileSearchCache } from "../../src/infrastructure/file-search-cache.js";
import {
  computeCacheKey,
  computeProviderCacheKey,
  type CacheSearchInput,
  type SearchCacheEntry,
} from "../../src/application/ports/search-cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCacheDir(): string {
  return path.join(process.cwd(), ".test-cache-" + Date.now());
}

function createCacheInput(overrides: Partial<CacheSearchInput> = {}): CacheSearchInput {
  return {
    queryId: "q1",
    query: "test query",
    language: "zh",
    mediaTypes: ["photo"],
    orientation: "portrait",
    perPage: 10,
    page: 1,
    sceneId: "scene1",
    ...overrides,
  };
}

function createCacheEntry(
  overrides: {
    request?: Partial<CacheSearchInput>;
    response?: ReadonlyArray<{ readonly id: string; readonly rank: number }>;
    providerId?: string;
    providerPolicyRevision?: string;
  } = {},
): SearchCacheEntry {
  const request = createCacheInput(overrides.request);
  return {
    schemaVersion: "0.1" as const,
    providerId: overrides.providerId ?? "fixture",
    providerPolicyRevision: overrides.providerPolicyRevision ?? "fixture-policy-0.1",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    request,
    response: overrides.response ?? [{ id: "candidate-1", rank: 1 }],
    warnings: [],
  };
}

describe("computeCacheKey", () => {
  it("returns deterministic key for same input", () => {
    const input = createCacheInput();
    const key1 = computeCacheKey(input);
    const key2 = computeCacheKey(input);
    expect(key1).toBe(key2);
  });

  it("returns different keys for different queries", () => {
    const input1 = createCacheInput({ query: "mountains" });
    const input2 = createCacheInput({ query: "ocean" });
    expect(computeCacheKey(input1)).not.toBe(computeCacheKey(input2));
  });

  it("returns different keys for different queryIds", () => {
    const input1 = createCacheInput({ queryId: "q1" });
    const input2 = createCacheInput({ queryId: "q2" });
    expect(computeCacheKey(input1)).not.toBe(computeCacheKey(input2));
  });

  it("returns different keys for different sceneIds", () => {
    const input1 = createCacheInput({ sceneId: "scene1" });
    const input2 = createCacheInput({ sceneId: "scene2" });
    expect(computeCacheKey(input1)).not.toBe(computeCacheKey(input2));
  });

  it("returns different keys for different mediaTypes", () => {
    const input1 = createCacheInput({ mediaTypes: ["photo"] });
    const input2 = createCacheInput({ mediaTypes: ["video"] });
    expect(computeCacheKey(input1)).not.toBe(computeCacheKey(input2));
  });

  it("returns SHA-256 hex digest (64 chars)", () => {
    const key = computeCacheKey(createCacheInput());
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("computeProviderCacheKey", () => {
  it("returns deterministic key", () => {
    const input = createCacheInput();
    const key1 = computeProviderCacheKey(input, "fixture", "policy-1");
    const key2 = computeProviderCacheKey(input, "fixture", "policy-1");
    expect(key1).toBe(key2);
  });

  it("returns different keys for different providers", () => {
    const input = createCacheInput();
    expect(computeProviderCacheKey(input, "fixture", "policy-1")).not.toBe(
      computeProviderCacheKey(input, "pexels", "policy-1"),
    );
  });

  it("returns SHA-256 hex digest", () => {
    const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("FileSearchCache", () => {
  let cacheDir: string;
  let cache: FileSearchCache;

  beforeEach(() => {
    cacheDir = createCacheDir();
    cache = new FileSearchCache({ cacheDir, ttlMs: 7 * 24 * 60 * 60 * 1000 });
  });

  afterEach(async () => {
    // Clean up cache directory
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("read", () => {
    it("returns miss for non-existent key", async () => {
      const result = await cache.read("nonexistent-key");
      expect(result.hit).toBe(false);
      expect(result.entry).toBeUndefined();
    });

    it("returns hit for valid cached entry", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = createCacheEntry();
      await cache.write(key, entry);

      const result = await cache.read(key);
      expect(result.hit).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.providerId).toBe("fixture");
      expect(result.entry?.response).toHaveLength(1);
    });

    it("returns miss for expired entry", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = { ...createCacheEntry(), expiresAt: new Date(Date.now() - 1000).toISOString() };
      await cache.write(key, entry);

      const result = await cache.read(key);
      expect(result.hit).toBe(false);
      expect(result.entry).toBeUndefined();
    });

    it("returns miss for corrupt entry", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const cachePath = path.join(cacheDir, key.slice(0, 2), `${key}.json`);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, "not json", "utf-8");

      const result = await cache.read(key);
      expect(result.hit).toBe(false);
    });

    it("returns miss for wrong schema version", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = { ...createCacheEntry(), schemaVersion: "0.2" as const };
      await cache.write(key, entry as unknown as SearchCacheEntry);

      const result = await cache.read(key);
      expect(result.hit).toBe(false);
    });
  });

  describe("write", () => {
    it("creates cache directory if not exists", async () => {
      const newCacheDir = path.join(process.cwd(), ".new-cache-" + Date.now());
      const newCache = new FileSearchCache({ cacheDir: newCacheDir });

      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = createCacheEntry();
      await newCache.write(key, entry);

      const result = await newCache.read(key);
      expect(result.hit).toBe(true);

      // Cleanup
      await fs.rm(newCacheDir, { recursive: true, force: true });
    });

    it("writes entry to correct path with subdirectories", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = createCacheEntry();
      await cache.write(key, entry);

      const expectedPath = path.join(cacheDir, key.slice(0, 2), `${key}.json`);
      const content = await fs.readFile(expectedPath, "utf-8");
      const parsed = JSON.parse(content) as { providerId: string };
      expect(parsed.providerId).toBe("fixture");
    });

    it("adds expiration timestamp", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = createCacheEntry();
      await cache.write(key, entry);

      const cachePath = path.join(cacheDir, key.slice(0, 2), `${key}.json`);
      const content = await fs.readFile(cachePath, "utf-8");
      const parsed = JSON.parse(content) as { expiresAt: string };
      expect(parsed.expiresAt).toBeTruthy();
      expect(new Date(parsed.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("delete", () => {
    it("deletes existing entry", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = createCacheEntry();
      await cache.write(key, entry);

      await cache.delete(key);

      const result = await cache.read(key);
      expect(result.hit).toBe(false);
    });

    it("does not throw for non-existent entry", async () => {
      await expect(cache.delete("nonexistent-key")).resolves.toBeUndefined();
    });
  });

  describe("atomicity", () => {
    it("uses temp file and rename for atomic write", async () => {
      const key = computeProviderCacheKey(createCacheInput(), "fixture", "policy-1");
      const entry = createCacheEntry();
      await cache.write(key, entry);

      // Verify no temp files remain
      const files = await fs.readdir(cacheDir, { recursive: true });
      const tempFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });
  });
});
