import { describe, expect, it } from "vitest";

import {
  NarrativeRoleSchema,
  VisualDecisionSchema,
  SourceAnchorSchema,
  SearchQuerySchema,
  SceneSearchSchema,
  ReviewDecisionSchema,
  LocalAssetSchema,
  SceneSchema,
} from "../../src/domain/scene-schema.js";

// ---------------------------------------------------------------------------
// NarrativeRoleSchema
// ---------------------------------------------------------------------------

describe("NarrativeRoleSchema", () => {
  const validRoles = [
    "hook",
    "question",
    "claim",
    "explanation",
    "example",
    "comparison",
    "process",
    "data",
    "story",
    "emotion",
    "transition",
    "conclusion",
    "call_to_action",
  ];

  it.each(validRoles)("accepts role: %s", (role) => {
    expect(NarrativeRoleSchema.parse(role)).toBe(role);
  });

  it("rejects unknown role", () => {
    expect(() => NarrativeRoleSchema.parse("unknown_role")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VisualDecisionSchema
// ---------------------------------------------------------------------------

describe("VisualDecisionSchema", () => {
  const validDecisions = [
    "speaker_only",
    "stock_asset",
    "title_card",
    "structured_graphic",
    "screen_capture",
    "user_asset",
    "none",
  ];

  it.each(validDecisions)("accepts decision: %s", (decision) => {
    expect(VisualDecisionSchema.parse(decision)).toBe(decision);
  });

  it("rejects unknown decision", () => {
    expect(() => VisualDecisionSchema.parse("ai_generated")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SourceAnchorSchema
// ---------------------------------------------------------------------------

describe("SourceAnchorSchema", () => {
  const validAnchor = {
    strategy: "source-blocks-v1" as const,
    sourceBlockIds: ["block-001", "block-002"],
    startQuote: "Hello world",
    endQuote: "Goodbye world",
  };

  it("accepts valid anchor", () => {
    expect(SourceAnchorSchema.parse(validAnchor)).toEqual(validAnchor);
  });

  it("rejects duplicate sourceBlockIds", () => {
    expect(() =>
      SourceAnchorSchema.parse({
        ...validAnchor,
        sourceBlockIds: ["block-001", "block-001"],
      }),
    ).toThrow();
  });

  it("rejects empty sourceBlockIds", () => {
    expect(() =>
      SourceAnchorSchema.parse({
        ...validAnchor,
        sourceBlockIds: [],
      }),
    ).toThrow();
  });

  it("rejects empty quotes", () => {
    expect(() =>
      SourceAnchorSchema.parse({
        ...validAnchor,
        startQuote: "   ",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SearchQuerySchema
// ---------------------------------------------------------------------------

describe("SearchQuerySchema", () => {
  const validQuery = {
    id: "query-001",
    language: "zh" as const,
    query: "product demo",
    purpose: "Find product screenshots",
    enabled: true,
  };

  it("accepts valid query", () => {
    expect(SearchQuerySchema.parse(validQuery)).toEqual(validQuery);
  });

  it("rejects empty query text", () => {
    expect(() =>
      SearchQuerySchema.parse({
        ...validQuery,
        query: "   ",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SceneSearchSchema
// ---------------------------------------------------------------------------

describe("SceneSearchSchema", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseCandidate = () => ({
    id: "candidate-001",
    provider: {
      id: "pexels",
      name: "Pexels",
      homepageUrl: "https://www.pexels.com",
      termsUrl: "https://www.pexels.com/terms",
      policyRevision: "1.0.0",
      termsCheckedAt: "2026-07-13T10:00:00Z",
    },
    providerAssetId: "photo-12345",
    mediaType: "photo" as const,
    thumbnailUrl: "https://images.pexels.com/photos/12345/thumb.jpg",
    sourcePageUrl: "https://www.pexels.com/photo/12345",
    width: 1920,
    height: 1080,
    orientation: "landscape" as const,
    creator: { name: "John Doe" },
    rights: {
      status: "unknown" as const,
      attributionRequired: false,
      commercialUse: "unclear" as const,
      derivatives: "unclear" as const,
      verifiedAt: "2026-07-13T10:00:00Z",
      evidence: {
        capturedAt: "2026-07-13T10:00:00Z",
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    },
    retrievedAt: "2026-07-13T10:00:00Z",
    matchedQueryId: "query-001",
    rank: 1,
  });

  const validSearch = {
    queries: [
      {
        id: "query-001",
        language: "zh" as const,
        query: "product demo",
        purpose: "Find product screenshots",
        enabled: true,
      },
    ],
    candidates: [baseCandidate()],
    lastSearchedAt: "2026-07-13T10:00:00Z",
  };

  it("accepts valid search with candidates", () => {
    expect(SceneSearchSchema.parse(validSearch)).toEqual(validSearch);
  });

  it("rejects candidates without lastSearchedAt", () => {
    expect(() =>
      SceneSearchSchema.parse({
        ...validSearch,
        lastSearchedAt: undefined,
      }),
    ).toThrow();
  });

  it("rejects duplicate query IDs", () => {
    expect(() =>
      SceneSearchSchema.parse({
        ...validSearch,
        queries: [
          { ...validSearch.queries[0]!, id: "query-001" },
          { ...validSearch.queries[0]!, id: "query-001" },
        ],
      }),
    ).toThrow();
  });

  it("rejects candidate with unmatched queryId", () => {
    expect(() =>
      SceneSearchSchema.parse({
        ...validSearch,
        candidates: [
          {
            ...baseCandidate(),
            matchedQueryId: "nonexistent-query",
          },
        ],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReviewDecisionSchema
// ---------------------------------------------------------------------------

describe("ReviewDecisionSchema", () => {
  it("accepts pending", () => {
    expect(ReviewDecisionSchema.parse({ kind: "pending" })).toEqual({ kind: "pending" });
    expect(ReviewDecisionSchema.parse({ kind: "pending", note: "Will review later" })).toEqual({
      kind: "pending",
      note: "Will review later",
    });
  });

  it("accepts skipped", () => {
    expect(
      ReviewDecisionSchema.parse({
        kind: "skipped",
        decidedAt: "2026-07-13T10:00:00Z",
      }),
    ).toBeDefined();
  });

  it("accepts candidate_selected", () => {
    const decision = {
      kind: "candidate_selected" as const,
      selection: {
        selectedAt: "2026-07-13T10:00:00Z",
        candidate: {
          id: "candidate-001",
          provider: {
            id: "pexels",
            name: "Pexels",
            homepageUrl: "https://www.pexels.com",
            termsUrl: "https://www.pexels.com/terms",
            policyRevision: "1.0.0",
            termsCheckedAt: "2026-07-13T10:00:00Z",
          },
          providerAssetId: "photo-12345",
          mediaType: "photo" as const,
          thumbnailUrl: "https://images.pexels.com/photos/12345/thumb.jpg",
          sourcePageUrl: "https://www.pexels.com/photo/12345",
          width: 1920,
          height: 1080,
          orientation: "landscape" as const,
          creator: { name: "John Doe" },
          rights: {
            status: "unknown" as const,
            attributionRequired: false,
            commercialUse: "unclear" as const,
            derivatives: "unclear" as const,
            verifiedAt: "2026-07-13T10:00:00Z",
            evidence: {
              capturedAt: "2026-07-13T10:00:00Z",
              referenceUrl: "https://example.com/terms",
              fields: {},
            },
          },
          retrievedAt: "2026-07-13T10:00:00Z",
          matchedQueryId: "query-001",
          rank: 1,
        },
      },
    };
    expect(ReviewDecisionSchema.parse(decision)).toBeDefined();
  });

  it("accepts local_asset_attached", () => {
    const decision = {
      kind: "local_asset_attached" as const,
      localAsset: {
        relativePath: "assets/scene-001/image.jpg",
        originalFileName: "image.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        sha256: "a".repeat(64),
        importedAt: "2026-07-13T10:00:00Z",
        provenance: { kind: "user_owned" as const },
      },
    };
    expect(ReviewDecisionSchema.parse(decision)).toBeDefined();
  });

  it("rejects unknown kind", () => {
    expect(() => ReviewDecisionSchema.parse({ kind: "unknown" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LocalAssetSchema
// ---------------------------------------------------------------------------

describe("LocalAssetSchema", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseLocalAsset = () => ({
    relativePath: "assets/scene-001/image.jpg",
    originalFileName: "image.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    importedAt: "2026-07-13T10:00:00Z",
    provenance: { kind: "user_owned" as const },
  });

  it("accepts valid local asset", () => {
    expect(LocalAssetSchema.parse(baseLocalAsset())).toBeDefined();
  });

  it("rejects relativePath not under assets/", () => {
    expect(() =>
      LocalAssetSchema.parse({
        ...baseLocalAsset(),
        relativePath: "external/image.jpg",
      }),
    ).toThrow();
  });

  it("rejects invalid MIME type", () => {
    expect(() =>
      LocalAssetSchema.parse({
        ...baseLocalAsset(),
        mimeType: "application/pdf",
      }),
    ).toThrow();
  });

  it("rejects invalid SHA-256", () => {
    expect(() =>
      LocalAssetSchema.parse({
        ...baseLocalAsset(),
        sha256: "not-a-valid-hash",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SceneSchema
// ---------------------------------------------------------------------------

describe("SceneSchema", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseScene = () => ({
    id: "scene-001",
    order: 1,
    sourceAnchor: {
      strategy: "source-blocks-v1" as const,
      sourceBlockIds: ["block-001"],
      startQuote: "Hello world",
      endQuote: "Goodbye world",
    },
    sourceRange: { start: 0, end: 100 },
    text: "Hello world, this is the scene text.",
    summary: "A greeting scene",
    narrativeRole: "hook" as const,
    visualPlan: {
      decision: "stock_asset" as const,
      rationale: "Need a stock photo",
      preferredMedia: ["photo"],
      visualKeywords: ["greeting", "welcome"],
    },
    search: {
      queries: [
        {
          id: "query-001",
          language: "zh" as const,
          query: "greeting",
          purpose: "Find greeting images",
          enabled: true,
        },
      ],
      candidates: [],
    },
    review: { kind: "pending" as const },
  });

  it("accepts valid scene", () => {
    expect(SceneSchema.parse(baseScene())).toBeDefined();
  });

  it("rejects scene with start >= end in range", () => {
    expect(() =>
      SceneSchema.parse({
        ...baseScene(),
        sourceRange: { start: 100, end: 0 },
      }),
    ).toThrow();
  });

  it("rejects scene with empty visualKeywords", () => {
    expect(() =>
      SceneSchema.parse({
        ...baseScene(),
        visualPlan: {
          ...baseScene().visualPlan,
          visualKeywords: [],
        },
      }),
    ).toThrow();
  });

  it("rejects stock_asset scene without enabled query", () => {
    expect(() =>
      SceneSchema.parse({
        ...baseScene(),
        visualPlan: {
          ...baseScene().visualPlan,
          decision: "stock_asset",
          visualKeywords: ["greeting"],
        },
        search: {
          queries: [
            {
              id: "query-001",
              language: "zh" as const,
              query: "greeting",
              purpose: "Find greeting images",
              enabled: false,
            },
          ],
          candidates: [],
        },
      }),
    ).toThrow();
  });
});
