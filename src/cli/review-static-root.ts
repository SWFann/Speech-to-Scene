/**
 * Resolve the built Review Board static root for `s2s review`.
 *
 * The CLI may be launched from any current working directory, so the static
 * root must be derived from the module location first, not from `process.cwd()`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveReviewStaticRootOptions {
  readonly cwd?: string;
  readonly moduleUrl?: string;
  readonly envStaticRoot?: string;
}

function moduleDirectory(moduleUrl: string): string | null {
  try {
    return path.dirname(fileURLToPath(moduleUrl));
  } catch {
    return null;
  }
}

function findRepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const packageJson = path.join(current, "package.json");
    const webDir = path.join(current, "web");

    if (fs.existsSync(packageJson) && fs.existsSync(webDir)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveReviewStaticRoot(options: ResolveReviewStaticRootOptions = {}): string {
  const envStaticRoot = options.envStaticRoot?.trim();
  if (envStaticRoot) {
    return path.resolve(envStaticRoot);
  }

  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const moduleDir = moduleDirectory(moduleUrl);
  if (moduleDir) {
    const repoRoot = findRepoRoot(moduleDir);
    if (repoRoot) {
      return path.join(repoRoot, "web", "dist");
    }
  }

  return path.resolve(options.cwd ?? process.cwd(), "web", "dist");
}
