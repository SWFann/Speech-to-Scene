/**
 * selectCandidate use case.
 *
 * Selects an asset candidate for a scene, persisting an immutable snapshot
 * of the selected candidate and recording the user's rights acknowledgement.
 *
 * Design rules:
 * 1. Input is `unknown`; validated with a strict Zod schema before any work.
 * 2. Loads project via ProjectRepository.load() — never touches fs directly.
 * 3. Deep-clones the project before mutation (does not modify the repository's
 *    in-memory object).
 * 4. The candidate must exist in the target scene's `search.candidates`.
 *    A candidate from a different scene cannot be selected.
 * 5. If the candidate's rights carry warnings (restrictions, unknown status,
 *    unclear/disallowed commercial use or derivatives, share-alike), the
 *    caller must set `rightsAcknowledged = true`.
 * 6. The full candidate snapshot is deep-copied into `review.selection.candidate`
 *    so subsequent candidate list changes do not invalidate the selection.
 * 7. `selectedAt` is persisted.
 * 8. If acknowledgement was required and provided, `rightsAcknowledgement`
 *    with `acknowledgedAt` and `warningCodes` is persisted.
 * 9. `search.candidates` is preserved — never deleted.
 * 10. Updates `project.updatedAt`.
 * 11. Re-validates the full project with SpeechToSceneProjectSchema.
 * 12. Saves through repository.save() — exactly one save call.
 * 13. Does not download remote media.
 * 14. Does not write local asset files.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { IdSchema } from "../domain/schema-primitives.js";
import type { AssetRights } from "../domain/asset-schema.js";
import type { AssetCandidate } from "../domain/asset-schema.js";
import {
  ProjectValidationError,
  SceneNotFoundError,
  ProjectConflictError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Full input schema for selectCandidate.
 *
 * `projectRoot` and `sceneId` are injected by the HTTP layer from server
 * config and URL path — never from the request body. `candidateId` and
 * `rightsAcknowledged` come from the validated request body.
 */
const SelectCandidateInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  candidateId: IdSchema,
  rightsAcknowledged: z.boolean(),
});

export type SelectCandidateInput = z.infer<typeof SelectCandidateInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for selectCandidate.
 */
export interface SelectCandidateDeps {
  readonly repository: ProjectRepository;
  /** Optional clock injection for deterministic timestamps. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Rights acknowledgement logic
// ---------------------------------------------------------------------------

/**
 * Collects rights warning codes for a candidate's rights.
 *
 * A warning is emitted when:
 * - `restrictions` array is non-empty.
 * - `status` is `unknown`.
 * - `commercialUse` is `unclear` or `disallowed`.
 * - `derivatives` is `unclear`, `disallowed`, or `share_alike`.
 *
 * If any warnings are present, `rightsAcknowledged = true` is required.
 *
 * Note: `no_known_copyright` and `editorial_only` statuses are implicitly
 * covered because the schema enforces that they cannot have
 * `commercialUse === "allowed"` or `derivatives === "allowed"`.
 */
export function collectRightsWarnings(rights: AssetRights): string[] {
  const warnings: string[] = [];

  if (rights.restrictions && rights.restrictions.length > 0) {
    warnings.push("restrictions_present");
  }
  if (rights.status === "unknown") {
    warnings.push("rights_unknown");
  }
  if (rights.commercialUse === "unclear") {
    warnings.push("commercial_use_unclear");
  }
  if (rights.commercialUse === "disallowed") {
    warnings.push("commercial_use_disallowed");
  }
  if (rights.derivatives === "unclear") {
    warnings.push("derivatives_unclear");
  }
  if (rights.derivatives === "disallowed") {
    warnings.push("derivatives_disallowed");
  }
  if (rights.derivatives === "share_alike") {
    warnings.push("derivatives_share_alike");
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Selects an asset candidate for a scene.
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository and optional clock.
 * @returns The updated, validated SpeechToSceneProject.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectConflictError} If the candidateId does not exist in the
 *   scene's search candidates, or if rights acknowledgement is required but
 *   not provided.
 * @throws {ProjectValidationError} If the updated project fails schema validation.
 * @throws Whatever repository.load() or repository.save() throws (not swallowed).
 */
export async function selectCandidate(
  input: unknown,
  deps: SelectCandidateDeps,
): Promise<SpeechToSceneProject> {
  // 1. Validate input (unknown → typed)
  const parsed: SelectCandidateInput = SelectCandidateInputSchema.parse(input);
  const { projectRoot, sceneId, candidateId, rightsAcknowledged } = parsed;

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

  // 5. Locate the candidate within THIS scene's search.candidates.
  //    This prevents selecting a candidate from a different scene.
  const candidate: AssetCandidate | undefined = scene.search.candidates.find(
    (c) => c.id === candidateId,
  );
  if (!candidate) {
    throw new ProjectConflictError(
      `Candidate not found: ${candidateId} in scene ${sceneId}`,
      "候选素材不存在于当前场景的搜索结果中",
    );
  }

  // 6. Check rights acknowledgement requirement
  const warnings = collectRightsWarnings(candidate.rights);
  if (warnings.length > 0 && !rightsAcknowledged) {
    throw new ProjectConflictError(
      "Rights acknowledgement required for this candidate",
      "该候选素材的权利状态需要确认后才能选择",
    );
  }

  // 7. Build the selection snapshot with a deep copy of the candidate
  const now = deps.now?.() ?? new Date();
  const nowIso = now.toISOString();
  const candidateSnapshot = JSON.parse(JSON.stringify(candidate)) as AssetCandidate;

  // 8. Set the review decision to candidate_selected
  scene.review =
    warnings.length > 0
      ? {
          kind: "candidate_selected" as const,
          selection: {
            selectedAt: nowIso,
            candidate: candidateSnapshot,
            rightsAcknowledgement: {
              acknowledgedAt: nowIso,
              warningCodes: warnings,
            },
          },
        }
      : {
          kind: "candidate_selected" as const,
          selection: {
            selectedAt: nowIso,
            candidate: candidateSnapshot,
          },
        };

  // 9. Update project.updatedAt
  updated.project.updatedAt = nowIso;

  // 10. Re-validate the full project with the top-level schema
  let validated: SpeechToSceneProject;
  try {
    validated = SpeechToSceneProjectSchema.parse(updated);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Candidate selection produced invalid project: ${messages}`,
        "候选素材选择导致项目数据无效",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  // 11. Save through repository — exactly one save call
  await deps.repository.save(projectRoot, validated);

  return validated;
}
