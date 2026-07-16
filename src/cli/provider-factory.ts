/**
 * Asset provider factory — shared composition root helper.
 *
 * Extracted from search-command.ts so that both the CLI `s2s search` command
 * and the Review Server (`s2s review`) can create asset providers without
 * duplicating construction logic.
 *
 * This module belongs to the CLI composition root layer. It imports concrete
 * infrastructure providers (fixture, pexels) and wires them into the
 * application-layer `SearchProvider` interface. Domain and Application layers
 * never import this file.
 */

import type { SearchProvider } from "../application/search-project-assets.js";
import type { AssetProviderEnvConfig } from "../infrastructure/env.js";
import type { PexelsAssetProviderOptions } from "../providers/pexels/pexels-asset-provider.js";
import { ProjectNotPlannedError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Creates an asset provider by name.
 *
 * This is the composition root function. It imports concrete providers
 * dynamically to avoid circular dependencies.
 *
 * @param providerName - Provider name: "fixture" or "pexels".
 * @param env - Asset provider environment configuration.
 * @param httpClient - Optional HTTP client injection (for testing pexels).
 * @throws {ProjectNotPlannedError} If the provider name is unknown or pexels
 *   API key is missing.
 */
export async function createSearchProvider(
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
        await import("../providers/fixture/fixture-asset-provider.js");
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
      const { PexelsAssetProvider } = await import("../providers/pexels/pexels-asset-provider.js");
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

/**
 * Creates a FileSearchCache directory path for a given project root and provider.
 *
 * The cache path follows the convention: `<projectRoot>/cache/search/<provider>`.
 * Both the CLI and Review Server use this helper to ensure cache paths are
 * consistent.
 *
 * @param projectRoot - Absolute project root path.
 * @param providerName - Provider name (e.g., "fixture", "pexels").
 * @returns The cache directory path.
 */
export function getSearchCacheDir(projectRoot: string, providerName: string): string {
  const resolved = projectRoot.replace(/\/$/, "");
  return `${resolved}/cache/search/${providerName}`;
}
