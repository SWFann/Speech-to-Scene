/**
 * Router for the Review Server.
 *
 * Defines all API routes and handles path matching.
 *
 * Phase 3 changes:
 * - `projectRoot` is now a mutable ref (projectRootRef) for multi-project support.
 * - `workspaceRoot` added for project listing/switching.
 * - New routes: GET /api/projects, POST /api/project/switch, DELETE /api/project.
 * - POST /api/project/create accepts optional `projectName`.
 * - Session token removed from all routes.
 *
 * Response utilities (applySecurityHeaders, sendError, sendSuccess, etc.)
 * are NOT defined here — they live in security/response-headers.ts and
 * json-response.ts. This file only defines routes and path matching.
 */

import { z } from "zod";

import type { RouteDefinition } from "./review-types.js";
import type { ReviewServerDependencies } from "./review-types.js";
import type { ProjectRootRef } from "./review-server.js";
import { sendSuccess, sendError, sendInternalError } from "./json-response.js";
import { parseJsonBody } from "./json-body.js";
import type { ServerResponse } from "node:http";
import { ERROR_INVALID_REQUEST } from "./http-errors.js";
import { IdSchema } from "../domain/schema-primitives.js";

// ---------------------------------------------------------------------------
// Request body schemas
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
 * Known asset provider names accepted by search endpoints.
 */
const KNOWN_SEARCH_PROVIDERS = [
  "fixture",
  "pexels",
  "pixabay",
  "unsplash",
  "openverse",
] as const;

/**
 * Strict schema for POST /api/scenes/:sceneId/search body.
 *
 * Uses z.strictObject to reject any unknown top-level fields.
 * Only `{ providers, refresh, limit }` is accepted.
 *
 * - providers: optional array of provider names. Defaults to ["fixture"].
 * - refresh: optional boolean, defaults to false.
 * - limit: optional integer 1..50, defaults to 12.
 *
 * No client-controlled field can override projectRoot, sceneId, cachePath,
 * or provider configuration — those are server-controlled only.
 */
