/**
 * searchSceneAssets use case.
 *
 * Thin wrapper around searchProjectAssets that adds Review Server-specific
 * pre-checks before delegating to the M3 search use case.
 *
 * Pre-checks (not present in searchProjectAssets):
 * 1. Scene existence — throws SceneNotFoundError (not ProjectNotPlannedError)
 *    so the HTTP layer can map to 404.
 * 2. Scene decision — throws ProjectConflictError if the scene is not
 *    stock_asset, so the HTTP layer can map to 409.
 *
 * The core search, deduplication, cache integration, and persistence logic
 * remain in searchProjectAssets. This wrapper does NOT copy that logic.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SearchCache } from "./ports/search-cache.js";
import type { SearchProvider } from "./search-project-assets.js";
import type { SearchProjectAssetsResult } from "./search-project-assets.js";
import { searchProjectAssets } from "./search-project-assets.js";
import { IdSchema } from "../domain/schema-primitives.js";
import {
  ProjectNotPlannedError,
  SceneNotFoundError,
  ProjectConflictError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Input schema for searchSceneAssets.
 *
 * `projectRoot` and `sceneId` are injected by the HTTP layer from the server
 * config and URL path — never from the request body.
 */
const SearchSceneAssetsInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  provider: z.enum(["fixture", "pexels"]),
  maxAssetsPerQuery: z.number().int().min(1).max(50),
  refresh: z.boolean(),
});

export type SearchSceneAssetsInput = z.infer<typeof SearchSceneAssetsInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for searchSceneAssets.
 *
 * `createProvider` and `createCache` are factory functions provided by the
 * composition root (CLI). The application layer calls them but does not know
 * about concrete infrastructure implementations.
 */
export interface SearchSceneAssetsDeps {
  /** Project repository (used for loading/saving projects). */
  readonly repository: ProjectRepository;
  /** Factory that creates a SearchProvider by name. */
  readonly createProvider: (providerName: string) => Promise<SearchProvider>;
  /** Factory that creates a SearchCache for a project root and provider. */
  readonly createCache: (projectRoot: string, providerName: string) => SearchCache;
  /** Clock for deterministic timestamps. */
  readonly now: () => Date;
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Searches for asset candidates for a single scene.
 *
 * Flow:
 * 1. Validate input (unknown → typed).
 * 2. Load project through repository.
 * 3. Verify the project has been planned.
 * 4. Verify the scene exists → SceneNotFoundError if not.
 * 5. Verify the scene decision is stock_asset → ProjectConflictError if not.
 * 6. Create provider and cache via injected factories.
 * 7. Delegate to searchProjectAssets (handles search, dedup, cache, persistence).
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository, provider/cache factories, and clock.
 * @returns The search result from searchProjectAssets.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {ProjectNotPlannedError} If the project has no generation or no scenes.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectConflictError} If the scene is not a stock_asset scene.
 * @throws Whatever searchProjectAssets or the provider/cache factories throw.
 */
export async function searchSceneAssets(
  input: unknown,
  deps: SearchSceneAssetsDeps,
): Promise<SearchProjectAssetsResult> {
  // 1. Validate input
  const parsed: SearchSceneAssetsInput = SearchSceneAssetsInputSchema.parse(input);
  const { projectRoot, sceneId, provider, maxAssetsPerQuery, refresh } = parsed;

  // 2. Load project
  const project = await deps.repository.load(projectRoot);

  // 3. Check project is planned
  if (!project.generation || project.scenes.length === 0) {
    throw new ProjectNotPlannedError(projectRoot);
  }

  // 4. Find scene
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    throw new SceneNotFoundError(sceneId);
  }

  // 5. Check stock_asset — search only makes sense for stock_asset scenes
  if (scene.visualPlan.decision !== "stock_asset") {
    throw new ProjectConflictError(
      "Search is only supported for stock_asset scenes",
      "该场景不是 stock_asset 类型，无法执行素材搜索",
    );
  }

  // 6. Create provider and cache
  const searchProvider = await deps.createProvider(provider);
  const cache = deps.createCache(projectRoot, provider);

  // 7. Delegate to searchProjectAssets
  return searchProjectAssets(
    {
      projectRoot,
      provider,
      maxAssetsPerQuery,
      sceneId,
      refresh,
    },
    deps.repository,
    searchProvider,
    cache,
    deps.now,
  );
}
