import { describe, expect, it } from "vitest";

import {
  IdSchema,
  Sha256Schema,
  UtcDateTimeSchema,
  HttpsUrlSchema,
  NonEmptyTrimmedStringSchema,
  PositiveIntegerSchema,
  NonNegativeIntegerSchema,
  FinitePositiveNumberSchema,
} from "../../src/domain/schema-primitives.js";

// ---------------------------------------------------------------------------
// IdSchema
// ---------------------------------------------------------------------------

describe("IdSchema", () => {
  it("accepts valid lowercase IDs", () => {
    expect(IdSchema.parse("my-project-123")).toBe("my-project-123");
    expect(IdSchema.parse("a")).toBe("a");
    expect(IdSchema.parse("project.test_123-abc")).toBe("project.test_123-abc");
    expect(IdSchema.parse("123")).toBe("123"); // digit start is allowed
  });

  it("rejects uppercase letters", () => {
    expect(() => IdSchema.parse("MyProject")).toThrow();
    expect(() => IdSchema.parse("ABC")).toThrow();
  });

  it("rejects special characters", () => {
    expect(() => IdSchema.parse("my project")).toThrow(); // space
    expect(() => IdSchema.parse("my@project")).toThrow(); // @
    expect(() => IdSchema.parse("my#project")).toThrow(); // #
    expect(() => IdSchema.parse("my/project")).toThrow(); // /
    expect(() => IdSchema.parse("my\\project")).toThrow(); // backslash
  });

  it("rejects empty and too-long IDs", () => {
    expect(() => IdSchema.parse("")).toThrow();
    expect(() => IdSchema.parse("a".repeat(129))).toThrow();
    expect(() => IdSchema.parse("a".repeat(128))).not.toThrow(); // exactly 128 OK
  });

  it("rejects leading dot or dash", () => {
    expect(() => IdSchema.parse(".hidden")).toThrow();
    expect(() => IdSchema.parse("-dash")).toThrow();
  });

  it("rejects leading/trailing whitespace", () => {
    expect(() => IdSchema.parse("  my-project  ")).toThrow();
    expect(() => IdSchema.parse("my-project ")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sha256Schema
// ---------------------------------------------------------------------------

describe("Sha256Schema", () => {
  const validHash = "aec3d9a3da91d3b3165d834ee37ee0345a28c2597fe4499c24b31249dbe271e1";

  it("accepts valid lowercase hex", () => {
    expect(Sha256Schema.parse(validHash)).toBe(validHash);
    expect(Sha256Schema.parse("0".repeat(64))).toBe("0".repeat(64));
    expect(Sha256Schema.parse("f".repeat(64))).toBe("f".repeat(64));
  });

  it("rejects uppercase hex", () => {
    const upper = validHash.toUpperCase();
    expect(() => Sha256Schema.parse(upper)).toThrow();
  });

  it("rejects wrong length", () => {
    expect(() => Sha256Schema.parse("abc")).toThrow();
    expect(() => Sha256Schema.parse("a".repeat(63))).toThrow();
    expect(() => Sha256Schema.parse("a".repeat(65))).toThrow();
  });

  it("rejects non-hex characters", () => {
    expect(() => Sha256Schema.parse("g".repeat(64))).toThrow();
    expect(() => Sha256Schema.parse("x".repeat(64))).toThrow();
    expect(() => Sha256Schema.parse("z".repeat(64))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// UtcDateTimeSchema
// ---------------------------------------------------------------------------

describe("UtcDateTimeSchema", () => {
  it("accepts ISO 8601 UTC with milliseconds", () => {
    expect(UtcDateTimeSchema.parse("2026-07-13T10:00:00.000Z")).toBe("2026-07-13T10:00:00.000Z");
  });

  it("accepts ISO 8601 UTC without milliseconds", () => {
    expect(UtcDateTimeSchema.parse("2026-07-13T10:00:00Z")).toBe("2026-07-13T10:00:00Z");
  });

  it("rejects timezone offset", () => {
    expect(() => UtcDateTimeSchema.parse("2026-07-13T10:00:00+08:00")).toThrow();
    expect(() => UtcDateTimeSchema.parse("2026-07-13T10:00:00-05:00")).toThrow();
  });

  it("rejects missing Z suffix", () => {
    expect(() => UtcDateTimeSchema.parse("2026-07-13T10:00:00")).toThrow();
    expect(() => UtcDateTimeSchema.parse("2026-07-13")).toThrow();
  });

  it("rejects invalid dates", () => {
    expect(() => UtcDateTimeSchema.parse("not-a-date")).toThrow();
    expect(() => UtcDateTimeSchema.parse("2026-13-01T00:00:00Z")).toThrow();
    expect(() => UtcDateTimeSchema.parse("2026-07-13T25:00:00Z")).toThrow();
    expect(() => UtcDateTimeSchema.parse("2026-02-31T00:00:00Z")).toThrow(); // impossible date
    expect(() => UtcDateTimeSchema.parse("2026-04-31T00:00:00Z")).toThrow(); // impossible date
  });
});

// ---------------------------------------------------------------------------
// HttpsUrlSchema
// ---------------------------------------------------------------------------

describe("HttpsUrlSchema", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(HttpsUrlSchema.parse("https://example.com")).toBe("https://example.com");
    expect(HttpsUrlSchema.parse("https://api.example.com/v1/search?q=test")).toBe(
      "https://api.example.com/v1/search?q=test",
    );
  });

  it("rejects non-HTTPS schemes", () => {
    expect(() => HttpsUrlSchema.parse("http://example.com")).toThrow();
    expect(() => HttpsUrlSchema.parse("ftp://example.com")).toThrow();
    expect(() => HttpsUrlSchema.parse("file:///etc/passwd")).toThrow();
    expect(() => HttpsUrlSchema.parse("javascript:alert(1)")).toThrow();
    expect(() => HttpsUrlSchema.parse("data:text/html,<h1>x</h1>")).toThrow();
  });

  it("rejects relative URLs", () => {
    expect(() => HttpsUrlSchema.parse("/path/to/file")).toThrow();
    expect(() => HttpsUrlSchema.parse("//example.com")).toThrow();
    expect(() => HttpsUrlSchema.parse("path/to/file")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NonEmptyTrimmedStringSchema
// ---------------------------------------------------------------------------

describe("NonEmptyTrimmedStringSchema", () => {
  it("accepts non-empty strings", () => {
    expect(NonEmptyTrimmedStringSchema.parse("hello")).toBe("hello");
  });

  it("rejects pure whitespace", () => {
    expect(() => NonEmptyTrimmedStringSchema.parse("   ")).toThrow();
    expect(() => NonEmptyTrimmedStringSchema.parse("\t\n")).toThrow();
    expect(() => NonEmptyTrimmedStringSchema.parse("")).toThrow();
  });

  it("rejects leading/trailing whitespace", () => {
    expect(() => NonEmptyTrimmedStringSchema.parse("  world  ")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bounded numeric schemas
// ---------------------------------------------------------------------------

describe("PositiveIntegerSchema", () => {
  it("accepts positive integers", () => {
    expect(PositiveIntegerSchema.parse(1)).toBe(1);
    expect(PositiveIntegerSchema.parse(999)).toBe(999);
  });

  it("rejects zero, negative, fractions, and non-integers", () => {
    expect(() => PositiveIntegerSchema.parse(0)).toThrow();
    expect(() => PositiveIntegerSchema.parse(-1)).toThrow();
    expect(() => PositiveIntegerSchema.parse(1.5)).toThrow();
    expect(() => PositiveIntegerSchema.parse(NaN)).toThrow();
    expect(() => PositiveIntegerSchema.parse(Infinity)).toThrow();
  });
});

describe("NonNegativeIntegerSchema", () => {
  it("accepts zero and positive integers", () => {
    expect(NonNegativeIntegerSchema.parse(0)).toBe(0);
    expect(NonNegativeIntegerSchema.parse(100)).toBe(100);
  });

  it("rejects negative values", () => {
    expect(() => NonNegativeIntegerSchema.parse(-1)).toThrow();
  });
});

describe("FinitePositiveNumberSchema", () => {
  it("accepts positive finite numbers", () => {
    expect(FinitePositiveNumberSchema.parse(0.001)).toBe(0.001);
    expect(FinitePositiveNumberSchema.parse(3.14)).toBe(3.14);
  });

  it("rejects zero, negative, NaN, Infinity", () => {
    expect(() => FinitePositiveNumberSchema.parse(0)).toThrow();
    expect(() => FinitePositiveNumberSchema.parse(-1)).toThrow();
    expect(() => FinitePositiveNumberSchema.parse(NaN)).toThrow();
    expect(() => FinitePositiveNumberSchema.parse(Infinity)).toThrow();
  });
});
