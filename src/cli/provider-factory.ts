/**
 * Asset provider factory — shared composition root helper.
 *
 * Extracted from search-command.ts so that both the CLI `s2s search` command
 * and the Review Server (`s2s review`) can create asset providers without
 * duplicating construction logic.
 *
 * This module belongs to the CLI composition root layer. It imports concrete
 * infrastructure providers (fixture, pexels, pixabay, unsplash, openverse) and
 * wires them into the application-layer `SearchProvider` interface. Domain and
 * Application layers never import this file.
 */

import type { SearchProvider } from "../application/search-project-assets.js";
import type { AssetProviderEnvConfig } from "../infrastructure/env.js";
import type { PexelsAssetProviderOptions } from "../providers/pexels/pexels-asset-provider.js";
import type { ScriptPlanner } from "../application/ports/script-planner.js";
import type { Settings } from "../application/ports/settings-store.js";
import { readPlannerEnv, readAssetProviderEnv } from "../infrastructure/env.js";
import { ProjectNotPlannedError, InvalidArgumentError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Creates an asset provider by name.
 *
 * This is the composition root function. It imports concrete providers
 * dynamically to avoid circular dependencies.
 *
 * @param providerName - Provider name: "fixture", "pexels", "pixabay",
 *   "unsplash", or "openverse".
 * @param env - Asset provider environment configuration.
 * @param httpClient - Optional HTTP client injection (for testing).
 * @throws {ProjectNotPlannedError} If the provider name is unknown or a
 *   required API key is missing.
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
    case "pixabay": {
      if (!env.pixabayApiKey) {
        throw new ProjectNotPlannedError(
          "Pixabay API key is required. Set PIXABAY_API_KEY environment variable.",
        );
      }
      const { PixabayAssetProvider } = await import("../providers/pixabay/pixabay-asset-provider.js");
      const provider = new PixabayAssetProvider({
        apiKey: env.pixabayApiKey,
        ...(httpClient ? { httpClient } : {}),
      });
      return {
        providerId: provider.providerId,
        providerPolicyRevision: provider.providerSnapshot.policyRevision,
        capabilities: provider.capabilities,
        search: provider.search.bind(provider),
      };
    }
    case "unsplash": {
      if (!env.unsplashApiKey) {
        throw new ProjectNotPlannedError(
          "Unsplash API key is required. Set UNSPLASH_API_KEY environment variable.",
        );
      }
      const { UnsplashAssetProvider } = await import("../providers/unsplash/unsplash-asset-provider.js");
      const provider = new UnsplashAssetProvider({
        apiKey: env.unsplashApiKey,
        ...(httpClient ? { httpClient } : {}),
      });
      return {
        providerId: provider.providerId,
        providerPolicyRevision: provider.providerSnapshot.policyRevision,
        capabilities: provider.capabilities,
        search: provider.search.bind(provider),
      };
    }
    case "openverse": {
      const { OpenverseAssetProvider } = await import("../providers/openverse/openverse-asset-provider.js");
      const provider = new OpenverseAssetProvider({});
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

// ---------------------------------------------------------------------------
// Planner provider factory (E1/E2: settings.json priority over .env)
// ---------------------------------------------------------------------------

/**
 * Creates a planner provider by name, with settings.json taking priority over
 * .env for API keys. Used by the Review Server's planProject endpoint.
 *
 * @param name - Planner provider name: "fixture", "deepseek", or "stepfun".
 * @param settings - Loaded settings (settings.json). Keys take priority over .env.
 */
export async function createPlannerProvider(name: string, settings: Settings): Promise<ScriptPlanner> {
  const env = readPlannerEnv();
  switch (name) {
    case "fixture": {
      const { FixtureScriptPlanner } = await import("../planner/fixture-script-planner.js");
      return new FixtureScriptPlanner();
    }
    case "deepseek": {
      const apiKey = settings.deepseekApiKey ?? env.deepseekApiKey;
      const model = settings.deepseekModel ?? env.deepseekModel;
      if (!apiKey) {
        throw new InvalidArgumentError(
          "DeepSeek API key is required",
          "在设置页配置 DeepSeek API Key",
        );
      }
      if (!model) {
        throw new InvalidArgumentError(
          "DeepSeek model is required",
          "在设置页配置 DeepSeek 模型",
        );
      }
      const baseUrl = settings.deepseekBaseUrl ?? env.deepseekBaseUrl;
      const { DeepSeekScriptPlanner } = await import("../planner/deepseek-script-planner.js");
      return new DeepSeekScriptPlanner({
        apiKey,
        model,
        ...(baseUrl ? { baseUrl } : {}),
      });
    }
    case "stepfun": {
      const apiKey = settings.stepApiKey ?? env.stepApiKey;
      if (!apiKey) {
        throw new InvalidArgumentError(
          "StepFun API key is required",
          "在设置页配置 StepFun API Key",
        );
      }
      const model = settings.stepModel ?? env.stepModel;
      const baseUrl = settings.stepBaseUrl ?? env.stepBaseUrl;
      const { StepFunScriptPlanner } = await import("../planner/stepfun-script-planner.js");
      return new StepFunScriptPlanner({
        apiKey,
        ...(model ? { model } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      });
    }
    default:
      throw new InvalidArgumentError(
        `Unknown planner provider: ${name}`,
        `不支持的 planner：${name}，可选 fixture/deepseek/stepfun`,
      );
  }
}

/**
 * Builds an AssetProviderEnvConfig from settings (priority) + .env (fallback).
 * Used by the Review Server's searchProjectAssets endpoint.
 */
export function assetProviderEnvFromSettings(settings: Settings): AssetProviderEnvConfig {
  const env = readAssetProviderEnv();
  return {
    pexelsApiKey: settings.pexelsApiKey ?? env.pexelsApiKey,
    pexelsBaseUrl: settings.pexelsBaseUrl ?? env.pexelsBaseUrl,
    pexelsVideoBaseUrl: settings.pexelsVideoBaseUrl ?? env.pexelsVideoBaseUrl,
    pixabayApiKey: settings.pixabayApiKey ?? env.pixabayApiKey,
    unsplashApiKey: settings.unsplashApiKey ?? env.unsplashApiKey,
    openverseApiKey: settings.openverseApiKey ?? env.openverseApiKey,
  };
}

/**
 * Returns the list of provider names that are currently usable based on which
 * API keys are configured. Always includes "fixture" as a fallback.
 *
 * If `providers` is specified, filters to only those that are usable.
 */
export function resolveConfiguredProviders(
  env: AssetProviderEnvConfig,
  providers?: readonly string[],
): string[] {
  const usable: string[] = ["fixture"];
  if (env.pexelsApiKey) usable.push("pexels");
  if (env.pixabayApiKey) usable.push("pixabay");
  if (env.unsplashApiKey) usable.push("unsplash");
  usable.push("openverse"); // no key required

  if (providers && providers.length > 0) {
    const usableSet = new Set(usable);
    return providers.filter((p) => usableSet.has(p));
  }
  return usable;
}
