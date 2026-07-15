import { describe, it, expect } from "vitest";
import {
  mapPexelsRights,
  PEXELS_TERMS_URL,
  PEXELS_POLICY_REVISION,
} from "../../src/providers/pexels/pexels-types.js";

describe("mapPexelsRights", () => {
  it("returns platform_license status", () => {
    const rights = mapPexelsRights();
    expect(rights.status).toBe("platform_license");
  });

  it("returns Pexels License name", () => {
    const rights = mapPexelsRights();
    expect(rights.licenseName).toBe("Pexels License");
  });

  it("returns Pexels terms URL", () => {
    const rights = mapPexelsRights();
    expect(rights.licenseUrl).toBe(PEXELS_TERMS_URL);
    expect(rights.licenseUrl).toContain("pexels.com");
  });

  it("sets attributionRequired to false", () => {
    const rights = mapPexelsRights();
    expect(rights.attributionRequired).toBe(false);
  });

  it("allows commercial use", () => {
    const rights = mapPexelsRights();
    expect(rights.commercialUse).toBe("allowed");
  });

  it("allows derivatives", () => {
    const rights = mapPexelsRights();
    expect(rights.derivatives).toBe("allowed");
  });

  it("includes standard restrictions", () => {
    const rights = mapPexelsRights();
    expect(rights.restrictions).toContain(
      "Identifiable persons may not be depicted in a defamatory or sensitive manner",
    );
    expect(rights.restrictions).toContain(
      "Do not redistribute or sell the photos/videos as-is without modification",
    );
    expect(rights.restrictions.length).toBeGreaterThanOrEqual(2);
  });

  it("includes policy revision in evidence", () => {
    const rights = mapPexelsRights();
    expect(rights.evidence.fields.policyRevision).toBe(PEXELS_POLICY_REVISION);
    expect(rights.evidence.fields.source).toBe("pexels_api");
  });

  it("includes verification timestamp", () => {
    const rights = mapPexelsRights();
    expect(rights.verifiedAt).toBeTruthy();
    expect(new Date(rights.verifiedAt).getTime()).toBeGreaterThan(0);
  });

  it("returns consistent results on multiple calls", () => {
    const rights1 = mapPexelsRights();
    const rights2 = mapPexelsRights();
    expect(rights1.status).toBe(rights2.status);
    expect(rights1.licenseName).toBe(rights2.licenseName);
  });
});

describe("Pexels constants", () => {
  it("PEXELS_TERMS_URL is a valid URL", () => {
    expect(PEXELS_TERMS_URL).toMatch(/^https:\/\//);
  });

  it("PEXELS_POLICY_REVISION is a non-empty string", () => {
    expect(PEXELS_POLICY_REVISION.length).toBeGreaterThan(0);
  });
});
