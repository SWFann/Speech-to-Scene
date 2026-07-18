/**
 * planProject use case.
 *
 * Orchestrates the full project planning flow:
 * 1. Load project through repository.
 * 2. Read and verify source file hash.
 * 3. Build source blocks.
 * 4. Call selected planner.
 * 5. Parse and validate planner output with Zod.
 * 6. Resolve anchors locally (no trusting model offsets).
 * 7. Convert to persisted Scene[] and generation metadata.
 * 8. Save whole project atomically through repository.
 *
 * Dependencies are injected via ports for testability.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { Clock } from "./ports/clock.js";
import type { IdGenerator } from "./ports/id-generator.js";
import type { ProjectRepository } from "./ports/project-repository.js";
import type { ScriptPlanner } from "./ports/script-planner.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import {
  AppError,
  InvalidArgumentError,
  ProjectNotFoundError,
  ProjectAlreadyPlannedError,
  SourceDocumentError,
  PlannerError,
  PlannerOutputError,
  PlannerValidationError,
  ProjectWriteError,
} from "../shared/errors.js";
import { computeSha256, decodeSourceText } from "../infrastructure/source-document.js";
import { buildSourceBlocks } from "../planner/source-blocks.js";
import { resolveAnchors } from "../planner/anchor-resolver.js";
import {
  PlannerOutputSchema,
} from "../planner/planner-output-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for planning a project.
 */
export interface PlanProjectInput {
  projectRoot: string;
  provider: string;
  force: boolean;
  maxScenes: number;
  dryRun: boolean;
}

/**
 * Result of a successful project planning.
 */
