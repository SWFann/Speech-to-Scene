/**
 * createProjectFromContent use case.
 *
 * Like createProject, but accepts in-memory content bytes instead of a file
 * path. Used by the frontend "upload script" flow (POST /api/project/create).
 * The HTTP layer never exposes filesystem paths to the browser.
 *
 * Reuses computeSourceMeta, ProjectScaffolder, and repository.create — the
 * same building blocks as createProject, minus the file-path read step.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { Clock } from "./ports/clock.js";
import type { IdGenerator } from "./ports/id-generator.js";
import type { ProjectRepository } from "./ports/project-repository.js";
import type { ProjectScaffolder } from "./ports/project-scaffolder.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import {
  InvalidArgumentError,
  SourceDocumentError,
  ProjectAlreadyExistsError,
  ProjectWriteError,
} from "../shared/errors.js";
import { computeSourceMeta, getScriptFileName } from "../infrastructure/source-document.js";

export interface CreateProjectFromContentInput {
  readonly projectDirectory: string;
  readonly content: Uint8Array;
  readonly originalFileName: string;
  readonly title: string;
  readonly language: "zh-CN" | "en-US";
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly style: "knowledge" | "story" | "commentary";
  readonly intendedUse: "commercial_capable" | "noncommercial" | "editorial";
  readonly willModify: boolean;
}

export type CreateProjectFromContentResult = {
  readonly projectId: string;
  readonly title: string;
  readonly status: "created";
  readonly projectRoot: string;
  readonly scriptPath: string;
  readonly createdAt: string;
};

export async function createProjectFromContent(
  input: CreateProjectFromContentInput,
  clock: Clock,
  idGenerator: IdGenerator,
  repository: ProjectRepository,
  scaffolder: ProjectScaffolder,
): Promise<CreateProjectFromContentResult> {
  if (!input.projectDirectory?.trim()) {
    throw new InvalidArgumentError("Project directory is required", "请提供项目目录路径");
  }
  if (!input.originalFileName?.trim()) {
    throw new InvalidArgumentError("Original file name is required", "请提供文稿文件名");
  }
  if (input.content.length === 0) {
    throw new SourceDocumentError("Content is empty", "文稿内容为空");
  }

  const sourceBytes = input.content;
  const meta = computeSourceMeta(input.originalFileName, sourceBytes);
  const scriptDestName = getScriptFileName(meta.originalFileName);
  const resolvedProjectRoot = path.resolve(input.projectDirectory);

  const now = clock.now();
  const createdAt = now.toISOString();
  const projectId = idGenerator.projectId();
  const title =
    input.title?.trim() ||
    path.basename(input.originalFileName, path.extname(input.originalFileName));
  const sentinelToken = idGenerator.temporaryId();

  if (await repository.exists(resolvedProjectRoot)) {
    throw new ProjectAlreadyExistsError(resolvedProjectRoot);
  }

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
      assetUsePolicy: { intendedUse: input.intendedUse, willModify: input.willModify },
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

  await scaffolder.createRoot(resolvedProjectRoot);
  await scaffolder.writeSentinel(resolvedProjectRoot, sentinelToken);
  try {
    await scaffolder.createSubdirectories(resolvedProjectRoot);
    await scaffolder.copySourceDocument(resolvedProjectRoot, sourceBytes, meta.originalFileName);
    await repository.create(resolvedProjectRoot, initialProject);
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
    const owns = await scaffolder.checkSentinel(resolvedProjectRoot, sentinelToken);
    if (owns) {
      try {
        await fs.rm(resolvedProjectRoot, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    throw new ProjectWriteError(
      error instanceof Error ? error.message : "Project creation failed",
      "项目创建失败",
      error instanceof Error ? error : undefined,
    );
  }
}
