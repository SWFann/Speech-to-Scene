/**
 * Environment variable access for infrastructure configuration.
 *
 * All planner and asset provider environment variables are read through this module.
 * Never hard-code API keys, base URLs, or model names in Domain or Application.
 */

import fs from "node:fs";
import path from "node:path";

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
  readonly stepApiKey?: string;
  readonly stepBaseUrl?: string;
  readonly stepModel?: string;
}

/**
 * Asset provider configuration from environment.
 */
export interface AssetProviderEnvConfig {
  readonly pexelsApiKey: string | undefined;
  readonly pexelsBaseUrl: string | undefined;
  readonly pexelsVideoBaseUrl: string | undefined;
  readonly pixabayApiKey: string | undefined;
  readonly unsplashApiKey: string | undefined;
  readonly openverseApiKey: string | undefined;
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

let localEnvLoaded = false;

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadLocalEnvFile(): void {
  if (localEnvLoaded) {
    return;
  }
  localEnvLoaded = true;

  // Vitest sets this flag; tests should control process.env explicitly and
  // must not accidentally read a developer's local ignored .env file.
  if (process.env.VITEST === "true") {
    return;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseEnvValue(line.slice(separatorIndex + 1));
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Reads an environment variable, returning undefined if not set.
 */
function getEnv(name: string): string | undefined {
  loadLocalEnvFile();
  return process.env[name] ?? undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads planner configuration from environment variables.
 *
 * Variables:
 * - `S2S_PLANNER_PROVIDER` - planner provider ("fixture", "deepseek", or "stepfun")
 * - `DEEPSEEK_API_KEY` - DeepSeek API key (required for deepseek provider)
 * - `DEEPSEEK_BASE_URL` - DeepSeek base URL
 * - `DEEPSEEK_MODEL` - DeepSeek model name
 * - `STEP_API_KEY` - StepFun API key (required for stepfun provider)
 * - `STEP_BASE_URL` - StepFun OpenAI-compatible base URL
 * - `STEP_MODEL` - StepFun model name
 */
export function readPlannerEnv(): PlannerEnvConfig {
  const apiKey = getEnv("DEEPSEEK_API_KEY");
  const baseUrl = getEnv("DEEPSEEK_BASE_URL");
  const model = getEnv("DEEPSEEK_MODEL");
  const stepApiKey = getEnv("STEP_API_KEY");
  const stepBaseUrl = getEnv("STEP_BASE_URL");
  const stepModel = getEnv("STEP_MODEL");

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
  if (stepApiKey !== undefined) {
    result.stepApiKey = stepApiKey;
  }
  if (stepBaseUrl !== undefined) {
    result.stepBaseUrl = stepBaseUrl;
  }
  if (stepModel !== undefined) {
    result.stepModel = stepModel;
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
    pixabayApiKey: getEnv("PIXABAY_API_KEY") ?? undefined,
    unsplashApiKey: getEnv("UNSPLASH_API_KEY") ?? undefined,
    openverseApiKey: getEnv("OPENVERSE_API_KEY") ?? undefined,
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
