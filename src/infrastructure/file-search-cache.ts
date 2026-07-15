/**
 * File-based search cache implementation.
 *
 * Stores cache entries as JSON files on disk with atomic writes.
 * Entries are keyed by a deterministic hash of the search input and provider state.
 *
 * This implements the SearchCache interface defined in the Application port.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  SearchCache,
  SearchCacheEntry,
  CacheReadResult,
  FileSearchCacheOptions,
} from "../application/ports/search-cache.js";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FileSearchCache implements SearchCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;

  constructor(options: FileSearchCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
  }

  /**
   * Read a cache entry by key.
   */
  async read(key: string): Promise<CacheReadResult> {
    const filePath = this.keyToPath(key);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const entry = JSON.parse(content) as SearchCacheEntry;

      // Validate schema version
      if (entry.schemaVersion !== "0.1") {
        return { hit: false };
      }

      // Check expiration
      const expiresAt = new Date(entry.expiresAt);
      if (expiresAt < new Date()) {
        // Expired - delete and return miss
        await this.delete(key);
        return { hit: false };
      }

      return { hit: true, entry };
    } catch {
      // File doesn't exist or is corrupt - cache miss
      return { hit: false };
    }
  }

  /**
   * Write a cache entry atomically.
   */
  async write(key: string, entry: SearchCacheEntry): Promise<void> {
    // Ensure cache directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });

    const filePath = this.keyToPath(key);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    // Ensure parent directory for subdirectory sharding exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Set expiration based on TTL (preserve existing expiresAt if present)
    const expiresAt = entry.expiresAt ?? new Date(Date.now() + this.ttlMs).toISOString();

    const entryWithExpiry: SearchCacheEntry = {
      ...entry,
      expiresAt,
    };

    // Atomic write: write to temp file, then rename
    const json = JSON.stringify(entryWithExpiry, null, 2) + "\n";
    await fs.writeFile(tempPath, json, "utf-8");
    await fs.rename(tempPath, filePath);
  }

  /**
   * Delete a cache entry by key.
   */
  async delete(key: string): Promise<void> {
    const filePath = this.keyToPath(key);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Converts a cache key to a file path.
   */
  private keyToPath(key: string): string {
    // Use first 2 chars as subdirectory for better filesystem performance
    const subdir = key.slice(0, 2);
    return path.join(this.cacheDir, subdir, `${key}.json`);
  }
}
