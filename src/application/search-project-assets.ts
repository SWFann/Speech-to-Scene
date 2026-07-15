/**
 * searchProjectAssets use case.
 *
 * Coordinates asset search across providers for a project's planned scenes.
 * Handles deduplication, ranking, cache integration, and persistence.
 *
 * The use case owns the full transaction: load project, search, validate,
 * save. This makes --dry-run byte-stable (no mutation without explicit save).
 */

import type {
  AssetSearchInput,
  AssetSearchResult,
  AssetCandidate,
  ProviderCapabilities,
  AssetUsePolicy,
} from "./ports/asset-provider.js";
import type { SearchCache, CacheSearchInput } from "./ports/search-cache.js";
import { computeProviderCacheKey } from "./ports/search-cache.js";
import type { Scene } from "../domain/scene-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { AssetCandidateSchema } from "../domain/asset-schema.js";
import type { ProjectRepository } from "./ports/project-repository.js";
import { ProjectNotPlannedError, ProjectValidationError } from "../shared/errors.js";

/**
 * Input for searchProjectAssets use case.
 */
export interface SearchProjectAssetsInput {
  readonly projectRoot: string;
  readonly provider: string;
  readonly maxAssetsPerQuery: number;
  readonly sceneId?: string;
  readonly refresh?: boolean;
  readonly dryRun?: boolean;
}

/**
 * Result of searchProjectAssets use case.
 */
export interface SearchProjectAssetsResult {
  readonly projectId: string;
  readonly status: "searched" | "would_search";
  readonly sceneCount: number;
  readonly totalCandidates: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly queryId?: string;
  }>;
}

/**
 * Provider interface for search use case.
 */
export interface SearchProvider {
  readonly providerId: string;
  readonly providerPolicyRevision: string;
  readonly capabilities: ProviderCapabilities;
  search(input: AssetSearchInput): Promise<AssetSearchResult>;
}

// ---------------------------------------------------------------------------
// Use Case Implementation
// ---------------------------------------------------------------------------

/**
 * Searches for project assets using the specified provider.
 *
 * For each planned scene with visualPlan decision stock_asset and enabled queries,
 * this use case:
 * 1. Loads the project through the repository
 * 2. Checks the cache for existing results
 * 3. Searches the provider for new results (cache miss)
 * 4. Validates cached candidates with AssetCandidateSchema
 * 5. Deduplicates candidates across queries
 * 6. Updates the project with search results
 * 7. Saves through repository (unless dry-run)
 */
