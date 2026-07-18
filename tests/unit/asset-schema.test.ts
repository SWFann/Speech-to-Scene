import { describe, expect, it } from "vitest";

import {
  AssetProviderSnapshotSchema,
  RightsEvidenceSchema,
  AssetRightsSchema,
  AssetCandidateSchema,
} from "../../src/domain/asset-schema.js";

// ---------------------------------------------------------------------------
// AssetProviderSnapshotSchema
// ---------------------------------------------------------------------------

describe("AssetProviderSnapshotSchema", () => {
  const validSnapshot = {
    id: "pexels",
    name: "Pexels",
    homepageUrl: "https://www.pexels.com",
    termsUrl: "https://www.pexels.com/terms",
    policyRevision: "1.0.0",
    termsCheckedAt: "2026-07-13T10:00:00Z",
  };

  it("accepts valid snapshot", () => {
    expect(AssetProviderSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot);
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() =>
      AssetProviderSnapshotSchema.parse({
        ...validSnapshot,
        homepageUrl: "http://example.com",
      }),
    ).toThrow();
  });

  it("rejects invalid ID", () => {
    expect(() =>
      AssetProviderSnapshotSchema.parse({
        ...validSnapshot,
        id: "Pexels_API", // uppercase not allowed
      }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      AssetProviderSnapshotSchema.parse({
        ...validSnapshot,
        name: "   ", // whitespace only
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RightsEvidenceSchema
// ---------------------------------------------------------------------------

describe("RightsEvidenceSchema", () => {
  const validEvidence = {
    capturedAt: "2026-07-13T10:00:00Z",
    referenceUrl: "https://example.com/license",
    fields: {
      license_type: "public_domain",
      attribution: false,
      commercial: true,
      version: 1,
      verified: true,
      note: null,
    },
  };

  it("accepts valid evidence with mixed field types", () => {
    expect(RightsEvidenceSchema.parse(validEvidence)).toEqual(validEvidence);
  });

  it("rejects non-HTTPS reference URL", () => {
    expect(() =>
      RightsEvidenceSchema.parse({
        ...validEvidence,
        referenceUrl: "http://example.com",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AssetRightsSchema
// ---------------------------------------------------------------------------

describe("AssetRightsSchema", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseRights = () => ({
    status: "unknown" as const,
    attributionRequired: false,
    commercialUse: "unclear" as const,
    derivatives: "unclear" as const,
    verifiedAt: "2026-07-13T10:00:00Z",
    evidence: {
      capturedAt: "2026-07-13T10:00:00Z",
      referenceUrl: "https://example.com/terms",
      fields: {} as Record<string, string | number | boolean | null>,
    },
  });

  it("accepts unknown status with unclear commercial/derivatives", () => {
    expect(AssetRightsSchema.parse(baseRights())).toBeDefined();
  });

  it("accepts public_domain with evidence", () => {
    expect(
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "public_domain",
        evidence: {
          capturedAt: "2026-07-13T10:00:00Z",
          referenceUrl: "https://example.com/terms",
          fields: {},
        },
      }),
    ).toBeDefined();
  });

  it("accepts open_license with required fields", () => {
    expect(
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "open_license",
        licenseCode: "CC0-1.0",
        licenseName: "Creative Commons Zero",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    ).toBeDefined();
  });

  it("rejects open_license without licenseCode", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "open_license",
        licenseName: "CC0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    ).toThrow();
  });

  it("rejects open_license without licenseName", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "open_license",
        licenseCode: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    ).toThrow();
  });

  it("rejects open_license without licenseUrl", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "open_license",
        licenseCode: "CC0-1.0",
        licenseName: "CC0",
      }),
    ).toThrow();
  });

  it("rejects platform_license without licenseUrl", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "platform_license",
      }),
    ).toThrow();
  });

  it("rejects unknown status with commercialUse allowed", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        commercialUse: "allowed",
      }),
    ).toThrow();
  });

  it("rejects unknown status with derivatives allowed", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        derivatives: "allowed",
      }),
    ).toThrow();
  });

  it("rejects no_known_copyright with commercialUse allowed", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "no_known_copyright",
        commercialUse: "allowed",
      }),
    ).toThrow();
  });

  it("rejects editorial_only with commercialUse allowed", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        status: "editorial_only",
        commercialUse: "allowed",
      }),
    ).toThrow();
  });

  it("rejects attributionRequired without attributionText", () => {
    expect(() =>
      AssetRightsSchema.parse({
        ...baseRights(),
        attributionRequired: true,
      }),
    ).toThrow();
  });

  it("accepts attributionRequired with attributionText", () => {
    expect(
      AssetRightsSchema.parse({
        ...baseRights(),
        attributionRequired: true,
        attributionText: "Photo by John Doe",
      }),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AssetCandidateSchema
// ---------------------------------------------------------------------------

describe("AssetCandidateSchema", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseCandidate = () => ({
    kind: "asset" as const,
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
    creator: {
      name: "John Doe",
    },
    rights: {
      status: "unknown" as const,
      attributionRequired: false,
      commercialUse: "unclear" as const,
      derivatives: "unclear" as const,
      verifiedAt: "2026-07-13T10:00:00Z",
      evidence: {
        capturedAt: "2026-07-13T10:00:00Z",
        referenceUrl: "https://example.com/terms",
        fields: {} as Record<string, string | number | boolean | null>,
      },
    },
    retrievedAt: "2026-07-13T10:00:00Z",
    matchedQueryId: "query-001",
    rank: 1,
  });

  it("accepts valid photo candidate", () => {
    expect(AssetCandidateSchema.parse(baseCandidate())).toBeDefined();
  });

  it("accepts valid video candidate", () => {
    expect(
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        mediaType: "video",
        durationSeconds: 30.5,
        orientation: "landscape",
      }),
    ).toBeDefined();
  });

  it("rejects photo with durationSeconds", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        durationSeconds: 30,
      }),
    ).toThrow();
  });

  it("rejects video without durationSeconds", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        mediaType: "video",
      }),
    ).toThrow();
  });

  it("rejects video with non-positive durationSeconds", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        mediaType: "video",
        durationSeconds: 0,
      }),
    ).toThrow();
  });

  it("rejects mismatched orientation", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        width: 100,
        height: 100,
        orientation: "landscape", // should be square
      }),
    ).toThrow();
  });

  it("accepts null creator name", () => {
    expect(
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        creator: {
          name: null,
        },
      }),
    ).toBeDefined();
  });

  it("rejects non-HTTPS thumbnail URL", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseCandidate(),
        thumbnailUrl: "http://example.com/thumb.jpg",
      }),
    ).toThrow();
  });

  // ----- generated-kind candidate (Phase 2: AI image generation) -----

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseGeneratedCandidate = () => ({
    kind: "generated" as const,
    id: "gen-001",
    provider: {
      id: "stepfun-image",
      name: "StepFun Image Generator",
      homepageUrl: "https://platform.stepfun.com",
      termsUrl: "https://platform.stepfun.com/terms",
      policyRevision: "stepfun-image-policy-2026-07-18",
      termsCheckedAt: "2026-07-18T00:00:00Z",
    },
    prompt: "A beautiful landscape with mountains",
    imageUrl: "https://example.com/generated.png",
    thumbnailUrl: "https://example.com/generated.png",
    width: 1024,
    height: 1792,
    orientation: "portrait" as const,
    model: "step-image-edit-2",
    generatedAt: "2026-07-18T10:00:00Z",
    matchedQueryId: "query-001",
    rank: 1,
  });

  it("accepts valid generated candidate", () => {
    expect(AssetCandidateSchema.parse(baseGeneratedCandidate())).toBeDefined();
  });

  it("accepts generated candidate with landscape orientation", () => {
    expect(
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        width: 1792,
        height: 1024,
        orientation: "landscape",
      }),
    ).toBeDefined();
  });

  it("accepts generated candidate with square orientation", () => {
    expect(
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        width: 1024,
        height: 1024,
        orientation: "square",
      }),
    ).toBeDefined();
  });

  it("rejects generated candidate with mismatched orientation", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        width: 1024,
        height: 1024,
        orientation: "portrait", // should be square
      }),
    ).toThrow();
  });

  it("rejects generated candidate with non-HTTPS imageUrl", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        imageUrl: "http://example.com/generated.png",
      }),
    ).toThrow();
  });

  it("rejects generated candidate with empty prompt", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        prompt: "   ",
      }),
    ).toThrow();
  });

  it("rejects generated candidate with empty model", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        model: "",
      }),
    ).toThrow();
  });

  it("rejects generated candidate with non-positive rank", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        rank: 0,
      }),
    ).toThrow();
  });

  it("rejects generated candidate with extra fields", () => {
    expect(() =>
      AssetCandidateSchema.parse({
        ...baseGeneratedCandidate(),
        extraField: "should be rejected",
      }),
    ).toThrow();
  });
});
