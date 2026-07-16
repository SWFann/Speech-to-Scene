/**
 * Router for the Review Server.
 *
 * Defines all API routes and handles path matching.
 *
 * M4-02: GET /api/health (no token required)
 * M4-03B: GET /api/project (session token required)
 * M4-04B: PATCH /api/scenes/:sceneId (session token + Origin required)
 * M4-04B: PUT  /api/scenes/:sceneId/queries (session token + Origin required)
 * M4-05:  POST /api/scenes/:sceneId/search (session token + Origin required)
 *
 * Response utilities (applySecurityHeaders, sendError, sendSuccess, etc.)
 * are NOT defined here — they live in security/response-headers.ts and
 * json-response.ts. This file only defines routes and path matching.
 */

import { z } from "zod";

import type { RouteDefinition } from "./review-types.js";
import type { ReviewServerDependencies } from "./review-types.js";
import { sendSuccess, sendError, sendInternalError } from "./json-response.js";
import { parseJsonBody } from "./json-body.js";
import {
  parseMultipartUpload,
  validateMagicBytes,
  sendMultipartError,
  type MultipartParseResult,
} from "./multipart-upload.js";
import { safeFileName } from "../application/safe-filename.js";
import type { ServerResponse } from "node:http";
import { ERROR_INVALID_REQUEST } from "./http-errors.js";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";

// ---------------------------------------------------------------------------
// Request body schemas (M4-04BF)
// ---------------------------------------------------------------------------

/**
 * Strict schema for PUT /api/scenes/:sceneId/queries body.
 *
 * Uses z.strictObject to reject any unknown top-level fields.
 * Only `{ queries: [...] }` is accepted.
 */
const PutQueriesBodySchema = z.strictObject({
  queries: z.array(z.unknown()),
});

/**
 * Strict schema for POST /api/scenes/:sceneId/search body.
 *
 * Uses z.strictObject to reject any unknown top-level fields.
 * Only `{ provider, refresh, limit }` is accepted.
 *
 * - provider: must be "fixture" or "pexels".
 * - refresh: optional boolean, defaults to false.
 * - limit: optional integer 1..50, defaults to 12.
 *
 * No client-controlled field can override projectRoot, sceneId, cachePath,
 * or provider configuration — those are server-controlled only.
 */
const SearchBodySchema = z.strictObject({
  provider: z.enum(["fixture", "pexels"]),
  refresh: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(12),
});

/**
 * Maximum length for the skip note.
 */
const MAX_NOTE_LENGTH = 2000;

/**
 * Strict schema for PUT /api/scenes/:sceneId/selection body.
 *
 * Uses z.strictObject to reject any unknown top-level fields.
 * Only `{ candidateId, rightsAcknowledged }` is accepted.
 *
 * - candidateId: must be a valid Id.
 * - rightsAcknowledged: optional boolean, defaults to false.
 *
 * No client-controlled field can override projectRoot, sceneId, or candidate —
 * those are server-controlled only.
 */
const SelectionBodySchema = z.strictObject({
  candidateId: IdSchema,
  rightsAcknowledged: z.boolean().optional().default(false),
});

/**
 * Strict schema for PUT /api/scenes/:sceneId/skip body.
 *
 * Uses z.strictObject to reject any unknown top-level fields.
 * Only `{ note }` is accepted.
 *
 * - note: optional non-empty trimmed string, max 2000 chars.
 *
 * No client-controlled field can override projectRoot or sceneId —
 * those are server-controlled only.
 */
const SkipBodySchema = z.strictObject({
  note: NonEmptyTrimmedStringSchema.refine(
    (s) => s.length <= MAX_NOTE_LENGTH,
    `note 最长 ${MAX_NOTE_LENGTH} 字符`,
  ).optional(),
});

// ---------------------------------------------------------------------------
// Scene ID validation
// ---------------------------------------------------------------------------

/**
 * Validates a sceneId path segment.
 *
 * Rejects:
 * - empty strings
 * - strings with `/`, `\`, or whitespace
 * - strings that don't conform to IdSchema semantics
 *
 * Returns the validated sceneId or null if invalid.
 */
