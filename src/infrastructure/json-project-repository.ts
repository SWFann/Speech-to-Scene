/**
 * JSON file-based implementation of ProjectRepository.
 *
 * Persists projects as `project.s2s.json` in the project root directory.
 * Enforces:
 * - Atomic writes via `atomicWrite`.
 * - Size limits before parsing.
 * - Full schema validation on load, create, and save.
 * - Path safety: rejects symlinks, absolute paths, traversal.
 * - Version dispatch for unknown schema versions.
 *
 * This is the only Repository implementation in M1.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { SpeechToSceneProject } from "../domain/project-schema.js";
import type { ProjectRepository } from "../application/ports/project-repository.js";
import {
  PROJECT_FILE_NAME,
  MAX_PROJECT_FILE_BYTES,
  CURRENT_SCHEMA_VERSION,
} from "../shared/constants.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import {
  UnsupportedSchemaVersionError,
  ProjectValidationError,
  ProjectFileTooLargeError,
  SourceDocumentError,
  ProjectNotFoundError,
} from "../shared/errors.js";
import { hasPathTraversal } from "./project-paths.js";
import { atomicWrite } from "./atomic-write.js";
import { validateProjectRelations } from "../domain/project-validation.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the project file path.
 */
function projectFilePath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_FILE_NAME);
}

/**
 * Validates that a project root is safe to access.
 */
function validateProjectRoot(projectRoot: string): void {
  if (hasPathTraversal(projectRoot)) {
    throw new Error("Project root contains path traversal");
  }
}

/**
 * Validates a project object (schema + relations).
 */
