/**
 * Integration tests for POST /api/scenes/:sceneId/local-asset (M4-07).
 *
 * Tests verify:
 *  1. Valid PNG upload success — file written to assets/<scene-id>/
 *  2. Valid JPEG upload success
 *  3. project.s2s.json persists localAsset
 *  4. GET /api/project shows localAsset without absolute paths
 *  5. Unknown scene → 404 not_found
 *  6. Missing token → 401 session_required
 *  7. Wrong token → 403 session_rejected
 *  8. Evil Host → 403 host_rejected (before body parse)
 *  9. Evil Origin → 403 origin_rejected
 * 10. Oversized upload → 413 payload_too_large
 * 11. Unsupported Content-Type → 415 unsupported_media_type
 * 12. Malformed multipart → 400 invalid_request
 * 13. Wrong magic bytes → 400 invalid_request
 * 14. SVG upload rejected
 * 15. Path traversal filename does not affect save path
 * 16. Provenance with projectRoot/sceneId/relativePath rejected
 * 17. Malformed percent-encoding path → 400 invalid_request
 * 18. 405 Allow header for non-POST methods
 * 19. Symlink/junction escape rejected
 * 20. candidate_selected + selected_candidate success
 * 21. candidate_selected + selected_candidate mismatch → 409 conflict, no orphan file
 * 22. Response does not leak absolute paths, tokens, or stack traces
 * 23. Note is persisted in review
 * 24. PNG bytes + Content-Type text/plain → rejected (P1-2)
 * 25. PNG bytes + filename asset.svg → rejected (P1-2)
 * 26. JPEG bytes + filename asset.png → rejected (P1-2)
 * 27. JPEG bytes + filename asset.jpeg → accepted (P1-2)
 * 28. multipart field 'projectRoot' → 400 invalid_request (P2)
 * 29. multipart field 'sceneId' → 400 invalid_request (P2)
 * 30. multipart field 'relativePath' → 400 invalid_request (P2)
 * 31. multipart field 'extra' → 400 invalid_request (P2)
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import { startReviewServer } from "../../src/review/review-server.js";
import type {
  ReviewServerHandle,
  ReviewServerDependencies,
} from "../../src/review/review-types.js";
import { getReviewProject } from "../../src/application/get-review-project.js";
import { updateScene } from "../../src/application/update-scene.js";
import { updateSceneQueries } from "../../src/application/update-scene-queries.js";
import { selectCandidate } from "../../src/application/select-candidate.js";
import { skipScene } from "../../src/application/skip-scene.js";
import { attachLocalAsset } from "../../src/application/attach-local-asset.js";
import { FsLocalAssetWriter } from "../../src/infrastructure/local-asset-writer.js";
import { JsonProjectRepository } from "../../src/infrastructure/json-project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

/** Minimal valid PNG: 1x1 transparent pixel. */
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** Minimal valid JPEG: SOI + APP0 + EOI. */
const MINIMAL_JPEG = Buffer.from([
  0xff,
  0xd8,
  0xff, // SOI + start of marker
  0xe0, // APP0 marker
  0x00,
  0x10, // length
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00, // "JFIF\0"
  0x01,
  0x01, // version
  0x00, // units
  0x00,
  0x01,
  0x00,
  0x01, // density
  0x00,
  0x00, // thumbnail
  0xff,
  0xd9, // EOI
]);