const SearchBodySchema = z.strictObject({
  providers: z.array(z.enum(KNOWN_SEARCH_PROVIDERS)).optional(),
  refresh: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(12),
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
// Settings / project body schemas
// ---------------------------------------------------------------------------

/**
 * Strict schema for PUT /api/settings body.
 *
 * Only known fields are accepted; unknown top-level fields are rejected.
 * Keys are optional strings (empty = unset).
 */
const SaveSettingsBodySchema = z.strictObject({
  plannerProvider: z.enum(["fixture", "deepseek", "stepfun"]).optional(),
  deepseekApiKey: z.string().min(1).optional(),
  deepseekBaseUrl: z.string().url().optional(),
  deepseekModel: z.string().min(1).optional(),
  stepApiKey: z.string().min(1).optional(),
  stepBaseUrl: z.string().url().optional(),
  stepModel: z.string().min(1).optional(),
  stepImageModel: z.string().min(1).optional(),
  pexelsApiKey: z.string().min(1).optional(),
  pexelsBaseUrl: z.string().url().optional(),
  pexelsVideoBaseUrl: z.string().url().optional(),
  pixabayApiKey: z.string().min(1).optional(),
  unsplashApiKey: z.string().min(1).optional(),
  openverseApiKey: z.string().min(1).optional(),
});

/**
 * Validates a project name for switch/create operations.
 * Rejects path traversal, hidden dirs, and special chars.
 */
function isValidProjectName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  if (name.startsWith(".")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return false;
  return true;
}

/** Body schema for POST /api/project/create. */
const CreateProjectBodySchema = z.strictObject({
  content: z.string().min(1),
  fileName: z.string().min(1).optional(),
  title: z.string().optional(),
  language: z.enum(["zh-CN", "en-US"]).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  style: z.enum(["knowledge", "story", "commentary"]).optional(),
  intendedUse: z.enum(["commercial_capable", "noncommercial", "editorial"]).optional(),
  willModify: z.boolean().optional(),
  force: z.boolean().optional().default(false),
  /** Phase 3: project name within the workspace (defaults to "default"). */
  projectName: z.string().min(1).optional(),
});

/** Body schema for POST /api/project/plan. */
const PlanProjectBodySchema = z.strictObject({
  provider: z.enum(["fixture", "deepseek", "stepfun"]),
  maxScenes: z.number().int().min(1).max(50).optional().default(12),
  force: z.boolean().optional().default(false),
});

/** Body schema for POST /api/project/search. */
const SearchProjectBodySchema = z.strictObject({
  providers: z.array(z.enum(KNOWN_SEARCH_PROVIDERS)).optional(),
  refresh: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(12),
});

/** Body schema for POST /api/scenes/:sceneId/generate (Phase 2: AI image generation). */
const GenerateImageBodySchema = z.strictObject({
  prompt: z.string().min(1, "prompt 不能为空"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional().default("9:16"),
});

/** Body schema for POST /api/project/switch (Phase 3). */
const SwitchProjectBodySchema = z.strictObject({
  project: z.string().min(1),
});

/** Body schema for DELETE /api/project (Phase 3). */
const DeleteProjectBodySchema = z.strictObject({
  confirm: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

/**
 * Creates the route table for the server.
 *
 * Phase 3: `projectRootRef` is a mutable ref — routes read the current
 * project root dynamically so project switching takes effect immediately.
 * `workspaceRoot` is used for project listing and creation.
 *
 * @param config - The resolved server configuration with workspaceRoot,
 *   projectRootRef, host, getBoundPort, version, and optional deps.
 */
export function createRoutes(config: {
  readonly workspaceRoot: string;
  readonly projectRootRef: ProjectRootRef;
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
          projectRoot: config.projectRootRef.current ?? "",
          host: config.host,
          port: config.getBoundPort(),
          version: config.version,
        });
      },
    },
  ];

  // Routes that require injected dependencies
  if (config.deps) {
    const {
      repository,
      getReviewProject,
      updateScene,
      updateSceneQueries,
      searchSceneAssets,
      getSettings,
      saveSettings,
      createProjectFromContent,
      planProject,
      searchProjectAssets,
      generateSceneImage,
      listProjects,
      switchProject,
      deleteProject,
    } = config.deps;

    // Helper to get current project root (returns null + sends 404 if not set)
    const requireProjectRoot = (res: ServerResponse): string | null => {
      const root = config.projectRootRef.current;
      if (!root) {
        sendError(res, 404, "not_found", "No active project", "Create or switch to a project first");
        return null;
      }
      return root;
    };

    // --- Phase 3: GET /api/projects (list all projects in workspace) ---
    if (listProjects) {
      routes.push({
        path: "/api/projects",
        methods: ["GET"],
        handler: async (_req, res) => {
          try {
            const result = await listProjects(config.workspaceRoot);
            const activeProjectName = config.projectRootRef.current
              ? config.projectRootRef.current.split("/").pop() ?? null
              : null;
            sendSuccess(res, 200, {
              projects: result.projects.map((p) => ({
                ...p,
                isActive: p.name === activeProjectName,
              })),
              activeProject: activeProjectName,
            });
          } catch {
            sendInternalError(res);
          }
        },
      });
    }

    // --- Phase 3: POST /api/project/switch (switch active project) ---
    if (switchProject) {
      routes.push({
        path: "/api/project/switch",
        methods: ["POST"],
        handler: async (req, res) => {
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
          const parsed = SwitchProjectBodySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid switch body");
            return;
          }
          try {
            const result = await switchProject({
              workspaceRoot: config.workspaceRoot,
              project: parsed.data.project,
            });
            // Update the mutable project root ref
            config.projectRootRef.current = result.projectRoot;
            const project = await getReviewProject(result.projectRoot, repository);
            sendSuccess(res, 200, { project });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });
    }

    // --- Phase 3: DELETE /api/project (delete current active project) ---
    if (deleteProject) {
      routes.push({
        path: "/api/project",
        methods: ["DELETE"],
        handler: async (req, res) => {
          const currentRoot = config.projectRootRef.current;
          if (!currentRoot) {
            sendError(res, 404, "not_found", "No active project to delete");
            return;
          }
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
          const parsed = DeleteProjectBodySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid delete body");
            return;
          }
          try {
            await deleteProject({
              projectRoot: currentRoot,
              confirm: parsed.data.confirm,
            });
            // Clear the active project
            config.projectRootRef.current = null;
            sendSuccess(res, 200, { ok: true });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });
    }

    // Settings routes: only register when getSettings/saveSettings are wired (E1)
    if (getSettings && saveSettings) {
      // GET /api/settings (desensitized view, no plaintext keys)
      routes.push({
        path: "/api/settings",
        methods: ["GET"],
        handler: async (_req, res) => {
          try {
            const view = await getSettings();
            sendSuccess(res, 200, { settings: view });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });

      // PUT /api/settings (persist API keys to workspace .s2s/settings.json)
      routes.push({
        path: "/api/settings",
        methods: ["PUT"],
        handler: async (req, res) => {
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
          const parsed = SaveSettingsBodySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid settings body");
            return;
          }
          try {
            const view = await saveSettings(parsed.data);
            sendSuccess(res, 200, { settings: view });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });
    }

    // Project lifecycle routes: create / plan / search (whole-project)
    if (createProjectFromContent && planProject && searchProjectAssets) {
      // POST /api/project/create — create project from uploaded text content
      routes.push({
        path: "/api/project/create",
        methods: ["POST"],
        handler: async (req, res) => {
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
          const parsed = CreateProjectBodySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid project create body");
            return;
          }
          // Phase 3: derive projectDirectory from workspaceRoot + projectName
          const projectName = parsed.data.projectName ?? "default";
          if (!isValidProjectName(projectName)) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid project name");
            return;
          }
          const projectDirectory = `${config.workspaceRoot.replace(/\/+$/, "")}/${projectName}`;
          try {
            await createProjectFromContent({
              projectDirectory,
              content: new TextEncoder().encode(parsed.data.content),
              originalFileName: parsed.data.fileName ?? "script.md",
              title: parsed.data.title ?? "",
              language: parsed.data.language ?? "zh-CN",
              aspectRatio: parsed.data.aspectRatio ?? "9:16",
              style: parsed.data.style ?? "knowledge",
              intendedUse: parsed.data.intendedUse ?? "commercial_capable",
              willModify: parsed.data.willModify ?? true,
              force: parsed.data.force,
            });
            // Phase 3: set the new project as active
            config.projectRootRef.current = projectDirectory;
            const project = await getReviewProject(projectDirectory, repository);
            sendSuccess(res, 200, { project });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });

      // POST /api/project/plan — slice script into scenes via planner
      routes.push({
        path: "/api/project/plan",
        methods: ["POST"],
        handler: async (req, res) => {
          const projectRoot = requireProjectRoot(res);
          if (!projectRoot) return;

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
          const parsed = PlanProjectBodySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid plan body");
            return;
          }
          try {
            await planProject({
              projectRoot,
              provider: parsed.data.provider,
              maxScenes: parsed.data.maxScenes,
              force: parsed.data.force,
              dryRun: false,
            });
            const project = await getReviewProject(projectRoot, repository);
            sendSuccess(res, 200, { project });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });

      // POST /api/project/search — search assets for all scenes
      routes.push({
        path: "/api/project/search",
        methods: ["POST"],
        handler: async (req, res) => {
          const projectRoot = requireProjectRoot(res);
          if (!projectRoot) return;

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
          const parsed = SearchProjectBodySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid search body");
            return;
          }
          try {
            await searchProjectAssets({
              projectRoot,
              ...(parsed.data.providers !== undefined
                ? { providers: parsed.data.providers }
                : {}),
              maxAssetsPerQuery: parsed.data.limit,
              refresh: parsed.data.refresh,
            });
            const project = await getReviewProject(projectRoot, repository);
            sendSuccess(res, 200, { project });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });
    }

    // GET /api/project (returns current active project)
    routes.push({
      path: "/api/project",
      methods: ["GET"],
      handler: async (_req, res) => {
        const projectRoot = requireProjectRoot(res);
        if (!projectRoot) return;
        try {
          const project = await getReviewProject(projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapProjectLoadError(error, res);
        }
      },
    });

    // PATCH /api/scenes/:sceneId
    routes.push({
      path: "/api/scenes/:sceneId",
      methods: ["PATCH"],
      handler: async (req, res, params) => {
        const projectRoot = requireProjectRoot(res);
        if (!projectRoot) return;

        const sceneId = params.pathParams["sceneId"];
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

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

        const patchData = bodyResult.data;
        if (
          typeof patchData === "object" &&
          patchData !== null &&
          !Array.isArray(patchData) &&
          "visualPlan" in patchData &&
          typeof patchData["visualPlan"] === "object" &&
          patchData["visualPlan"] !== null &&
          !Array.isArray(patchData["visualPlan"]) &&
          Object.keys(patchData["visualPlan"]).length === 0
        ) {
          sendError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            "visualPlan patch must have at least one field",
          );
          return;
        }

        const useCaseInput = {
          projectRoot,
          sceneId: validSceneId,
          patch: bodyResult.data,
        };

        try {
          await updateScene(useCaseInput, { repository });
          const project = await getReviewProject(projectRoot, repository);
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
        const projectRoot = requireProjectRoot(res);
        if (!projectRoot) return;

        const sceneId = params.pathParams["sceneId"];
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

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

        const bodyParse = PutQueriesBodySchema.safeParse(bodyResult.data);
        if (!bodyParse.success) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
          return;
        }

        const useCaseInput = {
          projectRoot,
          sceneId: validSceneId,
          queries: bodyParse.data.queries,
        };

        try {
          await updateSceneQueries(useCaseInput, { repository });
          const project = await getReviewProject(projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // POST /api/scenes/:sceneId/search
    routes.push({
      path: "/api/scenes/:sceneId/search",
      methods: ["POST"],
      handler: async (req, res, params) => {
        const projectRoot = requireProjectRoot(res);
        if (!projectRoot) return;

        const sceneId = params.pathParams["sceneId"];
        const validSceneId = validateSceneId(sceneId ?? "");
        if (!validSceneId) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
          return;
        }

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

        const bodyParse = SearchBodySchema.safeParse(bodyResult.data);
        if (!bodyParse.success) {
          sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
          return;
        }

        const useCaseInput = {
          projectRoot,
          sceneId: validSceneId,
          ...(bodyParse.data.providers !== undefined
            ? { providers: bodyParse.data.providers }
            : {}),
          maxAssetsPerQuery: bodyParse.data.limit,
          refresh: bodyParse.data.refresh,
        };

        try {
          await searchSceneAssets(useCaseInput);
          const project = await getReviewProject(projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          mapMutationError(error, res);
        }
      },
    });

    // POST /api/scenes/:sceneId/generate (Phase 2: AI image generation)
    if (generateSceneImage) {
      routes.push({
        path: "/api/scenes/:sceneId/generate",
        methods: ["POST"],
        handler: async (req, res, params) => {
          const projectRoot = requireProjectRoot(res);
          if (!projectRoot) return;

          const sceneId = params.pathParams["sceneId"];
          const validSceneId = validateSceneId(sceneId ?? "");
          if (!validSceneId) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid scene ID");
            return;
          }

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

          const bodyParse = GenerateImageBodySchema.safeParse(bodyResult.data);
          if (!bodyParse.success) {
            sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid request body");
            return;
          }

          const useCaseInput = {
            projectRoot,
            sceneId: validSceneId,
            prompt: bodyParse.data.prompt,
            aspectRatio: bodyParse.data.aspectRatio,
          };

          try {
            await generateSceneImage(useCaseInput);
            const project = await getReviewProject(projectRoot, repository);
            sendSuccess(res, 200, { project });
          } catch (error) {
            mapMutationError(error, res);
          }
        },
      });
    }
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

  // ProjectAlreadyExistsError → 409 conflict (create with force=false)
  if (code === "project_already_exists") {
    sendError(res, 409, "conflict", "Project already exists", "Retry with force=true to overwrite");
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

  // Planner errors (LLM output quality: bad JSON, validation, anchor overlap)
  // → 422 so the frontend can show a retry-friendly message.
  if (
    code === "planner_error" ||
    code === "planner_output_error" ||
    code === "planner_validation_error"
  ) {
    sendError(
      res,
      422,
      "planner_error",
      "LLM 规划输出不符合要求",
      "请重试一键生成（LLM 输出有随机性），或换更清晰的文稿；持续失败可切换为 DeepSeek 提供方",
    );
    return;
  }

  // ProjectNotFoundError → 404
  if (code === "project_not_found") {
    sendError(res, 404, "not_found", "Project not found", "Ensure the project was created");
    return;
  }

  // InvalidArgumentError → 400 (e.g., bad project name for switch/delete, image gen failure)
  if (code === "invalid_argument") {
    const err = error as { message?: string; userHint?: string };
    sendError(res, 400, ERROR_INVALID_REQUEST, err.message ?? "Invalid request", err.userHint);
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