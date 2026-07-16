/**
 * skipScene use case.
 *
 * Marks a scene as "skipped" in the user's review decision. The scene's
 * search candidates are preserved as an audit chain.
 *
 * Design rules:
 * 1. Input is `unknown`; validated with a strict Zod schema before any work.
 * 2. Loads project via ProjectRepository.load() — never touches fs directly.
 * 3. Deep-clones the project before mutation (does not modify the repository's
 *    in-memory object).
 * 4. Sets `scene.review` to `{ kind: "skipped", decidedAt, note? }`.
 * 5. `decidedAt` is always persisted.
 * 6. `note` is optional; if provided, it is a bounded trimmed string.
 * 7. `search.candidates` is preserved — never cleared.
 * 8. Updates `project.updatedAt`.
 * 9. Re-validates the full project with SpeechToSceneProjectSchema.
 * 10. Saves through repository.save() — exactly one save call.
 * 11. Does not modify other scenes.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";
import { ProjectValidationError, SceneNotFoundError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum length for the skip note.
 */
const MAX_NOTE_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Bounded note schema for the skip endpoint.
 */
const BoundedNoteSchema = NonEmptyTrimmedStringSchema.refine(
  (s) => s.length <= MAX_NOTE_LENGTH,
  `note 最长 ${MAX_NOTE_LENGTH} 字符`,
);

/**
 * Full input schema for skipScene.
 *
 * `projectRoot` and `sceneId` are injected by the HTTP layer from server
 * config and URL path — never from the request body. `note` comes from
 * the validated request body and is optional.
 */
const SkipSceneInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  note: BoundedNoteSchema.optional(),
});

export type SkipSceneInput = z.infer<typeof SkipSceneInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for skipScene.
 */
export interface SkipSceneDeps {
  readonly repository: ProjectRepository;
  /** Optional clock injection for deterministic timestamps. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Marks a scene as skipped in the user's review decision.
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository and optional clock.
 * @returns The updated, validated SpeechToSceneProject.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectValidationError} If the updated project fails schema validation.
 * @throws Whatever repository.load() or repository.save() throws (not swallowed).
 */
export async function skipScene(
  input: unknown,
  deps: SkipSceneDeps,
): Promise<SpeechToSceneProject> {
  // 1. Validate input (unknown → typed)
  const parsed: SkipSceneInput = SkipSceneInputSchema.parse(input);
  const { projectRoot, sceneId, note } = parsed;

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

  // 5. Set review decision to skipped (preserve candidates — do not clear)
  const now = deps.now?.() ?? new Date();
  const nowIso = now.toISOString();
  scene.review =
    note !== undefined
      ? { kind: "skipped" as const, decidedAt: nowIso, note }
      : { kind: "skipped" as const, decidedAt: nowIso };

  // 6. Update project.updatedAt
  updated.project.updatedAt = nowIso;

  // 7. Re-validate the full project with the top-level schema
  let validated: SpeechToSceneProject;
  try {
    validated = SpeechToSceneProjectSchema.parse(updated);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Skip scene produced invalid project: ${messages}`,
        "跳过场景导致项目数据无效",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  // 8. Save through repository — exactly one save call
  await deps.repository.save(projectRoot, validated);

  return validated;
}
