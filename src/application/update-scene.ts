/**
 * updateScene use case.
 *
 * Partially updates a scene's visualPlan fields.
 *
 * Design rules:
 * 1. Input is `unknown`; validated with a strict Zod schema before any work.
 * 2. Loads project via ProjectRepository.load() — never touches fs directly.
 * 3. Deep-clones the project before mutation (does not modify the repository's
 *    in-memory object).
 * 4. Only the following fields may be updated:
 *    - scene.visualPlan.decision
 *    - scene.visualPlan.rationale
 *    - scene.visualPlan.preferredMedia
 *    - scene.visualPlan.visualKeywords
 * 5. visualPlan patch is merged, not overwritten — omitted fields are preserved.
 * 6. Updates project.updatedAt.
 * 7. Re-validates the full project with SpeechToSceneProjectSchema.
 * 8. Saves through repository.save() — exactly one save call.
 * 9. Does not modify scene order, sourceAnchor, sourceRange, text, search,
 *     or candidates.
 * 10. Does not modify other scenes.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";
import { VisualDecisionSchema } from "../domain/scene-schema.js";
import {
  ProjectValidationError,
  SceneNotFoundError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum length for user-editable text fields (rationale, note).
 * The domain schema does not impose a length limit on these fields; this
 * use case enforces 2000 characters to prevent unbounded growth.
 */
const MAX_TEXT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/**
 * Non-empty trimmed string with a maximum length.
 * Used for user-editable text fields (rationale, note).
 */
const BoundedTextSchema = NonEmptyTrimmedStringSchema.refine(
  (s) => s.length <= MAX_TEXT_LENGTH,
  `文本最长 ${MAX_TEXT_LENGTH} 字符`,
);

/**
 * Partial visual plan patch. All fields optional; only provided fields are
 * merged into the existing visualPlan.
 */
const VisualPlanPatchSchema = z.strictObject({
  decision: VisualDecisionSchema.optional(),
  rationale: BoundedTextSchema.optional(),
  preferredMedia: z
    .array(z.enum(["photo", "video"]))
    .min(1, "至少需要一个 preferred media")
    .optional(),
  visualKeywords: z
    .array(NonEmptyTrimmedStringSchema)
    .min(1, "至少需要一个 visual keyword")
    .optional(),
});

/**
 * Patch for a scene update. `visualPlan` must be present.
 *
 * - `visualPlan`: partial merge into the existing visualPlan.
 */
const ScenePatchSchema = z
  .strictObject({
    visualPlan: VisualPlanPatchSchema.optional(),
  })
  .refine((patch) => patch.visualPlan !== undefined, {
    message: "patch 必须包含 visualPlan",
  });

/**
 * Full input schema for updateScene.
 */
const UpdateSceneInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  patch: ScenePatchSchema,
});

/**
 * Parsed input type for updateScene.
 */
export type UpdateSceneInput = z.infer<typeof UpdateSceneInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for updateScene.
 */
export interface UpdateSceneDeps {
  readonly repository: ProjectRepository;
  /** Optional clock injection for deterministic timestamps. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Partially updates a scene's visualPlan.
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository and optional clock.
 * @returns The updated, validated SpeechToSceneProject.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectValidationError} If the updated project fails schema validation.
 * @throws Whatever repository.load() or repository.save() throws (not swallowed).
 */
export async function updateScene(
  input: unknown,
  deps: UpdateSceneDeps,
): Promise<SpeechToSceneProject> {
  // 1. Validate input (unknown → typed)
  const parsed: UpdateSceneInput = UpdateSceneInputSchema.parse(input);
  const { projectRoot, sceneId, patch } = parsed;

  // 2. Load project through repository — errors propagate unchanged
  const project = await deps.repository.load(projectRoot);

  // 3. Deep-clone the project so we never mutate the repository's object
  const updated = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;

  // 4. Locate the scene
  const sceneIndex = updated.scenes.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) {
    throw new SceneNotFoundError(sceneId);
  }
  const scene = updated.scenes[sceneIndex]!;

  // 5. Apply visualPlan patch (merge — only provided fields are overwritten)
  if (patch.visualPlan !== undefined) {
    scene.visualPlan = {
      ...scene.visualPlan,
      ...patch.visualPlan,
    } as typeof scene.visualPlan;
  }

  // 6. Update project.updatedAt
  const now = deps.now?.() ?? new Date();
  updated.project.updatedAt = now.toISOString();

  // 7. Re-validate the full project with the top-level schema
  let validated: SpeechToSceneProject;
  try {
    validated = SpeechToSceneProjectSchema.parse(updated);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Scene update produced invalid project: ${messages}`,
        "场景更新导致项目数据无效",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  // 8. Save through repository — exactly one save call
  await deps.repository.save(projectRoot, validated);

  return validated;
}
