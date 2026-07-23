/**
 * searchProjectAssets use case.
 *
 * Coordinates asset search across multiple providers for a project's planned
 * scenes. Handles multi-source aggregation, deduplication, link-card
 * generation, cache integration, and persistence.
 *
 * Phase 1 material-discovery redesign:
 * - Any scene can be searched (no stock_asset gating).
 * - Multiple providers are queried in parallel; results are merged.
 * - After asset candidates, "search link card" candidates (kind: "link") are
 *   appended for platforms without an API (Xiaohongshu/Douyin/Bilibili/YouTube).
 *
 * The use case owns the full transaction: load project, search, validate,
 * save. This makes --dry-run byte-stable (no mutation without explicit save).
 */

import type {
  AssetSearchInput,
  AssetSearchResult,
  AssetCandidate as PortAssetCandidate,
  ProviderCapabilities,
  AssetUsePolicy,
} from "./ports/asset-provider.js";
import type { SearchCache, CacheSearchInput } from "./ports/search-cache.js";
import { computeProviderCacheKey } from "./ports/search-cache.js";
import type { ProjectRepository } from "./ports/project-repository.js";
import type { Scene } from "../domain/scene-schema.js";
import type { AssetCandidateLink, AssetCandidate } from "../domain/asset-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { AssetCandidateSchema } from "../domain/asset-schema.js";
import { ProjectNotPlannedError, ProjectValidationError } from "../shared/errors.js";

/**
 * Input for searchProjectAssets use case.
 *
 * `providers` lists the provider names to aggregate (e.g., ["fixture"],
 * ["pexels", "pixabay"]). If empty, defaults to ["fixture"].
 */