function validateSceneId(raw: string): string | null {
  // Reject empty or whitespace
  if (!raw || raw !== raw.trim()) {
    return null;
  }
  // Reject path separators
  if (raw.includes("/") || raw.includes("\\")) {
    return null;
  }
  // Validate against IdSchema
  const result = IdSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

/**
 * Creates the route table for the server.
 *
 * @param config - The resolved server configuration.
 * @param getBoundPort - A function that returns the current bound port.
 *   This is needed because the port may be 0 at creation time (OS-assigned).
 * @param deps - Injected dependencies (repository, application use cases).
 */
export function createRoutes(config: {
  readonly projectRoot: string;
  readonly host: string;
  readonly getBoundPort: () => number;
  readonly version: string;
  readonly deps?: ReviewServerDependencies;
}): RouteDefinition[] {
  const routes: RouteDefinition[] = [
    {
      path: "/api/health",
      methods: ["GET"],
      handler: (_req, res) => {
        sendSuccess(res, 200, {
          projectRoot: config.projectRoot,
          host: config.host,
          port: config.getBoundPort(),
          version: config.version,
        });
      },
    },
  ];

  // M4-03B + M4-04B: routes that require injected dependencies
  if (config.deps) {
    const {
      repository,
      getReviewProject,
      updateScene,
      updateSceneQueries,
      searchSceneAssets,
      selectCandidate,
      skipScene,
      attachLocalAsset,
      assetWriter,
    } = config.deps;

    // GET /api/project (requires session token)
    routes.push({
      path: "/api/project",
      methods: ["GET"],
      handler: async (_req, res) => {
        try {
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          // Map errors to safe HTTP responses — never leak internal details
          mapProjectLoadError(error, res);
        }
      },
    });

    // PATCH /api/scenes/:sceneId
    routes.push({
      path: "/api/scenes/:sceneId",
      methods: ["PATCH"],
      handler: async (req, res, params) => {
        const sceneId = params.pathParams["sceneId"];

        // Validate sceneId from path
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

        // Read and parse JSON body
        const bodyResult = await parseJsonBody(req, res);
        if (!bodyResult.success) {
          sendError(
            res,
            bodyResult.statusCode,
            bodyResult.code,
            bodyResult.message,
            bodyResult.hint ?? undefined,
          );
          return;
        }

        // Reject no-op patch: { visualPlan: {} } with no fields to update
        const patchData = bodyResult.data;
        if (
          typeof patchData === "object" &&
          patchData !== null &&
          !Array.isArray(patchData) &&
          "visualPlan" in patchData &&
          typeof patchData["visualPlan"] === "object" &&
          patchData["visualPlan"] !== null &&
          !Array.isArray(patchData["visualPlan"]) &&
          Object.keys(patchData["visualPlan"]).length === 0 &&
          !("reviewNote" in patchData)
        ) {
          sendError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            "visualPlan patch must have at least one field",
          );
          return;
        }

        // Build the use case input
        const useCaseInput = {
          projectRoot: config.projectRoot,
          sceneId: validSceneId,
          patch: bodyResult.data,
        };

        try {
          await updateScene(useCaseInput, { repository });
          // Success: return fresh UI-safe view
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // PUT /api/scenes/:sceneId/queries
    routes.push({
      path: "/api/scenes/:sceneId/queries",
      methods: ["PUT"],
      handler: async (req, res, params) => {
        const sceneId = params.pathParams["sceneId"];

        // Validate sceneId from path
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

        // Read and parse JSON body
        const bodyResult = await parseJsonBody(req, res);
        if (!bodyResult.success) {
          sendError(
            res,
            bodyResult.statusCode,
            bodyResult.code,
            bodyResult.message,
            bodyResult.hint ?? undefined,
          );
          return;
        }

        // Strict Zod validation: only { queries: [...] } is accepted.
        // Unknown top-level fields (e.g. extra, projectRoot, sceneId) are rejected.
        const bodyParse = PutQueriesBodySchema.safeParse(bodyResult.data);
        if (!bodyParse.success) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
          return;
        }

        const useCaseInput = {
          projectRoot: config.projectRoot,
          sceneId: validSceneId,
          queries: bodyParse.data.queries,
        };

        try {
          await updateSceneQueries(useCaseInput, { repository });
          // Success: return fresh UI-safe view
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // POST /api/scenes/:sceneId/search (M4-05)
    //
    // Triggers an asset search for exactly one scene using the specified provider.
    // The search reuses the M3 searchProjectAssets use case. After the search
    // completes, a fresh UI-safe project view is returned (same as PATCH/PUT).
    routes.push({
      path: "/api/scenes/:sceneId/search",
      methods: ["POST"],
      handler: async (req, res, params) => {
        const sceneId = params.pathParams["sceneId"];

        // Validate sceneId from path
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

        // Read and parse JSON body
        const bodyResult = await parseJsonBody(req, res);
        if (!bodyResult.success) {
          sendError(
            res,
            bodyResult.statusCode,
            bodyResult.code,
            bodyResult.message,
            bodyResult.hint ?? undefined,
          );
          return;
        }

        // Strict Zod validation: only { provider, refresh, limit } is accepted.
        // Unknown top-level fields (e.g. extra, projectRoot, sceneId, cachePath,
        // provider config) are rejected.
        const bodyParse = SearchBodySchema.safeParse(bodyResult.data);
        if (!bodyParse.success) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
          return;
        }

        // Build the use case input.
        // projectRoot and sceneId come from server config / URL path — never
        // from the request body.
        const useCaseInput = {
          projectRoot: config.projectRoot,
          sceneId: validSceneId,
          provider: bodyParse.data.provider,
          maxAssetsPerQuery: bodyParse.data.limit,
          refresh: bodyParse.data.refresh,
        };

        try {
          await searchSceneAssets(useCaseInput);
          // Success: return fresh UI-safe view (same as PATCH/PUT)
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // PUT /api/scenes/:sceneId/selection (M4-06)
    //
    // Selects an asset candidate for a scene. The candidate must exist in
    // the target scene's search results. If the candidate's rights carry
    // warnings, rightsAcknowledged must be true.
    //
    // After the selection persists, a fresh UI-safe project view is returned.
    routes.push({
      path: "/api/scenes/:sceneId/selection",
      methods: ["PUT"],
      handler: async (req, res, params) => {
        const sceneId = params.pathParams["sceneId"];

        // Validate sceneId from path
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

        // Read and parse JSON body
        const bodyResult = await parseJsonBody(req, res);
        if (!bodyResult.success) {
          sendError(
            res,
            bodyResult.statusCode,
            bodyResult.code,
            bodyResult.message,
            bodyResult.hint ?? undefined,
          );
          return;
        }

        // Strict Zod validation: only { candidateId, rightsAcknowledged } is accepted.
        // Unknown top-level fields (e.g. extra, projectRoot, sceneId) are rejected.
        const bodyParse = SelectionBodySchema.safeParse(bodyResult.data);
        if (!bodyParse.success) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
          return;
        }

        // Build the use case input.
        // projectRoot and sceneId come from server config / URL path — never
        // from the request body.
        const useCaseInput = {
          projectRoot: config.projectRoot,
          sceneId: validSceneId,
          candidateId: bodyParse.data.candidateId,
          rightsAcknowledged: bodyParse.data.rightsAcknowledged,
        };

        try {
          await selectCandidate(useCaseInput, { repository });
          // Success: return fresh UI-safe view
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // POST /api/scenes/:sceneId/local-asset (M4-07)
    //
    // Uploads a local image/video file and attaches it to a scene.
    // The file is written to assets/<scene-id>/ with a server-generated
    // safe filename. The scene's review state is updated to either
    // local_asset_attached or candidate_selected.localAsset depending on
    // the provenance and current review state.
    //
    // After the attachment persists, a fresh UI-safe project view is returned.
    routes.push({
      path: "/api/scenes/:sceneId/local-asset",
      methods: ["POST"],
      handler: async (req, res, params) => {
        const sceneId = params.pathParams["sceneId"];

        // Validate sceneId from path
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

        // Parse multipart/form-data body
        const multipartResult: MultipartParseResult = await parseMultipartUpload(req, res);
        if (!multipartResult.success) {
          sendMultipartError(res, multipartResult);
          return;
        }

        // Validate magic bytes
        const magicResult = validateMagicBytes(multipartResult.file.buffer);
        if (!magicResult.valid || !magicResult.mimeType || !magicResult.extension) {
          sendError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            "File content does not match any allowed type",
            "Upload a valid PNG or JPEG image",
          );
          return;
        }

        // Three-layer allowlist: magic bytes + Content-Type + filename extension.
        // Magic bytes are the ultimate source of truth. The multipart part
        // Content-Type and the original filename extension must both agree
        // with the magic byte detection.
        const partContentType = multipartResult.file.contentType.toLowerCase();
        if (partContentType !== magicResult.mimeType) {
          sendError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            "File Content-Type does not match file content",
            `Expected ${magicResult.mimeType} based on file content`,
          );
          return;
        }

        // Validate the original filename extension against the magic byte result.
        // .jpg and .jpeg both correspond to image/jpeg.
        const originalName = multipartResult.file.originalFileName;
        const lastDot = originalName.lastIndexOf(".");
        if (lastDot === -1 || lastDot === originalName.length - 1) {
          sendError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            "Filename must have a valid extension",
            "Use .png, .jpg, or .jpeg",
          );
          return;
        }
        const fileExt = originalName.slice(lastDot).toLowerCase();
        const allowedExts = magicResult.mimeType === "image/png" ? [".png"] : [".jpg", ".jpeg"];
        if (!allowedExts.includes(fileExt)) {
          sendError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            "Filename extension does not match file content",
            `Expected ${allowedExts.join(" or ")} for ${magicResult.mimeType}`,
          );
          return;
        }

        // Sanitize original filename
        const safeName = safeFileName(multipartResult.file.originalFileName);
        const originalFileName = safeName ?? "upload";

        // Parse provenance JSON if provided
        let provenance: unknown = undefined;
        if (multipartResult.provenance !== null) {
          try {
            provenance = JSON.parse(multipartResult.provenance);
          } catch {
            sendError(res, 400, ERROR_INVALID_REQUEST, "provenance is not valid JSON");
            return;
          }

          // Reject provenance containing projectRoot, sceneId, or relativePath
          if (typeof provenance === "object" && provenance !== null && !Array.isArray(provenance)) {
            const provenanceObj = provenance as Record<string, unknown>;
            if (
              "projectRoot" in provenanceObj ||
              "sceneId" in provenanceObj ||
              "relativePath" in provenanceObj
            ) {
              sendError(
                res,
                400,
                ERROR_INVALID_REQUEST,
                "provenance must not contain projectRoot, sceneId, or relativePath",
              );
              return;
            }
          }
        }

        // Parse note if provided
        let note: string | undefined;
        if (multipartResult.note !== null) {
          const trimmed = multipartResult.note.trim();
          if (trimmed.length > 0) {
            note = trimmed;
          }
        }

        // Build the use case input.
        // projectRoot and sceneId come from server config / URL path — never
        // from the request body.
        const useCaseInput = {
          projectRoot: config.projectRoot,
          sceneId: validSceneId,
          fileBuffer: multipartResult.file.buffer,
          originalFileName,
          mimeType: magicResult.mimeType,
          extension: magicResult.extension,
          ...(provenance !== undefined ? { provenance } : {}),
          ...(note !== undefined ? { note } : {}),
        };

        try {
          await attachLocalAsset(useCaseInput, {
            repository,
            assetWriter,
          });
          // Success: return fresh UI-safe view
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // PUT /api/scenes/:sceneId/skip (M4-06)
    //
    // Marks a scene as skipped in the user's review decision.
    // Search candidates are preserved as an audit chain.
    //
    // After the skip persists, a fresh UI-safe project view is returned.
    routes.push({
      path: "/api/scenes/:sceneId/skip",
      methods: ["PUT"],
      handler: async (req, res, params) => {
        const sceneId = params.pathParams["sceneId"];

        // Validate sceneId from path
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

        // Read and parse JSON body
        const bodyResult = await parseJsonBody(req, res);
        if (!bodyResult.success) {
          sendError(
            res,
            bodyResult.statusCode,
            bodyResult.code,
            bodyResult.message,
            bodyResult.hint ?? undefined,
          );
          return;
        }

        // Strict Zod validation: only { note? } is accepted.
        // Unknown top-level fields (e.g. extra, projectRoot, sceneId) are rejected.
        const bodyParse = SkipBodySchema.safeParse(bodyResult.data);
        if (!bodyParse.success) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
          return;
        }

        // Build the use case input.
        // projectRoot and sceneId come from server config / URL path — never
        // from the request body.
        const useCaseInput: {
          projectRoot: string;
          sceneId: string;
          note?: string;
        } = {
          projectRoot: config.projectRoot,
          sceneId: validSceneId,
          ...(bodyParse.data.note !== undefined ? { note: bodyParse.data.note } : {}),
        };

        try {
          await skipScene(useCaseInput, { repository });
          // Success: return fresh UI-safe view
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Maps project loading errors to safe HTTP responses.
 *
 * Never includes the original exception message, stack trace, or absolute paths.
 */
function mapProjectLoadError(error: unknown, res: ServerResponse): void {
  const err = error as { code?: string };
  const code = err?.code ?? "";

  // ProjectNotFoundError → 404
  if (code === "project_not_found") {
    sendError(res, 404, "not_found", "Project not found", "Ensure the project was created");
    return;
  }

  // ProjectValidationError → 409
  if (
    code === "project_validation_error" ||
    code === "unsupported_schema_version" ||
    code === "project_file_too_large" ||
    code === "source_document_error"
  ) {
    sendError(res, 409, "conflict", "Project data is invalid", undefined);
    return;
  }

  // Unknown I/O or other errors → 500
  // Never include the original error message
  sendInternalError(res);
}

/**
 * Maps mutation use case errors to safe HTTP responses.
 *
 * Error code → status mapping:
 * - ZodError → 400 invalid_request
 * - SceneNotFoundError → 404 not_found
 * - ProjectConflictError → 409 conflict
 * - ProjectValidationError → 409 conflict
 * - ProjectNotPlannedError → 409 conflict (project not planned or provider unavailable)
 * - Unknown → 500 internal_error
 *
 * Never includes: absolute paths, stack traces, raw Zod issues,
 * raw exception messages, session tokens, or API keys.
 */
function mapMutationError(error: unknown, res: ServerResponse): void {
  // ZodError (input validation failure) → 400 invalid_request
  if (z.ZodError[Symbol.hasInstance](error)) {
    sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
    return;
  }

  const err = error as { code?: string };
  const code = err?.code ?? "";

  // SceneNotFoundError → 404
  if (code === "scene_not_found") {
    sendError(res, 404, "not_found", "Scene not found", "Refresh the project and try again");
    return;
  }

  // PathSafetyError (e.g., symlink escape, path traversal) → 400 invalid_request
  if (code === "path_safety_error") {
    sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid file or path");
    return;
  }

  // ProjectConflictError → 409 conflict
  if (code === "project_conflict") {
    sendError(res, 409, "conflict", "Conflict with current project state", undefined);
    return;
  }

  // ProjectValidationError / schema invalid → 409 conflict
  if (
    code === "project_validation_error" ||
    code === "unsupported_schema_version" ||
    code === "project_file_too_large" ||
    code === "source_document_error"
  ) {
    sendError(res, 409, "conflict", "Project data is invalid", undefined);
    return;
  }

  // ProjectNotPlannedError → 409 conflict
  // Covers: project not planned, scene not found (legacy), provider unavailable.
  if (code === "project_not_planned") {
    sendError(res, 409, "conflict", "Conflict with current project state", undefined);
    return;
  }

  // ProjectNotFoundError → 404
  if (code === "project_not_found") {
    sendError(res, 404, "not_found", "Project not found", "Ensure the project was created");
    return;
  }

  // Unknown errors → 500
  sendInternalError(res);
}

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

/**
 * Checks if a route path pattern contains parameters (e.g., `:sceneId`).
 */
export function hasParams(routePath: string): boolean {
  return routePath.includes(":");
}

/**
 * Safely decodes a URI component without throwing.
 *
 * `decodeURIComponent` throws `URIError` on malformed percent-encoding
 * (e.g. `%E0%A4%A` — truncated UTF-8 sequence). This wrapper returns
 * `null` instead of throwing, allowing the caller to handle the error
 * gracefully.
 *
 * @returns The decoded string, or `null` if the input is malformed.
 */
export function safeDecodeURIComponent(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Checks whether any segment of a URL path contains malformed
 * percent-encoding that would cause `decodeURIComponent` to throw.
 *
 * @returns `true` if at least one segment is malformed.
 */
export function pathHasMalformedEncoding(urlPath: string): boolean {
  const segments = urlPath.split("/");
  for (const seg of segments) {
    if (safeDecodeURIComponent(seg) === null) {
      return true;
    }
  }
  return false;
}

/**
 * Matches a request path against a route path pattern.
 *
 * For static routes (no `:`), does exact string comparison.
 * For parameterized routes, splits on `/` and matches segment by segment,
 * extracting `:param` values.
 *
 * Uses `safeDecodeURIComponent` to avoid throwing on malformed
 * percent-encoding. If a segment cannot be decoded, `matchPath`
 * returns `false` (no match).
 *
 * @returns `true` if the path matches, `false` otherwise.
 *          If matched, `params` is populated with extracted values.
 */
export function matchPath(
  routePath: string,
  requestPath: string,
  params: Record<string, string>,
): boolean {
  if (!hasParams(routePath)) {
    return routePath === requestPath;
  }

  const routeSegments = routePath.split("/");
  const requestSegments = requestPath.split("/");

  if (routeSegments.length !== requestSegments.length) {
    return false;
  }

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i]!;
    const requestSeg = requestSegments[i]!;

    if (routeSeg.startsWith(":")) {
      // Parameter segment — extract the value (URL-decode safely)
      const paramName = routeSeg.slice(1);
      const decoded = safeDecodeURIComponent(requestSeg);
      if (decoded === null) {
        // Malformed percent-encoding — do not match this route.
        // The caller (review-server) will detect malformed encoding
        // via pathHasMalformedEncoding and return 400.
        return false;
      }
      params[paramName] = decoded;
    } else if (routeSeg !== requestSeg) {
      return false;
    }
  }

  return true;
}

/**
 * Finds a matching route for the request method and path.
 *
 * For parameterized routes (containing `:param`), extracts path parameters
 * and passes them to the handler via `RouteParams.pathParams`.
 */
export function matchRoute(
  routes: RouteDefinition[],
  method: string,
  urlPath: string,
): RouteDefinition | undefined {
  for (const route of routes) {
    if (route.methods.includes(method)) {
      const params: Record<string, string> = {};
      if (matchPath(route.path, urlPath, params)) {
        // Attach extracted params to the route definition for this match
        // We use a closure to pass params to the handler
        (route as { _matchedParams?: Record<string, string> })._matchedParams = params;
        return route;
      }
    }
  }
  return undefined;
}

/**
 * Parses path parameters from a route path and request path.
 *
 * This is called by the server after route matching. It uses the params
 * extracted during `matchRoute` (stored as `_matchedParams`).
 */
export function parseRouteParams(): Record<string, string> {
  // Parameters are extracted during matchRoute and stored on the route object.
  // This function returns an empty object if called independently (for testing).
  return {};
}

// ---------------------------------------------------------------------------
// Helper to extract matched params (used by review-server.ts)
// ---------------------------------------------------------------------------

/**
 * Retrieves the path parameters that were extracted during `matchRoute`.
 *
 * This is called by the server after `matchRoute` has identified a matching
 * route. The params were stored on the route object during matching.
 *
 * @internal
 */
export function getMatchedParams(route: RouteDefinition): Record<string, string> {
  return (route as { _matchedParams?: Record<string, string> })._matchedParams ?? {};
}
