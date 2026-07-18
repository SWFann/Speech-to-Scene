/**
 * updateSceneQueries use case.
 *
 * Replaces a scene's search.queries array with a validated set of queries.
 *
 * Design rules:
 * 1. Input is `unknown`; validated with a strict Zod schema before any work.
 * 2. Loads project via ProjectRepository.load() — never touches fs directly.
 * 3. Deep-clones the project before mutation.
 * 4. Replaces scene.search.queries entirely (not append).
 * 5. Preserves scene.search.candidates — does not delete existing candidates.
 * 6. Preserves scene.search.lastSearchedAt — does not modify the timestamp.
 * 7. Query IDs must be unique within the new array.
 * 8. Candidates' matchedQueryId must reference a query in the new array.
 *    If not, schema validation will reject the project.
 * 9. Updates project.updatedAt.
 * 10. Re-validates the full project with SpeechToSceneProjectSchema.
 * 11. Saves through repository.save() — exactly one save call.
 * 12. Does not modify other scenes.
 *
 * Note: visualPlan.decision no longer gates search (Phase 1 redesign). A
 * stock_asset scene may have zero enabled queries.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";
import {
  ProjectValidationError,
  SceneNotFoundError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum length for query text.
 */
const MAX_QUERY_LENGTH = 500;

/**
 * Maximum length for query purpose.
 */
const MAX_PURPOSE_LENGTH = 200;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/**
 * Individual search query input.
 * Uses strictObject to reject unknown fields.
 */
const QueryInputSchema = z.strictObject({
  id: IdSchema,
  language: z.enum(["zh", "en"]),
  query: NonEmptyTrimmedStringSchema.refine(
    (s) => s.length <= MAX_QUERY_LENGTH,
    `query 最长 ${MAX_QUERY_LENGTH} 字符`,
  ),
  purpose: NonEmptyTrimmedStringSchema.refine(
    (s) => s.length <= MAX_PURPOSE_LENGTH,
    `purpose 最长 ${MAX_PURPOSE_LENGTH} 字符`,
  ),
  enabled: z.boolean(),
});

/**
 * Array of search queries with unique ID validation.
 */
const QueriesInputSchema = z.array(QueryInputSchema).superRefine((queries, ctx) => {
  const ids = new Set<string>();
  for (let i = 0; i < queries.length; i++) {
    const id = queries[i]!.id;
    if (ids.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, "id"],
        message: "query ID 必须唯一",
      });
    }
    ids.add(id);
  }
});

/**
 * Full input schema for updateSceneQueries.
 */
const UpdateSceneQueriesInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  queries: QueriesInputSchema,
});

/**
 * Parsed input type for updateSceneQueries.
 */
export type UpdateSceneQueriesInput = z.infer<typeof UpdateSceneQueriesInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for updateSceneQueries.
 */
export interface UpdateSceneQueriesDeps {
  readonly repository: ProjectRepository;
  /** Optional clock injection for deterministic timestamps. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Replaces a scene's search.queries with a validated array.
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository and optional clock.
 * @returns The updated, validated SpeechToSceneProject.
 * @throws {z.ZodError} If input fails schema validation (including duplicate IDs,
 *   empty query, empty purpose, invalid language).
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectValidationError} If the updated project fails schema validation.
 * @throws {ProjectValidationError} If the updated project fails schema validation
 *   (e.g. candidates reference removed query IDs).
 * @throws Whatever repository.load() or repository.save() throws (not swallowed).
 */
export async function updateSceneQueries(
  input: unknown,
  deps: UpdateSceneQueriesDeps,
): Promise<SpeechToSceneProject> {
  // 1. Validate input (unknown → typed)
  const parsed: UpdateSceneQueriesInput = UpdateSceneQueriesInputSchema.parse(input);
  const { projectRoot, sceneId, queries } = parsed;

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

  // 5. Replace queries (preserve candidates and lastSearchedAt)
  scene.search.queries = queries;

  // 6. Update project.updatedAt
  const now = deps.now?.() ?? new Date();
  updated.project.updatedAt = now.toISOString();

  // 7. Re-validate the full project with the top-level schema
  //    This catches cases like candidates referencing removed query IDs.
  let validated: SpeechToSceneProject;
  try {
    validated = SpeechToSceneProjectSchema.parse(updated);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Query update produced invalid project: ${messages}`,
        "查询更新导致项目数据无效",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  // 8. Save through repository — exactly one save call
  await deps.repository.save(projectRoot, validated);

  return validated;
}
