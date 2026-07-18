/**
 * Project release validator.
 *
 * Read-only use case for `s2s validate`:
 * 1. Load the project through the repository, reusing schema and relation checks.
 * 2. Verify source file still exists.
 * 3. Verify stored SHA-256 hash still matches the file on disk.
 * 4. Emit release-readiness warnings for incomplete search state.
 *
 * Phase 1 redesign: the review state machine and local-asset upload have been
 * removed. Validation now only checks source file integrity and candidate
 * metadata (asset-kind only; link-kind candidates have no creator/orientation).
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { AssetCandidate } from "../domain/asset-schema.js";
import type { Scene } from "../domain/scene-schema.js";
import { AppError, ProjectNotFoundError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
  hint?: string;
}

export interface ValidateProjectResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pathStartsWith(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function makeIssue(
  severity: ValidationSeverity,
  code: string,
  message: string,
  options: { path?: string; hint?: string } = {},
): ValidationIssue {
  return {
    severity,
    code,
    message,
    ...(options.path !== undefined ? { path: options.path } : {}),
    ...(options.hint !== undefined ? { hint: options.hint } : {}),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function expectedOrientation(aspectRatio: string): "portrait" | "landscape" | "square" {
  if (aspectRatio === "16:9") return "landscape";
  if (aspectRatio === "1:1") return "square";
  return "portrait";
}

/**
 * Validates asset-kind candidate metadata (creator, orientation).
 * Link-kind candidates are skipped — they have no image metadata.
 */
function validateCandidateWarnings(
  scene: Scene,
  sceneIndex: number,
  projectAspectRatio: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const desiredOrientation = expectedOrientation(projectAspectRatio);

  for (let candidateIndex = 0; candidateIndex < scene.search.candidates.length; candidateIndex++) {
    const candidate: AssetCandidate = scene.search.candidates[candidateIndex]!;
    const candidatePath = `scenes[${sceneIndex}].search.candidates[${candidateIndex}]`;

    // Only asset-kind candidates have creator/orientation metadata
    if (candidate.kind !== "asset") {
      continue;
    }

    if (candidate.creator.name === null || candidate.creator.name.trim() === "") {
      issues.push(
        makeIssue("warning", "candidate_missing_creator", "远程素材缺少作者或归属信息", {
          path: `${candidatePath}.creator.name`,
          hint: "发布前请人工确认素材来源和署名要求。",
        }),
      );
    }

    if (candidate.orientation !== desiredOrientation) {
      issues.push(
        makeIssue(
          "warning",
          "candidate_orientation_mismatch",
          `候选素材比例为 ${candidate.orientation}，与项目 ${projectAspectRatio} 不匹配`,
          {
            path: `${candidatePath}.orientation`,
            hint: "可重新检索或选择更适合项目画幅的素材。",
          },
        ),
      );
    }
  }

  return issues;
}

/**
 * Validates search state — emits a warning if a scene has no candidates.
 */
function validateSearchState(scene: Scene, sceneIndex: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scenePath = `scenes[${sceneIndex}]`;

  if (scene.search.candidates.length === 0) {
    issues.push(
      makeIssue("warning", "scene_no_candidates", "场景尚未搜索素材", {
        path: `${scenePath}.search.candidates`,
        hint: "在 Review Board 中点击「搜索素材」按钮检索该场景。",
      }),
    );
  }

  return issues;
}

async function validateSourceFile(
  projectRoot: string,
  sourcePath: string,
  expectedSha256: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedSource = path.resolve(resolvedRoot, sourcePath);

  if (!pathStartsWith(resolvedRoot, resolvedSource)) {
    return [
      makeIssue("error", "source_path_unsafe", "文稿路径不在项目目录内", {
        path: "source.path",
        hint: "请重新运行 s2s init 创建项目。",
      }),
    ];
  }

  if (!(await fileExists(resolvedSource))) {
    return [
      makeIssue("error", "source_missing", "文稿路径不存在", {
        path: "source.path",
        hint: "请恢复项目内的 script.md/script.txt，或重新初始化项目。",
      }),
    ];
  }

  const actualSha256 = await sha256File(resolvedSource);
  if (actualSha256 !== expectedSha256) {
    issues.push(
      makeIssue("error", "source_hash_mismatch", "文稿 Hash 与项目记录不匹配", {
        path: "source.sha256",
        hint: "文稿可能被手动修改；请重新运行 s2s init/plan，或恢复原始文稿。",
      }),
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function validateProject(
  projectRoot: string,
  repository: ProjectRepository,
): Promise<ValidateProjectResult> {
  const issues: ValidationIssue[] = [];

  let project;
  try {
    project = await repository.load(projectRoot);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      issues.push(
        makeIssue("error", "project_missing", "项目文件不存在", {
          hint: "请确认目录中存在 project.s2s.json，或先运行 s2s init。",
        }),
      );
    } else if (error instanceof AppError) {
      issues.push(
        makeIssue("error", "schema_invalid", "项目 Schema 无效", {
          hint: error.userHint,
        }),
      );
    } else {
      issues.push(
        makeIssue("error", "schema_invalid", "项目无法读取或验证", {
          hint: "请确认 project.s2s.json 是有效的 Speech-to-Scene 项目文件。",
        }),
      );
    }

    return summarize(issues);
  }

  issues.push(
    ...(await validateSourceFile(projectRoot, project.source.path, project.source.sha256)),
  );

  for (let sceneIndex = 0; sceneIndex < project.scenes.length; sceneIndex++) {
    const scene = project.scenes[sceneIndex]!;
    issues.push(...validateSearchState(scene, sceneIndex));
    issues.push(...validateCandidateWarnings(scene, sceneIndex, project.project.aspectRatio));
  }

  return summarize(issues);
}

function summarize(issues: ValidationIssue[]): ValidateProjectResult {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}
