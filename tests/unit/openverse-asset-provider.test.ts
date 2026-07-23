import { describe, expect, it, vi } from "vitest";
import {
  OpenverseAssetProvider,
  type HttpGetClient,
} from "../../src/providers/openverse/openverse-asset-provider.js";
import type { AssetSearchInput } from "../../src/application/ports/asset-provider.js";

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

interface OpenverseResultOverrides {
  readonly id?: string;
  readonly license?: string;
  readonly licenseVersion?: string;
  readonly licenseUrl?: string | null;
  readonly attribution?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

interface OpenverseResult {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly creator: string;
  readonly creator_url: string;
  readonly foreign_landing_url: string;
  readonly thumbnail: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly license: string;
  readonly license_version: string;
  readonly license_url: string | null;
  readonly attribution: string | null;
}

function createOpenverseResult(overrides: OpenverseResultOverrides = {}): OpenverseResult {
  const license = overrides.license ?? "by";
  return {
    id: overrides.id ?? `asset-${license}`,
    title: "Research notes",
    url: "https://images.example.test/original.jpg",
    creator: "Ada Example",
    creator_url: "https://images.example.test/creators/ada",
    foreign_landing_url: "https://images.example.test/works/research-notes",
    thumbnail: "https://images.example.test/thumb.jpg",
    width: overrides.width === undefined ? 1600 : overrides.width,
    height: overrides.height === undefined ? 900 : overrides.height,
    license,
    license_version: overrides.licenseVersion ?? "4.0",
    license_url:
      overrides.licenseUrl === undefined
        ? `https://creativecommons.org/licenses/${license}/4.0/`
        : overrides.licenseUrl,
    attribution:
      overrides.attribution === undefined
        ? '"Research notes" by Ada Example'
        : overrides.attribution,
  };
}

function createSearchInput(
  policy: AssetSearchInput["projectPolicy"] = {
    intendedUse: "commercial_capable",
    willModify: true,
  },
): AssetSearchInput {
  return {
    queryId: "query-1",
    query: "research notes",
    language: "en",
    mediaTypes: ["photo"],
    orientation: "landscape",
    perPage: 10,
    page: 1,
    projectPolicy: policy,
    sceneId: "scene-1",
  };
}

function createProvider(results: OpenverseResult[]): {
  readonly provider: OpenverseAssetProvider;
  readonly getMock: ReturnType<typeof vi.fn>;
} {
  const getMock = vi.fn().mockResolvedValue({
    result_count: results.length,
    page_count: 1,
    results,
  });
  const httpClient: HttpGetClient = {
    get: getMock,
  };
  return {
    provider: new OpenverseAssetProvider({
      baseUrl: "https://api.openverse.test/v1",
      httpClient,
    }),
    getMock,
  };
}

describe("OpenverseAssetProvider", () => {
  it.each([
    {
      license: "cc0",
      status: "public_domain",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
    },
    {
      license: "pdm",
      status: "public_domain",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
    },
    {
      license: "by",
      status: "open_license",
      attributionRequired: true,
      commercialUse: "allowed",
      derivatives: "allowed",
    },
    {
      license: "by-sa",
      status: "open_license",
      attributionRequired: true,
      commercialUse: "allowed",
      derivatives: "share_alike",
    },
    {
      license: "by-nc",
      status: "open_license",
      attributionRequired: true,
      commercialUse: "disallowed",
      derivatives: "allowed",
    },
    {
      license: "by-nd",
      status: "open_license",
      attributionRequired: true,
      commercialUse: "allowed",
      derivatives: "disallowed",
    },
    {
      license: "mystery-license",
      status: "unknown",
      attributionRequired: true,
      commercialUse: "unclear",
      derivatives: "unclear",
    },
  ] as const)(
    "maps $license without overstating rights",
    async ({ license, status, attributionRequired, commercialUse, derivatives }) => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW);
      const licenseUrl = `https://licenses.example.test/${license}`;
      const attribution = `Attribution for ${license}`;
      const { provider } = createProvider([
        createOpenverseResult({ license, licenseUrl, attribution }),
      ]);

      const result = await provider.search(
        createSearchInput({ intendedUse: "editorial", willModify: false }),
      );

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.rights).toMatchObject({
        status,
        licenseCode: license,
        licenseUrl,
        attributionRequired,
        attributionText: attribution,
        commercialUse,
        derivatives,
        evidence: {
          referenceUrl: licenseUrl,
          fields: {
            source: "openverse_api",
            license,
          },
        },
      });
      vi.useRealTimers();
    },
  );

  it.each([
    {
      policy: { intendedUse: "commercial_capable", willModify: true } as const,
      licenseType: "commercial,modification",
      licenses: "cc0,pdm,by,by-sa",
    },
    {
      policy: { intendedUse: "commercial_capable", willModify: false } as const,
      licenseType: "commercial",
      licenses: "cc0,pdm,by,by-sa,by-nd",
    },
    {
      policy: { intendedUse: "noncommercial", willModify: true } as const,
      licenseType: "modification",
      licenses: "cc0,pdm,by,by-sa,by-nc,by-nc-sa",
    },
    {
      policy: { intendedUse: "editorial", willModify: false } as const,
      licenseType: "all",
      licenses: "cc0,pdm,by,by-sa,by-nd,by-nc,by-nc-sa,by-nc-nd",
    },
  ])(
    "narrows the API request for $policy.intendedUse / modify=$policy.willModify",
    async ({ policy, licenseType, licenses }) => {
      const { provider, getMock } = createProvider([]);

      await provider.search(createSearchInput(policy));

      const requestedUrl = new URL(String(getMock.mock.calls[0]?.[0]));
      expect(requestedUrl.searchParams.get("license_type")).toBe(licenseType);
      expect(requestedUrl.searchParams.get("license")).toBe(licenses);
    },
  );

  it.each([
    { width: null, height: 900 },
    { width: 1600, height: null },
    { width: 1, height: 1 },
  ])("drops unusable dimensions width=$width height=$height", async ({ width, height }) => {
    const { provider } = createProvider([createOpenverseResult({ width, height })]);

    const result = await provider.search(
      createSearchInput({ intendedUse: "editorial", willModify: false }),
    );

    expect(result.candidates).toEqual([]);
  });

  it("does not invent a license URL for an unknown license", async () => {
    const { provider } = createProvider([
      createOpenverseResult({
        license: "mystery-license",
        licenseUrl: null,
      }),
    ]);

    const result = await provider.search(
      createSearchInput({ intendedUse: "editorial", willModify: false }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.rights.licenseUrl).toBeUndefined();
    expect(result.candidates[0]?.rights.evidence.referenceUrl).toBe(
      "https://images.example.test/works/research-notes",
    );
  });

  it("drops an open license when the API omits its license source", async () => {
    const { provider } = createProvider([
      createOpenverseResult({
        license: "by",
        licenseUrl: null,
      }),
    ]);

    const result = await provider.search(
      createSearchInput({ intendedUse: "editorial", willModify: false }),
    );

    expect(result.candidates).toEqual([]);
  });
});