export interface SearchProjectAssetsInput {
  readonly projectRoot: string;
  readonly providers: readonly string[];
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

/**
 * Generates "search link card" candidates (kind: "link") for platforms
 * without a usable search API.
 *
 * This is a pure function — no network, no I/O. Implemented in infrastructure.
 */
export interface LinkSuggestionGenerator {
  generateLinks(input: {
    readonly keyword: string;
    readonly matchedQueryId: string;
    readonly retrievedAt: string;
  }): AssetCandidateLink[];
}

/**
 * Dependencies for searchProjectAssets.
 */
export interface SearchProjectAssetsDeps {
  /** Project repository (used for loading/saving projects). */
  readonly repository: ProjectRepository;
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
// Use Case Implementation
// ---------------------------------------------------------------------------

/**
 * Searches for project assets using multiple providers and appends link cards.
 *
 * For each planned scene with enabled queries, this use case:
 * 1. Loads the project through the repository
 * 2. For each enabled query, searches all configured providers (with caching)
 * 3. Deduplicates asset candidates across providers and queries
 * 4. Generates "search link card" candidates for platforms without an API
 * 5. Updates the project with combined search results
 * 6. Saves through repository (unless dry-run)
 *
 * Any scene can be searched — there is no stock_asset gating.
 */
export async function searchProjectAssets(
  input: SearchProjectAssetsInput,
  deps: SearchProjectAssetsDeps,
): Promise<SearchProjectAssetsResult> {
  // Step 1: Load project
  const project = await deps.repository.load(input.projectRoot);

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

  // Step 4: Resolve providers (default to fixture when none specified)
  const providerNames = input.providers.length > 0 ? input.providers : ["fixture"];
  const providers: SearchProvider[] = [];
  for (const name of providerNames) {
    providers.push(await deps.createProvider(name));
  }

  let totalCandidates = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  const allWarnings: Array<{ code: string; message: string; queryId?: string }> = [];

  // Step 5: Process each scene
  for (const scene of scenes) {
    // Filter enabled queries only
    const enabledQueries = scene.search.queries.filter((q) => q.enabled);
    if (enabledQueries.length === 0) {
      continue;
    }

    const assetCandidates: PortAssetCandidate[] = [];

    // Process each enabled query against each provider
    for (const query of enabledQueries) {
      for (const provider of providers) {
        const searchInput = buildSearchInput(
          query,
          scene,
          project.project.aspectRatio,
          provider.capabilities,
          input.maxAssetsPerQuery,
          project.project.assetUsePolicy,
        );

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

        const cache = deps.createCache(input.projectRoot, provider.providerId);

        const searchResult = await resolveSearchResult(
          searchInput,
          cacheInput,
          provider,
          cache,
          input.refresh ?? false,
          deps.now,
        );

        if (searchResult.fromCache) {
          cacheHits++;
        } else {
          cacheMisses++;
        }

        assetCandidates.push(...searchResult.candidates);
        allWarnings.push(...searchResult.warnings);
      }
    }

    // Deduplicate asset candidates across providers and queries
    const dedupedAssets = deduplicateCandidates(assetCandidates);

    // Tag asset candidates with category: stock_library
    for (const asset of dedupedAssets) {
      const a = asset as { category?: string };
      if (asset.kind === "asset" && !a.category) {
        a.category = "stock_library";
      }
    }

    // Generate link candidates from the first enabled query
    const firstQuery = enabledQueries[0]!;
    const keyword = firstQuery.query;
    const retrievedAt = deps.now().toISOString();
    const linkCandidates = deps.linkGenerator.generateLinks({
      keyword,
      matchedQueryId: firstQuery.id,
      retrievedAt,
    });

    // Interleave candidates by category so link cards are not always at the end.
    // Round-robin: take one from each category group in turn.
    const combined = interleaveByCategory(dedupedAssets, linkCandidates);

    // Re-assign ranks so they are sequential after interleaving
    combined.forEach((c, i) => {
      c.rank = i + 1;
    });

    scene.search.candidates = combined;

    if (combined.length > 0) {
      scene.search.lastSearchedAt = retrievedAt;
    }

    totalCandidates += combined.length;
  }

  // Step 6: Update project.updatedAt
  project.project.updatedAt = deps.now().toISOString();

  // Step 7: Validate full project before save
  try {
    SpeechToSceneProjectSchema.parse(project);
  } catch (error) {
    throw new ProjectValidationError(
      `Search produced invalid project: ${error instanceof Error ? error.message : "unknown"}`,
      "搜索产生的项目数据无效",
      error instanceof Error ? error : undefined,
    );
  }

  // Step 8: Save unless dry-run
  if (!input.dryRun) {
    try {
      await deps.repository.save(input.projectRoot, project);
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
 * Resolves a search result from cache or provider, writing to cache on miss.
 */
async function resolveSearchResult(
  searchInput: AssetSearchInput,
  cacheInput: CacheSearchInput,
  provider: SearchProvider,
  cache: SearchCache,
  refresh: boolean,
  now: () => Date,
): Promise<{ candidates: PortAssetCandidate[]; warnings: ReadonlyArray<{ code: string; message: string; queryId?: string }>; fromCache: boolean }> {
  const cacheKey = computeProviderCacheKey(
    cacheInput,
    provider.providerId,
    provider.providerPolicyRevision,
  );

  // Try cache first (unless refresh)
  if (!refresh) {
    const cacheResult = await cache.read(cacheKey);
    if (cacheResult.hit && cacheResult.entry) {
      try {
        const cachedCandidates = AssetCandidateSchema.array().parse(cacheResult.entry.response);
        return {
          candidates: cachedCandidates.filter(
            (c): c is PortAssetCandidate => c.kind === "asset",
          ),
          warnings: cacheResult.entry.warnings,
          fromCache: true,
        };
      } catch {
        // Cache contains invalid candidates — fall through to provider search
      }
    }
  }

  // Search provider
  const searchResult = await provider.search(searchInput);

  // Write to cache (non-fatal on failure)
  try {
    await cache.write(cacheKey, {
      schemaVersion: "0.1",
      providerId: provider.providerId,
      providerPolicyRevision: provider.providerPolicyRevision,
      createdAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      request: cacheInput,
      response: searchResult.candidates as unknown as ReadonlyArray<Record<string, unknown>>,
      warnings: searchResult.warnings,
    });
  } catch {
    // Cache write failure is non-fatal
  }

  return {
    candidates: [...searchResult.candidates],
    warnings: searchResult.warnings,
    fromCache: false,
  };
}

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
function deduplicateCandidates(candidates: readonly PortAssetCandidate[]): PortAssetCandidate[] {
  const seen = new Map<string, PortAssetCandidate>();

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

/**
 * Interleaves asset and link candidates by category so that link cards
 * (video_platform, stock_site, social_media) are not all pushed to the end.
 *
 * Groups candidates by category, then round-robins: takes one candidate from
 * each non-empty group in turn. This ensures a mix of stock library results,
 * video platform links, and stock site links throughout the list.
 *
 * Categories order: stock_library, video_platform, stock_site, social_media, ai_generated
 */
function interleaveByCategory(
  assets: readonly AssetCandidate[],
  links: readonly AssetCandidateLink[],
): AssetCandidate[] {
  const all: AssetCandidate[] = [...assets, ...links];

  // Group by category
  const categoryOrder = ["stock_library", "video_platform", "stock_site", "social_media", "ai_generated"] as const;
  const groups: Map<string, AssetCandidate[]> = new Map();
  for (const cat of categoryOrder) {
    groups.set(cat, []);
  }

  for (const candidate of all) {
    const cat = candidate.category ?? (candidate.kind === "generated" ? "ai_generated" : "stock_library");
    const list = groups.get(cat);
    if (list) {
      list.push(candidate);
    } else {
      // Unknown category — put in stock_library as fallback
      groups.get("stock_library")!.push(candidate);
    }
  }

  // Round-robin: take one from each group in turn
  const result: AssetCandidate[] = [];
  let remaining = all.length;
  while (remaining > 0) {
    for (const cat of categoryOrder) {
      const list = groups.get(cat);
      if (list && list.length > 0) {
        result.push(list.shift()!);
        remaining--;
        if (remaining === 0) break;
      }
    }
  }

  return result;
}
