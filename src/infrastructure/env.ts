/**
 * Environment variable access for infrastructure configuration.
 *
 * All planner and asset provider environment variables are read through this module.
 * Never hard-code API keys, base URLs, or model names in Domain or Application.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Planner provider configuration from environment.
 */
export interface PlannerEnvConfig {
  readonly provider: string;
  readonly deepseekApiKey?: string;
  readonly deepseekBaseUrl?: string;
  readonly deepseekModel?: string;
}

/**
 * Asset provider configuration from environment.
 */
export interface AssetProviderEnvConfig {
  readonly pexelsApiKey: string | undefined;
  readonly pexelsBaseUrl: string | undefined;
  readonly pexelsVideoBaseUrl: string | undefined;
}

/**
 * Combined environment configuration.
 */
export interface EnvConfig {
  readonly planner: PlannerEnvConfig;
  readonly assetProvider: AssetProviderEnvConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads an environment variable, returning undefined if not set.
 */
function getEnv(name: string): string | undefined {
  return process.env[name] ?? undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads planner configuration from environment variables.
 *
 * Variables:
 * - `S2S_PLANNER_PROVIDER` - planner provider ("fixture" or "deepseek")
 * - `DEEPSEEK_API_KEY` - DeepSeek API key (required for deepseek provider)
 * - `DEEPSEEK_BASE_URL` - DeepSeek base URL
 * - `DEEPSEEK_MODEL` - DeepSeek model name
 */
export function readPlannerEnv(): PlannerEnvConfig {
  const apiKey = getEnv("DEEPSEEK_API_KEY");
  const baseUrl = getEnv("DEEPSEEK_BASE_URL");
  const model = getEnv("DEEPSEEK_MODEL");

  const result: Record<string, unknown> = {
    provider: getEnv("S2S_PLANNER_PROVIDER") ?? "fixture",
  };
  if (apiKey !== undefined) {
    result.deepseekApiKey = apiKey;
  }
  if (baseUrl !== undefined) {
    result.deepseekBaseUrl = baseUrl;
  }
  if (model !== undefined) {
    result.deepseekModel = model;
  }
  return result as unknown as PlannerEnvConfig;
}

/**
 * Reads asset provider configuration from environment variables.
 *
 * Variables:
 * - `PEXELS_API_KEY` - Pexels API key (required for pexels provider)
 * - `PEXELS_BASE_URL` - Pexels photo API base URL
 * - `PEXELS_VIDEO_BASE_URL` - Pexels video API base URL
 */
export function readAssetProviderEnv(): AssetProviderEnvConfig {
  return {
    pexelsApiKey: getEnv("PEXELS_API_KEY") ?? undefined,
    pexelsBaseUrl: getEnv("PEXELS_BASE_URL") ?? undefined,
    pexelsVideoBaseUrl: getEnv("PEXELS_VIDEO_BASE_URL") ?? undefined,
  };
}

/**
 * Reads full environment configuration.
 */
export function readEnv(): EnvConfig {
  return {
    planner: readPlannerEnv(),
    assetProvider: readAssetProviderEnv(),
  };
}
