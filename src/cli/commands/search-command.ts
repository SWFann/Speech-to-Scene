/**
 * `s2s search` command handler.
 *
 * Searches for assets for planned scenes in a project using the specified
 * provider(s). Multiple providers may be aggregated by passing a
 * comma-separated `--provider` list (e.g. `--provider fixture,pexels`).
 *
 * Usage:
 *   s2s search <project-directory> [--provider fixture|pexels|pixabay|unsplash|openverse[,...]] [--scene <scene-id>] [--refresh] [--limit <n>] [--json] [--dry-run]
 */

import { Command } from "commander";

import type { CommandContext } from "../command-context.js";
import { formatError, formatUnexpectedError } from "../error-reporter.js";
import { AppError, ProjectNotPlannedError } from "../../shared/errors.js";
import { readEnv } from "../../infrastructure/env.js";
import { FileSearchCache } from "../../infrastructure/file-search-cache.js";
import { DefaultLinkSuggestionGenerator } from "../../infrastructure/link-suggestion-generator.js";
import {
  searchProjectAssets,
  type SearchProjectAssetsInput,
} from "../../application/search-project-assets.js";
import { createSearchProvider, getSearchCacheDir } from "../provider-factory.js";

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
// Constants
// ---------------------------------------------------------------------------

/**
 * Provider names recognised by the search command.
 */
const KNOWN_PROVIDERS = ["fixture", "pexels", "pixabay", "unsplash", "openverse"] as const;

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
    .option(
      "--provider <names>",
      "Asset provider(s), comma-separated (fixture, pexels, pixabay, unsplash, openverse)",
      "fixture",
    )
    .option("--scene <scene-id>", "Search only a specific scene")
    .option("--refresh", "Ignore cache and re-search")
    .option("--limit <number>", "Maximum assets per query", "10")
    .option("--json", "Output result as JSON")
    .option("--dry-run", "Preview search without modifying project")
    .action(async (projectDirectory: string, options: SearchCommandOptions) => {
      try {
        // Parse comma-separated provider list
        const providers = options.provider
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        if (providers.length === 0) {
          throw new ProjectNotPlannedError(
            `No provider specified. Valid options: ${KNOWN_PROVIDERS.join(", ")}`,
          );
        }

        // Validate each provider name
        for (const name of providers) {
          if (!KNOWN_PROVIDERS.includes(name as (typeof KNOWN_PROVIDERS)[number])) {
            throw new ProjectNotPlannedError(
              `Unknown provider: ${name}. Valid options: ${KNOWN_PROVIDERS.join(", ")}`,
            );
          }
        }

        const limit = Number.parseInt(options.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) {
          throw new ProjectNotPlannedError("--limit must be a positive integer");
        }

        // Read environment configuration
        const env = readEnv();

        // Perform search using the multi-source aggregation use case
        const searchInput: SearchProjectAssetsInput = {
          projectRoot: projectDirectory.replace(/\/$/, ""),
          providers,
          maxAssetsPerQuery: limit,
          ...(options.scene !== undefined ? { sceneId: options.scene } : {}),
          refresh: options.refresh,
          dryRun: options.dryRun,
        };

        const result = await searchProjectAssets(searchInput, {
          repository: ctx.repository,
          createProvider: async (providerName: string) =>
            createSearchProvider(providerName, env.assetProvider),
          createCache: (projectRoot: string, providerName: string) =>
            new FileSearchCache({ cacheDir: getSearchCacheDir(projectRoot, providerName) }),
          linkGenerator: new DefaultLinkSuggestionGenerator(),
          now: () => new Date(),
        });

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
