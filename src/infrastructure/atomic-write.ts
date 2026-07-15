/**
 * Atomic file write utility.
 *
 * Writes bytes to a temporary file in the same directory as the target,
 * then atomically publishes via `rename`. This ensures:
 * - Concurrent readers never see partial writes.
 * - The target is either the old complete version or the new complete version.
 * - Temp files are cleaned up on failure.
 *
 * Naming convention:
 *   `.project.s2s.json.<pid>.<uuid>.tmp`
 *
 * Cross-platform notes:
 * - On Linux/macOS, `rename` is atomic within the same filesystem.
 * - On Windows, `rename` replaces the target atomically.
 * - We do NOT use `link`+`unlink` because `rename` already provides the
 *   required atomic replace semantics on all supported platforms.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Options for atomic write.
 */
export interface AtomicWriteOptions {
  /** Directory where the temp file will be created (same as target dir). */
  tempDir: string;
  /** PID for temp file naming. */
  pid: number;
  /** Bytes to write. */
  bytes: Uint8Array;
  /** Optional callback after temp file is written and closed, before publish. */
  onTempReady?: (tempPath: string) => void | Promise<void>;
}

/**
 * Result of an atomic write.
 */
export interface AtomicWriteResult {
  /** Final target path. */
  targetPath: string;
  /** Whether the target was newly created (true) or replaced existing (false). */
  replaced: boolean;
}

/**
 * Build a temp file path in the same directory as the target.
 */
export function buildTempPath(directory: string, prefix: string): string {
  const pid = process.pid;
  const uuid = randomUUID();
  return path.join(directory, `.${prefix}.${pid}.${uuid}.tmp`);
}

/**
 * Atomically write bytes to a target file.
 *
 * Sequence:
 * 1. Create temp file with exclusive flag (`wx`).
 * 2. Write all bytes.
 * 3. `fsync` the file descriptor.
 * 4. Close the file.
 * 5. Optionally call `onTempReady` (for validation).
 * 6. `rename` temp → target.
 * 7. Best-effort `fsync` on the target directory.
 * 8. Clean up temp file in `finally`.
 *
 * @throws If any step fails, the original target is unchanged.
 */
export async function atomicWrite(
  targetPath: string,
  bytes: Uint8Array,
  prefix = "project",
): Promise<AtomicWriteResult> {
  const targetDir = path.dirname(targetPath);
  const tempPath = buildTempPath(targetDir, prefix);

  let tempFileHandle: fs.FileHandle | null = null;

  try {
    // Step 1: Exclusive create temp file
    tempFileHandle = await fs.open(tempPath, "wx");

    // Step 2: Write all bytes
    await tempFileHandle.write(bytes, 0, bytes.length);

    // Step 3: fsync to disk
    await tempFileHandle.sync();

    // Step 4: Close
    await tempFileHandle.close();
    tempFileHandle = null;

    // Step 5: Atomic rename
    await fs.rename(tempPath, targetPath);

    // Step 6: Best-effort directory fsync
    try {
      const dirHandle = await fs.open(targetDir, "r");
      await dirHandle.sync();
      await dirHandle.close();
    } catch {
      // Directory fsync is best-effort; content is already committed.
    }

    return { targetPath, replaced: false };
  } finally {
    // Step 8: Cleanup temp file
    if (tempFileHandle !== null) {
      try {
        await tempFileHandle.close();
      } catch {
        // Ignore close errors during cleanup.
      }
    }
    try {
      await fs.unlink(tempPath);
    } catch {
      // Temp file may have been renamed already; ignore.
    }
  }
}

/**
 * Safely delete a file, ignoring "not found" errors.
 */
export async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
