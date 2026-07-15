/**
 * `s2s search` command handler.
 *
 * Searches for assets for planned scenes in a project using the specified provider.
 *
 * Usage:
 *   s2s search <project-directory> [--provider fixture|pexels] [--scene <scene-id>] [--refresh] [--limit <n>] [--json] [--dry-run]
 */

import { Command } from "commander";

import type { CommandContext } from "../command-context.js";
import { formatError, formatUnexpectedError } from "../error-reporter.js";
import { AppError, ProjectNotPlannedError } from "../../shared/errors.js";
import { readEnv } from "../../infrastructure/env.js";
import { FileSearchCache } from "../../infrastructure/file-search-cache.js";
import {
  searchProjectAssets,
  type SearchProvider,
  type SearchProjectAssetsInput,
} from "../../application/search-project-assets.js";
import type { AssetProviderEnvConfig } from "../../infrastructure/env.js";
import type { PexelsAssetProviderOptions } from "../../providers/pexels/pexels-asset-provider.js";

// ---------------------------------------------------------------------------
// Provider Factory (composition root)
// ---------------------------------------------------------------------------

/**
 * Creates an asset provider by name.
 *
 * This is the composition root function. It imports concrete providers
 * dynamically to avoid circular dependencies.
 */
async function createSearchProvider(
  providerName: string,
  env: AssetProviderEnvConfig,
  httpClient?: {
    get: <T>(url: string, options?: { signal?: AbortSignal | undefined }) => Promise<T>;
    post: <T>(url: string, body: unknown) => Promise<T>;
  },
): Promise<SearchProvider> {
  switch (providerName) {
    case "fixture": {
      // Import dynamically to avoid circular dependency
      const { FixtureAssetProvider } =
        await import("../../providers/fixture/fixture-asset-provider.js");
      const clock: { now: () => Date } = { now: () => new Date() };
      const provider = new FixtureAssetProvider(clock);
      return {
        providerId: provider.providerId,
        providerPolicyRevision: provider.providerSnapshot.policyRevision,
        capabilities: provider.capabilities,
        search: provider.search.bind(provider),
      };
    }
    case "pexels": {
      if (!env.pexelsApiKey) {
        throw new ProjectNotPlannedError(
          "Pexels API key is required. Set PEXELS_API_KEY environment variable.",
        );
      }
      const { PexelsAssetProvider } =
        await import("../../providers/pexels/pexels-asset-provider.js");
      const pexelsOptions: PexelsAssetProviderOptions = {
        apiKey: env.pexelsApiKey,
        ...(env.pexelsBaseUrl ? { photosBaseUrl: env.pexelsBaseUrl } : {}),
        ...(env.pexelsVideoBaseUrl ? { videosBaseUrl: env.pexelsVideoBaseUrl } : {}),
        ...(httpClient ? { httpClient } : {}),
      };
      const provider = new PexelsAssetProvider(pexelsOptions);
      return {
        providerId: provider.providerId,
        providerPolicyRevision: provider.providerSnapshot.policyRevision,
        capabilities: provider.capabilities,
        search: provider.search.bind(provider),
      };
    }
    default:
      throw new ProjectNotPlannedError(`Unknown asset provider: ${providerName}`);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchCommandOptions {
  provider: string;
  scene?: string;
  refresh: boolean;
  limit: string;
  json: boolean;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function formatHumanOutput(result: {
  projectId: string;
  status: string;
  sceneCount: number;
  totalCandidates: number;
  cacheHits: number;
  cacheMisses: number;
  warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly queryId?: string;
  }>;
}): string {
  const lines = [
    `项目：${result.projectId}`,
    `状态：${result.status}`,
    `场景数：${result.sceneCount}`,
    `候选素材数：${result.totalCandidates}`,
    `缓存命中：${result.cacheHits}`,
    `缓存未命中：${result.cacheMisses}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`警告：${result.warnings.length}`);
    for (const w of result.warnings) {
      lines.push(`  - ${w.code}: ${w.message}`);
    }
  }
  return lines.join("\n");
}

function formatJsonOutput(result: {
  projectId: string;
  status: string;
  sceneCount: number;
  totalCandidates: number;
  cacheHits: number;
  cacheMisses: number;
  warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly queryId?: string;
  }>;
}): string {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates and configures the `search` subcommand.
 */
export function createSearchCommand(ctx: CommandContext): Command {
  const command = new Command("search");

  command
    .description("Search for assets for all planned scenes")
    .argument("<project-directory>", "Path to the project directory")
    .option("--provider <name>", "Asset provider (fixture or pexels)", "fixture")
    .option("--scene <scene-id>", "Search only a specific scene")
    .option("--refresh", "Ignore cache and re-search")
    .option("--limit <number>", "Maximum assets per query", "10")
    .option("--json", "Output result as JSON")
    .option("--dry-run", "Preview search without modifying project")
    .action(async (projectDirectory: string, options: SearchCommandOptions) => {
      try {
        // Validate options
        const validProviders = ["fixture", "pexels"];
        if (!validProviders.includes(options.provider)) {
          throw new ProjectNotPlannedError(
            `Unknown provider: ${options.provider}. Valid options: ${validProviders.join(", ")}`,
          );
        }

        const limit = Number.parseInt(options.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) {
          throw new ProjectNotPlannedError("--limit must be a positive integer");
        }

        // Read environment configuration
        const env = readEnv();

        // Create asset provider
        const provider = await createSearchProvider(options.provider, env.assetProvider);

        // Create cache inside project directory: <projectRoot>/cache/search/<provider>
        const resolvedProjectDir = projectDirectory.replace(/\/$/, "");
        const cacheDir = `${resolvedProjectDir}/cache/search/${options.provider}`;
        const cache = new FileSearchCache({ cacheDir });

        // Get current time
        const now: () => Date = () => new Date();

        // Perform search
        const searchInput: SearchProjectAssetsInput = options.scene
          ? {
              projectRoot: resolvedProjectDir,
              provider: options.provider,
              maxAssetsPerQuery: limit,
              sceneId: options.scene,
              refresh: options.refresh,
              dryRun: options.dryRun,
            }
          : {
              projectRoot: resolvedProjectDir,
              provider: options.provider,
              maxAssetsPerQuery: limit,
              refresh: options.refresh,
              dryRun: options.dryRun,
            };

        const result = await searchProjectAssets(searchInput, ctx.repository, provider, cache, now);

        // Output result
        if (options.json) {
          console.log(formatJsonOutput(result));
        } else {
          if (options.dryRun) {
            console.log("[dry-run] Would update project with search results:");
          }
          console.log(formatHumanOutput(result));
        }
      } catch (error) {
        if (error instanceof AppError) {
          console.error(formatError(error));
        } else {
          console.error(formatUnexpectedError(error));
        }
        process.exitCode = (error as { exitCode?: number } | null)?.exitCode ?? 1;
      }
    });

  return command;
}
