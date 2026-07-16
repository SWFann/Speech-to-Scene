/**
 * Project release validator.
 *
 * Read-only use case for `s2s validate`:
 * 1. Load the project through the repository, reusing schema and relation checks.
 * 2. Verify source and local asset files still exist.
 * 3. Verify stored SHA-256 hashes still match the files on disk.
 * 4. Emit release-readiness warnings for incomplete review/search state.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { AssetCandidate } from "../domain/asset-schema.js";
import type { LocalAsset, Scene } from "../domain/scene-schema.js";
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

function expectedOrientation(aspectRatio: string): AssetCandidate["orientation"] {
  if (aspectRatio === "16:9") return "landscape";
  if (aspectRatio === "1:1") return "square";
  return "portrait";
}

function collectLocalAsset(scene: Scene): LocalAsset | null {
  if (scene.review.kind === "candidate_selected") {
    return scene.review.localAsset ?? null;
  }
  if (scene.review.kind === "local_asset_attached") {
    return scene.review.localAsset;
  }
  return null;
}

function validateCandidateWarnings(
  scene: Scene,
  sceneIndex: number,
  projectAspectRatio: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const desiredOrientation = expectedOrientation(projectAspectRatio);

  for (let candidateIndex = 0; candidateIndex < scene.search.candidates.length; candidateIndex++) {
    const candidate = scene.search.candidates[candidateIndex]!;
    const candidatePath = `scenes[${sceneIndex}].search.candidates[${candidateIndex}]`;

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

function validateReviewState(scene: Scene, sceneIndex: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scenePath = `scenes[${sceneIndex}]`;

  if (scene.review.kind === "pending") {
    issues.push(
      makeIssue("warning", "scene_pending", "场景仍为 pending，尚未完成人工审阅", {
        path: `${scenePath}.review`,
        hint: "请在 Review Board 中选择素材、上传本地素材或跳过该场景。",
      }),
    );
  }

  if (scene.visualPlan.decision === "stock_asset" && scene.search.candidates.length === 0) {
    issues.push(
      makeIssue("warning", "stock_asset_no_candidates", "stock_asset 场景没有候选素材", {
        path: `${scenePath}.search.candidates`,
        hint: "运行 s2s search，或在 Review Board 中重新检索该场景。",
      }),
    );
  }

  if (scene.review.kind === "candidate_selected") {
    const selectedCandidateId = scene.review.selection.candidate.id;
    const candidateExists = scene.search.candidates.some(
      (candidate) => candidate.id === selectedCandidateId,
    );

    if (!candidateExists) {
      issues.push(
        makeIssue("error", "selected_candidate_missing", "已选择的候选素材不在当前候选列表中", {
          path: `${scenePath}.review.selection.candidate.id`,
          hint: "请重新检索并重新选择素材，或上传本地素材。",
        }),
      );
    }

    if (scene.review.localAsset === undefined) {
      issues.push(
        makeIssue(
          "warning",
          "selected_candidate_without_local_asset",
          "候选已选但尚未导入本地文件",
          {
            path: `${scenePath}.review.localAsset`,
            hint: "请下载候选素材后通过 Review Board 上传本地文件。",
          },
        ),
      );
    }
  }

  const localAsset = collectLocalAsset(scene);
  if (localAsset !== null && localAsset.provenance.kind !== "selected_candidate") {
    issues.push(
      makeIssue("warning", "local_asset_without_source_candidate", "本地文件缺少来源候选素材 ID", {
        path: `${scenePath}.review.localAsset.provenance`,
        hint: "若该素材来自搜索候选，请使用 selected_candidate provenance 重新上传。",
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

async function validateLocalAssetFile(
  projectRoot: string,
  sceneIndex: number,
  localAsset: LocalAsset,
): Promise<ValidationIssue[]> {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedAsset = path.resolve(resolvedRoot, localAsset.relativePath);
  const assetPath = `scenes[${sceneIndex}].review.localAsset`;

  if (!pathStartsWith(resolvedRoot, resolvedAsset)) {
    return [
      makeIssue("error", "local_asset_path_unsafe", "本地素材路径不在项目目录内", {
        path: `${assetPath}.relativePath`,
        hint: "请删除该素材记录并通过 Review Board 重新上传。",
      }),
    ];
  }

  if (!(await fileExists(resolvedAsset))) {
    return [
      makeIssue("error", "local_asset_missing", "localAsset 文件不存在", {
        path: `${assetPath}.relativePath`,
        hint: "请恢复素材文件，或通过 Review Board 重新上传。",
      }),
    ];
  }

  const actualSha256 = await sha256File(resolvedAsset);
  if (actualSha256 !== localAsset.sha256) {
    return [
      makeIssue("error", "local_asset_hash_mismatch", "localAsset Hash 与项目记录不匹配", {
        path: `${assetPath}.sha256`,
        hint: "素材文件可能被替换；请重新上传本地素材。",
      }),
    ];
  }

  return [];
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
    issues.push(...validateReviewState(scene, sceneIndex));
    issues.push(...validateCandidateWarnings(scene, sceneIndex, project.project.aspectRatio));

    const localAsset = collectLocalAsset(scene);
    if (localAsset !== null) {
      issues.push(...(await validateLocalAssetFile(projectRoot, sceneIndex, localAsset)));
    }
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
