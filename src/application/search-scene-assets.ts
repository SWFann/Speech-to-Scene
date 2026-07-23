/**
 * searchSceneAssets use case.
 *
 * Thin wrapper around searchProjectAssets that adds Review Server-specific
 * pre-checks before delegating to the multi-source search use case.
 *
 * Pre-checks (not present in searchProjectAssets):
 * 1. Scene existence — throws SceneNotFoundError (not ProjectNotPlannedError)
 *    so the HTTP layer can map to 404.
 *
 * The stock_asset gating has been removed (Phase 1 redesign): any scene can
 * be searched on demand. The core search, deduplication, cache integration,
 * link-card generation, and persistence logic remain in searchProjectAssets.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SearchCache } from "./ports/search-cache.js";
import type {
  SearchProvider,
  LinkSuggestionGenerator,
  SearchProjectAssetsResult,
  SearchProjectAssetsDeps,
} from "./search-project-assets.js";
import { searchProjectAssets } from "./search-project-assets.js";
import { IdSchema } from "../domain/schema-primitives.js";
import { ProjectNotPlannedError, SceneNotFoundError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Input schema for searchSceneAssets.
 *
 * `projectRoot` and `sceneId` are injected by the HTTP layer from the server
 * config and URL path — never from the request body.
 *
 * `providers` is an optional list of provider names to aggregate. When empty
 * or omitted, the composition root may resolve currently configured providers.
 */
const SearchSceneAssetsInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  providers: z.array(z.string().min(1)).default([]),
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
  /** Resolves the latest configured provider names at request time. */
  readonly resolveProviders?: (
    requestedProviders: readonly string[],
  ) => readonly string[] | Promise<readonly string[]>;
  /** Factory that creates a SearchProvider by name. */
  readonly createProvider: (providerName: string) => Promise<SearchProvider>;
  /** Factory that creates a SearchCache for a project root and provider. */
  readonly createCache: (projectRoot: string, providerName: string) => SearchCache;
  /** Link suggestion generator (pure, no network). */
  readonly linkGenerator: LinkSuggestionGenerator;
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
 * 5. Delegate to searchProjectAssets (handles multi-source search, dedup,
 *    link-card generation, cache, persistence).
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository, provider/cache factories, link generator, and clock.
 * @returns The search result from searchProjectAssets.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {ProjectNotPlannedError} If the project has no generation or no scenes.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws Whatever searchProjectAssets or the provider/cache factories throw.
 */
export async function searchSceneAssets(
  input: unknown,
  deps: SearchSceneAssetsDeps,
): Promise<SearchProjectAssetsResult> {
  // 1. Validate input
  const parsed: SearchSceneAssetsInput = SearchSceneAssetsInputSchema.parse(input);
  const { projectRoot, sceneId, providers, maxAssetsPerQuery, refresh } = parsed;
  const resolvedProviders = deps.resolveProviders
    ? await deps.resolveProviders(providers)
    : providers;

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

  // 5. Delegate to searchProjectAssets (no stock_asset gating)
  const searchDeps: SearchProjectAssetsDeps = {
    repository: deps.repository,
    createProvider: deps.createProvider,
    createCache: deps.createCache,
    linkGenerator: deps.linkGenerator,
    now: deps.now,
  };

  return searchProjectAssets(
    {
      projectRoot,
      providers: resolvedProviders,
      maxAssetsPerQuery,
      sceneId,
      refresh,
    },
    searchDeps,
  );
}