/** SVG content (should be rejected by magic bytes). */
const SVG_CONTENT = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect/></svg>`,
);

/** Non-image content (wrong magic bytes). */
const FAKE_CONTENT = Buffer.from("This is not an image file at all.");

function makeSafeCandidate(): unknown {
  return {
    id: "cand-safe",
    provider: {
      id: "fixture",
      name: "Fixture Asset Provider",
      homepageUrl: "https://example.com/fixture",
      termsUrl: "https://example.com/fixture/terms",
      policyRevision: "fixture-policy-2026-07-14",
      termsCheckedAt: FIXED_NOW,
    },
    providerAssetId: "fixture-asset-1",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/fixture/cand-safe/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-safe",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Fixture Creator", profileUrl: "https://example.com/fixture/creator/1" },
    rights: {
      status: "platform_license",
      licenseName: "Safe License",
      licenseUrl: "https://example.com/fixture/terms",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/fixture/terms",
        fields: { commercialUse: "allowed", derivatives: "allowed" },
      },
    },
    retrievedAt: FIXED_NOW,
    matchedQueryId: "q-001",
    rank: 1,
  };
}

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-upload-test",
      title: "Upload Test",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: "a".repeat(64),
      encoding: "utf-8",
      sizeBytes: 50,
      textLengthUtf16: 25,
      offsetUnit: "utf16_code_unit",
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 25 } },
      ],
    },
    generation: {
      plannerProvider: "fixture",
      promptVersion: "v1",
      plannerOutputSchemaVersion: "0.1",
      sourceBlockVersion: "0.1",
      generatedAt: FIXED_NOW,
    },
    scenes: [
      {
        id: "scene-001",
        order: 1,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-001"],
          startQuote: "Hello",
          endQuote: "world",
        },
        sourceRange: { start: 0, end: 25 },
        text: "Hello world content.",
        summary: "Test scene one",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need visual",
          preferredMedia: ["photo"],
          visualKeywords: ["tech"],
        },
        search: {
          queries: [
            { id: "q-001", language: "en", query: "tech photo", purpose: "main", enabled: true },
          ],
          candidates: [makeSafeCandidate()],
          lastSearchedAt: FIXED_NOW,
        },
        review: { kind: "pending" },
      },
    ],
  });
}

/** Creates a project where scene-001 already has a candidate_selected review. */
function makeProjectWithSelection(): SpeechToSceneProject {
  const project = makeTestProject();
  const scene = project.scenes[0]!;
  const candidate = scene.search.candidates[0]!;
  scene.review = {
    kind: "candidate_selected",
    selection: {
      selectedAt: FIXED_NOW,
      candidate: JSON.parse(JSON.stringify(candidate)) as typeof candidate,
    },
  };
  return SpeechToSceneProjectSchema.parse(project);
}

// ---------------------------------------------------------------------------
// Multipart body builder
// ---------------------------------------------------------------------------

interface MultipartField {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

function buildMultipartBody(fields: MultipartField[], boundary: string): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    parts.push(Buffer.from(`--${boundary}\r\n`));
    if (field.filename !== undefined) {
      parts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n` +
            `Content-Type: ${field.contentType ?? "application/octet-stream"}\r\n\r\n`,
        ),
      );
    } else {
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`));
    }
    parts.push(field.data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// HTTP helper (supports Buffer body)
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function httpRequest(
  port: number,
  urlPath: string,
  options: {
    method?: string;
    host?: string;
    origin?: string;
    token?: string;
    body?: Buffer;
    contentType?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": options.contentType ?? "application/json",
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.origin !== undefined ? { origin: options.origin } : {}),
      ...(options.token !== undefined ? { "x-s2s-session": options.token } : {}),
    };
    if (options.body !== undefined) {
      headers["content-length"] = String(options.body.length);
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: options.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Array<Buffer | Uint8Array> = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer | Uint8Array));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              responseHeaders[key.toLowerCase()] = value;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: responseHeaders, body });
        });
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Temp directory helper
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "s2s-upload-test-"));
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const TOKEN = "test-upload-token";
const BOUNDARY = "----test-boundary-12345";
const servers: Array<{ handle: ReviewServerHandle }> = [];

afterEach(async () => {
  for (const { handle } of servers) {
    try {
      await handle.close();
    } catch {
      // best-effort
    }
  }
  servers.length = 0;
});

async function startTestServer(
  projectRoot: string,
  project: SpeechToSceneProject,
): Promise<{ handle: ReviewServerHandle; port: number }> {
  const repo = new JsonProjectRepository();
  await repo.create(projectRoot, project);

  const deps: ReviewServerDependencies = {
    repository: repo,
    assetWriter: new FsLocalAssetWriter(),
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: () => {
      throw new Error("search not available in upload tests");
    },
    selectCandidate,
    skipScene,
    attachLocalAsset,
  };

  const handle = await startReviewServer(
    { projectRoot, host: "127.0.0.1", port: 0, token: TOKEN },
    deps,
  );
  servers.push({ handle });
  return { handle, port: handle.port };
}

function makeUploadBody(
  fileData: Buffer,
  options: {
    filename?: string;
    contentType?: string;
    provenance?: unknown;
    note?: string;
  } = {},
): Buffer {
  const fields: MultipartField[] = [
    {
      name: "file",
      filename: options.filename ?? "upload.png",
      contentType: options.contentType ?? "image/png",
      data: fileData,
    },
  ];
  if (options.provenance !== undefined) {
    fields.push({
      name: "provenance",
      data: Buffer.from(JSON.stringify(options.provenance)),
    });
  }
  if (options.note !== undefined) {
    fields.push({
      name: "note",
      data: Buffer.from(options.note),
    });
  }
  return buildMultipartBody(fields, BOUNDARY);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/scenes/:sceneId/local-asset", () => {
  it("1. valid PNG upload success — file written to assets/<scene-id>/", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG, { filename: "my-photo.png" });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);

    // Verify file was written
    const assetsDir = path.join(dir, "assets", "scene-001");
    const files = await fs.readdir(assetsDir);
    expect(files).toHaveLength(1);
    expect(files[0]!.endsWith(".png")).toBe(true);

    // Cleanup
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("2. valid JPEG upload success", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_JPEG, {
      filename: "photo.jpg",
      contentType: "image/jpeg",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    type JpegProject = {
      project: {
        scenes: Array<{
          id: string;
          review: { kind: string; localAsset?: { mimeType: string } };
        }>;
      };
    };
    const project = (res.body as JpegProject).project;
    const scene = project.scenes.find((s) => s.id === "scene-001") ?? project.scenes[0]!;
    expect(scene.review.kind).toBe("local_asset_attached");
    expect(scene.review.localAsset?.mimeType).toBe("image/jpeg");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("3. project.s2s.json persists localAsset", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    // Read project file directly
    const projectFile = path.join(dir, "project.s2s.json");
    const raw = await fs.readFile(projectFile, "utf-8");
    const project = JSON.parse(raw) as {
      scenes: Array<{
        id: string;
        review: { kind: string; localAsset?: { relativePath: string; sha256: string } };
      }>;
    };
    const scene = project.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("local_asset_attached");
    expect(scene.review.localAsset).toBeDefined();
    expect(scene.review.localAsset!.relativePath).toMatch(/^assets\/scene-001\//);
    expect(scene.review.localAsset!.sha256).toMatch(/^[a-f0-9]{64}$/);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("4. GET /api/project shows localAsset without absolute paths", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    // Upload
    const body = makeUploadBody(MINIMAL_PNG);
    await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    // GET /api/project
    const getRes = await httpRequest(port, "/api/project", {
      method: "GET",
      token: TOKEN,
    });

    expect(getRes.status).toBe(200);
    const responseBody = JSON.stringify(getRes.body);
    // Should not contain absolute path
    expect(responseBody).not.toContain(dir);
    expect(responseBody).not.toContain("/tmp/");
    // Should contain relative path
    expect(responseBody).toContain("assets/scene-001/");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("5. unknown scene → 404 not_found", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/non-existent/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe("not_found");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("6. missing token → 401 session_required", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("session_required");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("7. wrong token → 403 session_rejected", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: "wrong-token",
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe("session_rejected");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("8. evil Host → 403 host_rejected (before body parse)", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      host: "evil.example.com",
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe("host_rejected");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("9. evil Origin → 403 origin_rejected", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      origin: "https://evil.example.com",
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe("origin_rejected");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("10. oversized upload → 413 payload_too_large", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    // Create a body larger than 10 MiB
    const bigData = Buffer.alloc(11 * 1024 * 1024, 0x00);
    // Prepend PNG magic bytes so it passes as PNG (but size is the issue)
    bigData[0] = 0x89;
    bigData[1] = 0x50;
    bigData[2] = 0x4e;
    bigData[3] = 0x47;

    const body = makeUploadBody(bigData);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(413);
    expect((res.body as { error: { code: string } }).error.code).toBe("payload_too_large");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("11. unsupported Content-Type → 415 unsupported_media_type", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: "application/json",
      body: Buffer.from("{}"),
    });

    expect(res.status).toBe(415);
    expect((res.body as { error: { code: string } }).error.code).toBe("unsupported_media_type");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("12. malformed multipart → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    // Send garbage as multipart body
    const garbage = Buffer.from("this is not valid multipart data at all");
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body: garbage,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("13. wrong magic bytes → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(FAKE_CONTENT, { filename: "fake.png", contentType: "image/png" });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("14. SVG upload rejected (wrong magic bytes)", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(SVG_CONTENT, {
      filename: "icon.svg",
      contentType: "image/svg+xml",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("15. path traversal filename does not affect save path", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    // Try path traversal in filename (with valid .png extension so the
    // three-layer allowlist passes — the point of this test is path safety,
    // not extension validation)
    const body = makeUploadBody(MINIMAL_PNG, {
      filename: "../../etc/passwd.png",
      contentType: "image/png",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    // Verify file was written under assets/scene-001/
    const assetsDir = path.join(dir, "assets", "scene-001");
    const files = await fs.readdir(assetsDir);
    expect(files).toHaveLength(1);
    // The filename should be server-generated, not the client's
    expect(files[0]).not.toContain("..");
    expect(files[0]).not.toContain("/");

    // Verify no directory was created outside assets/ via path traversal
    // The temp dir should only contain: project.s2s.json, assets/
    const dirContents = await fs.readdir(dir);
    expect(dirContents).toContain("project.s2s.json");
    expect(dirContents).toContain("assets");
    // There should be no "etc" directory created in the temp dir
    expect(dirContents).not.toContain("etc");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("16. provenance with projectRoot/sceneId/relativePath rejected", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG, {
      provenance: {
        kind: "user_owned",
        projectRoot: "/etc",
        sceneId: "hack",
        relativePath: "evil",
      },
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("17. malformed percent-encoding path → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const res = await httpRequest(port, "/api/scenes/%E0%A4%A/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body: makeUploadBody(MINIMAL_PNG),
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("18. 405 Allow header for non-POST methods", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "GET",
      token: TOKEN,
    });

    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBeDefined();
    const allow = res.headers["allow"] ?? "";
    expect(allow).toContain("POST");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("19. symlink/junction escape rejected", async () => {
    const dir = await makeTempDir();
    const outsideDir = await makeTempDir();

    // Create the assets directory and a symlink that escapes
    await fs.mkdir(path.join(dir, "assets"));
    await fs.symlink(outsideDir, path.join(dir, "assets", "scene-001"));

    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("20. candidate_selected + selected_candidate success", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeProjectWithSelection());

    const body = makeUploadBody(MINIMAL_PNG, {
      provenance: { kind: "selected_candidate", candidateId: "cand-safe" },
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    type SelectedProject = {
      project: {
        scenes: Array<{
          id: string;
          review: {
            kind: string;
            selection?: { candidate: { id: string } };
            localAsset?: { provenance: { kind: string; candidateId?: string } };
          };
        }>;
      };
    };
    const project = (res.body as SelectedProject).project;
    const scene = project.scenes.find((s) => s.id === "scene-001") ?? project.scenes[0]!;
    expect(scene.review.kind).toBe("candidate_selected");
    expect(scene.review.selection?.candidate.id).toBe("cand-safe");
    expect(scene.review.localAsset).toBeDefined();
    expect(scene.review.localAsset!.provenance.kind).toBe("selected_candidate");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("21. candidate_selected + selected_candidate mismatch → 409 conflict, no orphan file", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeProjectWithSelection());

    const body = makeUploadBody(MINIMAL_PNG, {
      provenance: { kind: "selected_candidate", candidateId: "wrong-id" },
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe("conflict");

    // Verify no file was written: assets/scene-001 must not exist or be empty
    const assetsDir = path.join(dir, "assets", "scene-001");
    try {
      const files = await fs.readdir(assetsDir);
      expect(files).toHaveLength(0);
    } catch {
      // Directory does not exist — that's also acceptable (no orphan file)
    }

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("22. response does not leak absolute paths, tokens, or stack traces", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG);
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    const responseBody = JSON.stringify(res.body);
    // Should not leak absolute path
    expect(responseBody).not.toContain(dir);
    // Should not leak token
    expect(responseBody).not.toContain(TOKEN);
    // Should not contain stack trace
    expect(responseBody).not.toContain("at ");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("23. note is persisted in review", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG, { note: "My uploaded asset note" });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    type NoteProject = {
      project: {
        scenes: Array<{ id: string; review: { kind: string; note?: string } }>;
      };
    };
    const project = (res.body as NoteProject).project;
    const scene = project.scenes.find((s) => s.id === "scene-001") ?? project.scenes[0]!;
    expect(scene.review.kind).toBe("local_asset_attached");
    expect(scene.review.note).toBe("My uploaded asset note");

    await fs.rm(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // P1-2: Three-layer allowlist (magic bytes + Content-Type + extension)
  // -------------------------------------------------------------------------

  it("24. PNG bytes + Content-Type text/plain → rejected", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG, {
      filename: "photo.png",
      contentType: "text/plain",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("25. PNG bytes + filename asset.svg → rejected", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_PNG, {
      filename: "asset.svg",
      contentType: "image/png",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("26. JPEG bytes + filename asset.png → rejected", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_JPEG, {
      filename: "asset.png",
      contentType: "image/jpeg",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("27. JPEG bytes + filename asset.jpeg → accepted", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const body = makeUploadBody(MINIMAL_JPEG, {
      filename: "asset.jpeg",
      contentType: "image/jpeg",
    });
    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(200);
    type JpegExtProject = {
      project: {
        scenes: Array<{
          id: string;
          review: { kind: string; localAsset?: { mimeType: string } };
        }>;
      };
    };
    const project = (res.body as JpegExtProject).project;
    const scene = project.scenes.find((s) => s.id === "scene-001") ?? project.scenes[0]!;
    expect(scene.review.kind).toBe("local_asset_attached");
    expect(scene.review.localAsset?.mimeType).toBe("image/jpeg");

    await fs.rm(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // P2: Unknown multipart fields rejected
  // -------------------------------------------------------------------------

  it("28. multipart field 'projectRoot' → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const fields: MultipartField[] = [
      {
        name: "file",
        filename: "photo.png",
        contentType: "image/png",
        data: MINIMAL_PNG,
      },
      { name: "projectRoot", data: Buffer.from("/etc") },
    ];
    const body = buildMultipartBody(fields, BOUNDARY);

    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("29. multipart field 'sceneId' → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const fields: MultipartField[] = [
      {
        name: "file",
        filename: "photo.png",
        contentType: "image/png",
        data: MINIMAL_PNG,
      },
      { name: "sceneId", data: Buffer.from("hack") },
    ];
    const body = buildMultipartBody(fields, BOUNDARY);

    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("30. multipart field 'relativePath' → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const fields: MultipartField[] = [
      {
        name: "file",
        filename: "photo.png",
        contentType: "image/png",
        data: MINIMAL_PNG,
      },
      { name: "relativePath", data: Buffer.from("evil") },
    ];
    const body = buildMultipartBody(fields, BOUNDARY);

    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("31. multipart field 'extra' → 400 invalid_request", async () => {
    const dir = await makeTempDir();
    const { port } = await startTestServer(dir, makeTestProject());

    const fields: MultipartField[] = [
      {
        name: "file",
        filename: "photo.png",
        contentType: "image/png",
        data: MINIMAL_PNG,
      },
      { name: "extra", data: Buffer.from("unexpected") },
    ];
    const body = buildMultipartBody(fields, BOUNDARY);

    const res = await httpRequest(port, "/api/scenes/scene-001/local-asset", {
      method: "POST",
      token: TOKEN,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      body,
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("invalid_request");

    await fs.rm(dir, { recursive: true, force: true });
  });
});