export interface PlanProjectResult {
  projectId: string;
  title: string;
  status: "planned";
  sceneCount: number;
  provider: string;
  promptVersion: string;
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates CLI input parameters.
 */
function validateInput(input: PlanProjectInput): void {
  if (!input.projectRoot || input.projectRoot.trim() === "") {
    throw new InvalidArgumentError("Project directory is required", "请提供项目目录路径");
  }
}

/**
 * Reads the source file and verifies its hash matches the project record.
 */
async function readAndVerifySource(
  projectRoot: string,
  project: ReturnType<typeof SpeechToSceneProjectSchema.parse>,
): Promise<{ bytes: Uint8Array; text: string }> {
  const sourcePath = path.join(projectRoot, project.source.path);

  let bytes: Uint8Array;
  try {
    const handle = await fs.open(sourcePath, "r");
    try {
      const stats = await handle.stat();
      bytes = new Uint8Array(stats.size);
      await handle.read(bytes, 0, stats.size, 0);
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new SourceDocumentError(
      error instanceof Error ? error.message : "Failed to read source document",
      "无法读取文稿文件，请确认路径和权限",
      error instanceof Error ? error : undefined,
    );
  }

  // Verify SHA-256 matches
  const actualHash = computeSha256(bytes);
  if (actualHash !== project.source.sha256) {
    throw new SourceDocumentError("Source file hash mismatch", "文稿文件已修改，无法继续规划");
  }

  // Decode text
  const text = decodeSourceText(bytes);

  return { bytes, text };
}

/**
 * Checks whether a project can be planned (not already planned or has search data).
 */
function checkCanPlan(
  project: ReturnType<typeof SpeechToSceneProjectSchema.parse>,
  force: boolean,
): void {
  if (project.generation !== null) {
    if (!force) {
      throw new ProjectAlreadyPlannedError(project.project.id);
    }
    // With --force, check for existing search results
    const hasSearchResults = project.scenes.some((s) => s.search.candidates.length > 0);
    if (hasSearchResults) {
      throw new ProjectAlreadyPlannedError(project.project.id);
    }
  }
}

/**
 * Converts resolved scenes to persisted Scene objects.
 */
function convertToPersistedScenes(
  resolved: ReturnType<typeof resolveAnchors>,
  idGenerator: IdGenerator,
): Array<{
  id: string;
  order: number;
  sourceAnchor: {
    strategy: "source-blocks-v1";
    sourceBlockIds: string[];
    startQuote: string;
    endQuote: string;
  };
  sourceRange: { start: number; end: number };
  text: string;
  summary: string;
  narrativeRole: string;
  visualPlan: {
    decision: string;
    rationale: string;
    preferredMedia: string[];
    visualKeywords: string[];
  };
  search: {
    queries: Array<{
      id: string;
      language: "zh" | "en";
      query: string;
      purpose: string;
      enabled: boolean;
    }>;
    candidates: [];
  };
}> {
  return resolved.scenes.map((rs, index) => {
    const sceneId = idGenerator.sceneId();
    const queryIdPrefix = `q-${sceneId}`;

    const queries = rs.scene.queries.map((q, qi) => ({
      id: `${queryIdPrefix}-${qi}`,
      language: q.language,
      query: q.query,
      purpose: q.purpose,
      enabled: q.enabled,
    }));

    return {
      id: sceneId,
      order: index + 1,
      sourceAnchor: {
        strategy: rs.scene.sourceAnchor.strategy,
        sourceBlockIds: Array.from(rs.scene.sourceAnchor.sourceBlockIds),
        startQuote: rs.scene.sourceAnchor.startQuote,
        endQuote: rs.scene.sourceAnchor.endQuote,
      },
      sourceRange: rs.sourceRange,
      text: rs.text,
      summary: rs.scene.summary,
      narrativeRole: rs.scene.narrativeRole,
      visualPlan: {
        decision: rs.scene.visualPlan.decision,
        rationale: rs.scene.visualPlan.rationale,
        preferredMedia: Array.from(rs.scene.visualPlan.preferredMedia),
        visualKeywords: Array.from(rs.scene.visualPlan.visualKeywords),
      },
      search: {
        queries,
        candidates: [],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a plan for an existing project.
 *
 * @param input - User-provided parameters.
 * @param repository - Project repository.
 * @param planner - Script planner provider.
 * @param clock - Time source.
 * @param idGenerator - ID generator.
 * @returns Result with planning metadata.
 * @throws AppError on failure.
 */
export async function planProject(
  input: PlanProjectInput,
  repository: ProjectRepository,
  planner: ScriptPlanner,
  clock: Clock,
  idGenerator: IdGenerator,
): Promise<PlanProjectResult> {
  // Step 1: Validate input
  validateInput(input);

  // Step 2: Load project
  const resolvedProjectRoot = path.resolve(input.projectRoot);
  let project;
  try {
    project = await repository.load(resolvedProjectRoot);
  } catch (error) {
    // Let AppError subclasses (validation, version) propagate with their own codes
    if (error instanceof AppError) {
      throw error;
    }
    // I/O or other unexpected errors → ProjectNotFoundError
    throw new ProjectNotFoundError(input.projectRoot, error instanceof Error ? error : undefined);
  }

  // Step 3: Check if project can be planned
  checkCanPlan(project, input.force);

  // Step 4: Read and verify source file
  const { bytes, text } = await readAndVerifySource(resolvedProjectRoot, project);

  // Step 5: Build source blocks
  const sourceBlocks = buildSourceBlocks(bytes);

  // Step 6: Call planner
  const plannerInput = {
    rawText: text,
    sourceBlocks: sourceBlocks.blocks.map((b) => ({
      id: b.id,
      order: b.order,
      kind: b.kind,
      sourceRange: b.sourceRange,
    })),
    language: project.project.language,
    aspectRatio: project.project.aspectRatio,
    style: project.project.style,
    assetUsePolicy: {
      intendedUse: project.project.assetUsePolicy.intendedUse,
      willModify: project.project.assetUsePolicy.willModify,
    },
    maxScenes: input.maxScenes,
    promptVersion: "plan-script-v1",
  };

  let plannerResult;
  try {
    plannerResult = await planner.plan(plannerInput);
  } catch (error) {
    if (
      error instanceof PlannerError ||
      error instanceof PlannerOutputError ||
      error instanceof PlannerValidationError
    ) {
      throw error;
    }
    throw new PlannerError(
      error instanceof Error ? error.message : "Planner failed",
      "规划器执行失败，请稍后重试",
      error instanceof Error ? error : undefined,
    );
  }

  // Step 7: Parse and validate planner output
  let plannerOutput;
  try {
    plannerOutput = PlannerOutputSchema.parse(plannerResult.output);
  } catch (error) {
    if (error instanceof Error) {
      throw new PlannerValidationError(
        `Planner output validation failed: ${error.message}`,
        "Planner 输出不符合要求，请检查提示词",
      );
    }
    throw new PlannerValidationError("Planner output validation failed", "Planner 输出不符合要求");
  }

  // Enforce maxScenes limit
  if (plannerOutput.scenes.length > input.maxScenes) {
    throw new PlannerValidationError(
      `Planner returned ${plannerOutput.scenes.length} scenes, exceeding maxScenes of ${input.maxScenes}`,
      `场景数超出限制：planner 返回了 ${plannerOutput.scenes.length} 个场景，上限为 ${input.maxScenes}`,
    );
  }

  // Step 8: Resolve anchors
  let resolved;
  try {
    resolved = resolveAnchors(plannerOutput, sourceBlocks);
  } catch (error) {
    if (error instanceof Error) {
      throw new PlannerValidationError(
        `Anchor resolution failed: ${error.message}`,
        "场景锚点解析失败，请检查 planner 输出",
      );
    }
    throw new PlannerValidationError("Anchor resolution failed", "场景锚点解析失败");
  }

  // Step 9: Convert to persisted scenes
  const scenes = convertToPersistedScenes(resolved, idGenerator);

  // Step 10: Build generation metadata
  const now = clock.now();
  const generation = {
    plannerProvider: planner.providerId,
    apiProtocol: plannerResult.apiProtocol,
    model: plannerResult.model ?? "unknown",
    promptVersion: "plan-script-v1",
    plannerOutputSchemaVersion: "0.1",
    sourceBlockVersion: "0.1",
    generatedAt: now.toISOString(),
  };

  // Step 11: Build updated project
  const updatedProject = SpeechToSceneProjectSchema.parse({
    schemaVersion: project.schemaVersion,
    project: {
      ...project.project,
      updatedAt: now.toISOString(),
    },
    source: {
      ...project.source,
      blocks: sourceBlocks.blocks.map((b) => ({
        id: b.id,
        order: b.order,
        kind: b.kind,
        sourceRange: b.sourceRange,
      })),
    },
    generation,
    scenes,
  });

  // Step 12: Save (unless dry run)
  if (!input.dryRun) {
    try {
      await repository.save(resolvedProjectRoot, updatedProject);
    } catch (error) {
      throw new ProjectWriteError(
        error instanceof Error ? error.message : "Failed to save planned project",
        "保存规划结果失败，请检查磁盘空间和权限",
        error instanceof Error ? error : undefined,
      );
    }
  }

  return {
    projectId: project.project.id,
    title: project.project.title,
    status: "planned",
    sceneCount: scenes.length,
    provider: planner.providerId,
    promptVersion: "plan-script-v1",
    projectRoot: resolvedProjectRoot,
  };
}
