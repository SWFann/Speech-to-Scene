import { describe, expect, it } from "vitest";

import type { AssetProviderEnvConfig } from "../../src/infrastructure/env.js";
import { resolveConfiguredProviders } from "../../src/cli/provider-factory.js";

function makeEnv(overrides: Partial<AssetProviderEnvConfig> = {}): AssetProviderEnvConfig {
  return {
    pexelsApiKey: undefined,
    pexelsBaseUrl: undefined,
    pexelsVideoBaseUrl: undefined,
    pixabayApiKey: undefined,
    unsplashApiKey: undefined,
    openverseApiKey: undefined,
    ...overrides,
  };
}

describe("resolveConfiguredProviders", () => {
  it("uses Openverse as the keyless production fallback without Fixture", () => {
    expect(resolveConfiguredProviders(makeEnv())).toEqual(["openverse"]);
  });

  it("aggregates configured real providers with Openverse", () => {
    expect(
      resolveConfiguredProviders(
        makeEnv({
          pexelsApiKey: "pexels-key",
          pixabayApiKey: "pixabay-key",
          unsplashApiKey: "unsplash-key",
        }),
      ),
    ).toEqual(["pexels", "pixabay", "unsplash", "openverse"]);
  });

  it("allows Fixture only when it is explicitly requested", () => {
    expect(resolveConfiguredProviders(makeEnv(), ["fixture"])).toEqual(["fixture"]);
    expect(resolveConfiguredProviders(makeEnv({ pexelsApiKey: "key" }), ["pexels"])).toEqual([
      "pexels",
      "openverse",
    ]);
  });

  it("keeps the keyless fallback and surfaces unavailable requested providers", () => {
    expect(resolveConfiguredProviders(makeEnv(), ["pexels"])).toEqual(["pexels", "openverse"]);
    expect(resolveConfiguredProviders(makeEnv(), ["fixture", "pexels"])).toEqual([
      "pexels",
      "openverse",
    ]);
  });
});
