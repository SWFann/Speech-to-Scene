/**
 * createProject use case.
 *
 * Orchestrates the full project initialization flow:
 * 1. Read-only pre-flight validation (no disk writes).
 * 2. Exclusive directory creation and file copy.
 * 3. Atomic project file commit.
 * 4. Cleanup on failure.
 *
 * Dependencies are injected via ports for testability.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { Clock } from "../application/ports/clock.js";
import type { IdGenerator } from "../application/ports/id-generator.js";
import type { ProjectRepository } from "../application/ports/project-repository.js";
import type { ProjectScaffolder } from "../application/ports/project-scaffolder.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import {
  InvalidArgumentError,
  SourceDocumentError,
  ProjectAlreadyExistsError,
  ProjectWriteError,
} from "../shared/errors.js";
import {
  validateSourcePath,
  readSourceBytes,
  computeSourceMeta,
  getScriptFileName,
} from "../infrastructure/source-document.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for creating a project.
 */
export interface CreateProjectInput {
  projectDirectory: string;
  scriptPath: string;
  title?: string;
  language: "zh-CN" | "en-US";
  aspectRatio: "9:16" | "16:9" | "1:1";
  style: "knowledge" | "story" | "commentary";
  intendedUse: "commercial_capable" | "noncommercial" | "editorial";
  willModify: boolean;
}

/**
 * Result of a successful project creation.
 */
export interface CreateProjectResult {
  projectId: string;
  title: string;
  status: "created";
  projectRoot: string;
  scriptPath: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates CLI input parameters.
 */
function validateInput(input: CreateProjectInput): void {
  if (!input.projectDirectory || input.projectDirectory.trim() === "") {
    throw new InvalidArgumentError("Project directory is required", "请提供项目目录路径");
  }
  if (!input.scriptPath || input.scriptPath.trim() === "") {
    throw new InvalidArgumentError("Script path is required", "请提供文稿文件路径");
  }
}

/**
 * Checks that the parent directory of projectRoot exists and is a directory.
 */
async function validateParentDirectory(projectRoot: string): Promise<void> {
  const resolved = path.resolve(projectRoot);
  const parent = path.dirname(resolved);

  try {
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) {
      throw new InvalidArgumentError("Parent path is not a directory", `父目录 ${parent} 不是目录`);
    }
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      throw error;
    }
    throw new InvalidArgumentError(
      "Parent directory does not exist",
      `父目录 ${parent} 不存在，请先创建`,
    );
  }
}

/**
 * Checks whether a project (complete or incomplete) already exists at the target.
 */
async function checkExistingProject(
  projectRoot: string,
  repository: ProjectRepository,
  scaffolder: ProjectScaffolder,
): Promise<void> {
  // Check for complete project
  if (await repository.exists(projectRoot)) {
    throw new ProjectAlreadyExistsError(projectRoot);
  }

  // Check for incomplete project (any sentinel, regardless of token)
  if (await scaffolder.hasAnySentinel(projectRoot)) {
    throw new ProjectAlreadyExistsError(
      projectRoot,
      new Error("Incomplete project: sentinel found without project file"),
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new Speech-to-Scene project.
 *
 * @param input - User-provided parameters.
 * @param clock - Time source.
 * @param idGenerator - ID generator.
 * @param repository - Project repository.
 * @param scaffolder - File system scaffolder.
 * @returns Result with project metadata.
 * @throws AppError on failure.
 */
export async function createProject(
  input: CreateProjectInput,
  clock: Clock,
  idGenerator: IdGenerator,
  repository: ProjectRepository,
  scaffolder: ProjectScaffolder,
): Promise<CreateProjectResult> {
  // Step 1: Validate input parameters (read-only)
  validateInput(input);

  // Step 2: Validate source document path (read-only)
  validateSourcePath(input.scriptPath);

  // Step 3: Read source bytes (read-only)
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await readSourceBytes(input.scriptPath);
  } catch (error) {
    throw new SourceDocumentError(
      error instanceof Error ? error.message : "Failed to read source document",
      "无法读取文稿文件，请确认路径和权限",
      error instanceof Error ? error : undefined,
    );
  }

  // Step 4: Compute metadata (read-only)
  const meta = computeSourceMeta(path.basename(input.scriptPath), sourceBytes);
  const scriptDestName = getScriptFileName(meta.originalFileName);
  const resolvedProjectRoot = path.resolve(input.projectDirectory);

  // Step 5: Validate project target (read-only)
  await validateParentDirectory(input.projectDirectory);

  // Step 6: Prepare sentinel token
  const sentinelToken = idGenerator.temporaryId();

  // Step 7: Check for existing/incomplete project (read-only)
  await checkExistingProject(resolvedProjectRoot, repository, scaffolder);

  // Step 8: Build the initial project object
  const now = clock.now();
  const createdAt = now.toISOString();
  const projectId = idGenerator.projectId();
  const title =
    input.title?.trim() || path.basename(input.scriptPath, path.extname(input.scriptPath));

  const initialProject = SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: projectId,
      title,
      createdAt,
      updatedAt: createdAt,
      language: input.language,
      aspectRatio: input.aspectRatio,
      style: input.style,
      assetUsePolicy: {
        intendedUse: input.intendedUse,
        willModify: input.willModify,
      },
    },
    source: {
      path: scriptDestName,
      originalFileName: meta.originalFileName,
      sha256: meta.sha256,
      encoding: "utf-8",
      sizeBytes: meta.sizeBytes,
      textLengthUtf16: meta.textLengthUtf16,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
  });

  // Step 9: Exclusive directory creation (first write)
  await scaffolder.createRoot(resolvedProjectRoot);

  // Step 10: Write sentinel
  await scaffolder.writeSentinel(resolvedProjectRoot, sentinelToken);

  try {
    // Step 11: Create subdirectories and copy source
    await scaffolder.createSubdirectories(resolvedProjectRoot);
    await scaffolder.copySourceDocument(resolvedProjectRoot, sourceBytes, meta.originalFileName);

    // Step 12: Write project file (atomic)
    await repository.create(resolvedProjectRoot, initialProject);

    // Step 13: Remove sentinel on success
    await scaffolder.removeSentinel(resolvedProjectRoot);

    return {
      projectId,
      title,
      status: "created",
      projectRoot: resolvedProjectRoot,
      scriptPath: path.join(resolvedProjectRoot, scriptDestName),
      createdAt,
    };
  } catch (error) {
    // Cleanup on failure: only remove if we own the directory
    const ownsDirectory = await scaffolder.checkSentinel(resolvedProjectRoot, sentinelToken);
    if (ownsDirectory) {
      try {
        await fs.rm(resolvedProjectRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; don't mask the original error
      }
    }
    throw new ProjectWriteError(
      error instanceof Error ? error.message : "Project creation failed",
      "项目创建失败，请检查磁盘空间和权限",
      error instanceof Error ? error : undefined,
    );
  }
}