export async function searchProjectAssets(
  input: SearchProjectAssetsInput,
  repository: ProjectRepository,
  provider: SearchProvider,
  cache: SearchCache,
  now: () => Date,
): Promise<SearchProjectAssetsResult> {
  // Step 1: Load project
  const project = await repository.load(input.projectRoot);

  // Step 2: Check if project has been planned
  if (!project.generation || project.scenes.length === 0) {
    throw new ProjectNotPlannedError(input.projectRoot);
  }

  // Step 3: Filter scenes if --scene is specified
  const scenes = input.sceneId
    ? project.scenes.filter((s) => s.id === input.sceneId)
    : project.scenes;

  if (scenes.length === 0) {
    throw new ProjectNotPlannedError(`Scene not found: ${input.sceneId}`);
  }

  let totalCandidates = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  const allWarnings: Array<{ code: string; message: string; queryId?: string }> = [];

  // Step 4: Process each scene
  for (const scene of scenes) {
    // Skip non-stock_asset scenes
    if (scene.visualPlan.decision !== "stock_asset") {
      continue;
    }

    // Filter enabled queries only
    const enabledQueries = scene.search.queries.filter((q) => q.enabled);
    if (enabledQueries.length === 0) {
      continue;
    }

    const allCandidates: AssetCandidate[] = [];

    // Process each enabled query for this scene
    for (const query of enabledQueries) {
      const searchInput = buildSearchInput(
        query,
        scene,
        project.project.aspectRatio,
        provider.capabilities,
        input.maxAssetsPerQuery,
        project.project.assetUsePolicy,
      );

      // Build cache input (avoids caching the full AssetCandidate objects)
      const cacheInput: CacheSearchInput = {
        queryId: searchInput.queryId,
        query: searchInput.query,
        language: searchInput.language,
        mediaTypes: searchInput.mediaTypes,
        orientation: searchInput.orientation,
        perPage: searchInput.perPage,
        page: searchInput.page,
        sceneId: searchInput.sceneId,
      };

      let searchResult: AssetSearchResult;

      // Check cache first (unless --refresh)
      if (!input.refresh) {
        const cacheKey = computeProviderCacheKey(
          cacheInput,
          provider.providerId,
          provider.providerPolicyRevision,
        );
        const cacheResult = await cache.read(cacheKey);

        if (cacheResult.hit && cacheResult.entry) {
          cacheHits++;
          // Validate cached candidates before using them
          try {
            const cachedCandidates = AssetCandidateSchema.array().parse(cacheResult.entry.response);
            searchResult = {
              candidates: cachedCandidates as AssetCandidate[],
              warnings: cacheResult.entry.warnings,
            };
          } catch {
            // Cache contains invalid candidates - fall through to provider search
            cacheMisses++;
            searchResult = await provider.search(searchInput);
            // Write to cache with full candidates (stored as plain objects)
            try {
              await cache.write(
                computeProviderCacheKey(
                  cacheInput,
                  provider.providerId,
                  provider.providerPolicyRevision,
                ),
                {
                  schemaVersion: "0.1",
                  providerId: provider.providerId,
                  providerPolicyRevision: provider.providerPolicyRevision,
                  createdAt: now().toISOString(),
                  expiresAt: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  request: cacheInput,
                  response: searchResult.candidates as unknown as ReadonlyArray<
                    Record<string, unknown>
                  >,
                  warnings: searchResult.warnings,
                },
              );
            } catch {
              // Cache write failure is non-fatal
            }
          }
        } else {
          cacheMisses++;
          // Search provider
          searchResult = await provider.search(searchInput);
          // Write to cache with full candidates (stored as plain objects)
          try {
            await cache.write(
              computeProviderCacheKey(
                cacheInput,
                provider.providerId,
                provider.providerPolicyRevision,
              ),
              {
                schemaVersion: "0.1",
                providerId: provider.providerId,
                providerPolicyRevision: provider.providerPolicyRevision,
                createdAt: now().toISOString(),
                expiresAt: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                request: cacheInput,
                response: searchResult.candidates as unknown as ReadonlyArray<
                  Record<string, unknown>
                >,
                warnings: searchResult.warnings,
              },
            );
          } catch {
            // Cache write failure is non-fatal
          }
        }
      } else {
        cacheMisses++;
        // Search provider
        searchResult = await provider.search(searchInput);
        // Write to cache with full candidates (stored as plain objects)
        try {
          await cache.write(
            computeProviderCacheKey(
              cacheInput,
              provider.providerId,
              provider.providerPolicyRevision,
            ),
            {
              schemaVersion: "0.1",
              providerId: provider.providerId,
              providerPolicyRevision: provider.providerPolicyRevision,
              createdAt: now().toISOString(),
              expiresAt: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              request: cacheInput,
              response: searchResult.candidates as unknown as ReadonlyArray<
                Record<string, unknown>
              >,
              warnings: searchResult.warnings,
            },
          );
        } catch {
          // Cache write failure is non-fatal
        }
      }

      allCandidates.push(...searchResult.candidates);
      allWarnings.push(...searchResult.warnings);
    }

    // Deduplicate and rank candidates for this scene
    const dedupedCandidates = deduplicateCandidates(allCandidates);
    scene.search.candidates = dedupedCandidates;

    if (dedupedCandidates.length > 0) {
      scene.search.lastSearchedAt = now().toISOString();
    }

    totalCandidates += dedupedCandidates.length;
  }

  // Step 5: Update project.updatedAt
  project.project.updatedAt = now().toISOString();

  // Step 6: Validate full project before save
  try {
    SpeechToSceneProjectSchema.parse(project);
  } catch (error) {
    throw new ProjectValidationError(
      `Search produced invalid project: ${error instanceof Error ? error.message : "unknown"}`,
      "搜索产生的项目数据无效",
      error instanceof Error ? error : undefined,
    );
  }

  // Step 7: Save unless dry-run
  if (!input.dryRun) {
    try {
      await repository.save(input.projectRoot, project);
    } catch (error) {
      throw new ProjectValidationError(
        error instanceof Error ? error.message : "Failed to save project",
        "保存搜索结果失败",
        error instanceof Error ? error : undefined,
      );
    }
  }

  return {
    projectId: project.project.id,
    status: input.dryRun ? "would_search" : "searched",
    sceneCount: scenes.length,
    totalCandidates,
    cacheHits,
    cacheMisses,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a search input from a scene query.
 */
function buildSearchInput(
  query: { readonly id: string; readonly language: "zh" | "en"; readonly query: string },
  scene: Scene,
  aspectRatio: string,
  capabilities: ProviderCapabilities,
  maxAssets: number,
  projectPolicy: AssetUsePolicy,
): AssetSearchInput {
  const preferredMedia = scene.visualPlan.preferredMedia;
  const mediaTypes: Array<"photo" | "video"> = [];
  if (capabilities.photos && preferredMedia.includes("photo")) {
    mediaTypes.push("photo");
  }
  if (capabilities.videos && preferredMedia.includes("video")) {
    mediaTypes.push("video");
  }
  if (mediaTypes.length === 0) {
    mediaTypes.push("photo");
  }

  return {
    queryId: query.id,
    query: query.query,
    language: query.language,
    mediaTypes,
    orientation: mapAspectRatioToOrientation(aspectRatio),
    perPage: maxAssets,
    page: 1,
    sceneId: scene.id,
    projectPolicy,
  };
}

/**
 * Maps project aspect ratio to search orientation.
 */
function mapAspectRatioToOrientation(aspectRatio: string): "portrait" | "landscape" | "square" {
  switch (aspectRatio) {
    case "9:16":
      return "portrait";
    case "1:1":
      return "square";
    case "16:9":
    default:
      return "landscape";
  }
}

/**
 * Deduplicates candidates by provider+mediaType+providerAssetId, keeping highest rank.
 */
function deduplicateCandidates(candidates: readonly AssetCandidate[]): AssetCandidate[] {
  const seen = new Map<string, AssetCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.provider.id}\t${candidate.mediaType}\t${candidate.providerAssetId}`;
    const existing = seen.get(key);
    if (!existing || candidate.rank < existing.rank) {
      seen.set(key, candidate);
    }
  }

  // Sort by rank and return
  return Array.from(seen.values()).sort((a, b) => a.rank - b.rank);
}