function validateProject(project: unknown): SpeechToSceneProject {
  let parsed: SpeechToSceneProject;
  try {
    parsed = SpeechToSceneProjectSchema.parse(project);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Project validation failed: ${messages}`,
        "project.s2s.json 内容不符合协议要求，请检查字段",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  const relationIssues = validateProjectRelations(parsed);
  if (relationIssues.length > 0) {
    const messages = relationIssues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new ProjectValidationError(
      `Project relation validation failed: ${messages}`,
      "project.s2s.json 项目关系验证失败，请检查场景与 blocks 的关联",
    );
  }

  return parsed;
}

/**
 * Parses raw JSON bytes into a validated project.
 *
 * Checks size, parses JSON, dispatches schema version, runs full Zod parse,
 * and validates cross-field relations.
 */
function parseAndValidateProject(bytes: Uint8Array): SpeechToSceneProject {
  // Size check
  if (bytes.length > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileTooLargeError(bytes.length, MAX_PROJECT_FILE_BYTES);
  }

  // JSON parse
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch (error) {
    throw new SourceDocumentError(
      "Invalid JSON in project file",
      "project.s2s.json 文件格式错误，请检查 JSON 语法",
      error instanceof Error ? error : undefined,
    );
  }

  // Top-level object check
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SourceDocumentError(
      "Project root is not a JSON object",
      "project.s2s.json 顶层必须是 JSON object",
    );
  }

  // Schema version dispatch
  const schemaVersion = (raw as { schemaVersion?: string }).schemaVersion;
  if (typeof schemaVersion !== "string") {
    throw new UnsupportedSchemaVersionError("(missing)");
  }
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(schemaVersion);
  }

  // Phase 1 migration: strip legacy review/localAsset fields and add kind to
  // old candidates before schema validation. This lets existing project files
  // (created before the material-discovery redesign) continue to load.
  const migrated = migrateLegacyProject(raw);

  return validateProject(migrated);
}

/**
 * Migrates a legacy project object to the Phase 1 schema shape before Zod
 * validation:
 * 1. Removes `review` from each scene (review state machine removed).
 * 2. Removes any `localAsset` references.
 * 3. Adds `kind: "asset"` to candidates missing the discriminator (old
 *    candidates predate the discriminated union).
 *
 * This is a best-effort, additive-only transform. Unknown extra keys are
 * ignored by `.strictObject()` during validation (stripped on save).
 */
function migrateLegacyProject(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const obj = raw as Record<string, unknown>;
  const scenes = obj.scenes as unknown[];
  if (!Array.isArray(scenes)) {
    return raw;
  }

  const migratedScenes = scenes.map((scene: unknown) => {
    if (typeof scene !== "object" || scene === null || Array.isArray(scene)) {
      return scene;
    }
    const s = { ...scene } as Record<string, unknown>;
    // Remove legacy review field
    delete s["review"];
    // Normalize candidates: add kind: "asset" to any missing the discriminator
    const search = s.search;
    if (typeof search === "object" && search !== null && !Array.isArray(search)) {
      const searchObj = { ...(search as Record<string, unknown>) };
      const candidates = searchObj.candidates;
      if (Array.isArray(candidates)) {
        searchObj.candidates = candidates.map((candidate: unknown) => {
          if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
            return candidate;
          }
          const c = candidate as Record<string, unknown>;
          if (c.kind === undefined) {
            return { ...c, kind: "asset" };
          }
          return c;
        });
      }
      s.search = searchObj;
    }
    return s;
  });

  return { ...obj, scenes: migratedScenes };
}

// ---------------------------------------------------------------------------
// JsonProjectRepository
// ---------------------------------------------------------------------------

/**
 * JSON file-based project repository.
 *
 * All file paths are resolved and validated against path traversal before
 * any I/O is performed.
 */
export class JsonProjectRepository implements ProjectRepository {
  /**
   * Check if a project exists by looking for the project file.
   */
  async exists(projectRoot: string): Promise<boolean> {
    validateProjectRoot(projectRoot);
    const fp = projectFilePath(projectRoot);
    try {
      const stat = await fs.stat(fp);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Create a new project atomically.
   *
   * The project is serialized, written to a temp file, and atomically renamed.
   */
  async create(projectRoot: string, project: unknown): Promise<void> {
    validateProjectRoot(projectRoot);

    // Re-validate with relations before writing
    const validated = validateProject(project);

    const fp = projectFilePath(projectRoot);

    // No-clobber check
    try {
      await fs.access(fp);
      // File exists - check if it's actually a project file
      const stat = await fs.stat(fp);
      if (stat.isFile()) {
        throw new Error("Project already exists");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Project already exists") {
        throw error;
      }
      // ENOENT is expected - project doesn't exist yet
    }

    const json = JSON.stringify(validated, null, 2) + "\n";
    const bytes = new TextEncoder().encode(json);

    await atomicWrite(fp, bytes, "project.s2s.json");
  }

  /**
   * Load and fully validate an existing project.
   */
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    validateProjectRoot(projectRoot);

    // Check root exists and is a directory
    try {
      const stat = await fs.stat(projectRoot);
      if (!stat.isDirectory()) {
        throw new ProjectNotFoundError(projectRoot);
      }
    } catch (error) {
      if (error instanceof ProjectNotFoundError) throw error;
      throw new ProjectNotFoundError(projectRoot);
    }

    const fp = projectFilePath(projectRoot);
    try {
      await fs.access(fp);
    } catch {
      throw new ProjectNotFoundError(projectRoot);
    }

    const bytes = new Uint8Array(await fs.readFile(fp));
    return parseAndValidateProject(bytes);
  }

  /**
   * Save (overwrite) an existing project atomically.
   */
  async save(projectRoot: string, project: unknown): Promise<void> {
    validateProjectRoot(projectRoot);

    // Ensure project exists
    if (!(await this.exists(projectRoot))) {
      throw new Error("Project does not exist");
    }

    // Re-validate with relations before writing
    const validated = validateProject(project);

    const fp = projectFilePath(projectRoot);
    const json = JSON.stringify(validated, null, 2) + "\n";
    const bytes = new TextEncoder().encode(json);

    await atomicWrite(fp, bytes, "project.s2s.json");
  }
}
