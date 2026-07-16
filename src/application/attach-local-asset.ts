/**
 * attachLocalAsset use case.
 *
 * Attaches a user-uploaded local image/video to a scene, writing the file
 * to the project's `assets/<scene-id>/` directory and updating the scene's
 * review state.
 *
 * Design rules:
 * 1. Input is `unknown`; validated with a strict Zod schema before any work.
 * 2. Loads project via ProjectRepository.load() — never touches fs directly.
 * 3. Deep-clones the project before mutation.
 * 4. Pre-flight conflict check: if scene.review.kind === "candidate_selected"
 *    and provenance.kind === "selected_candidate", verifies
 *    provenance.candidateId === scene.review.selection.candidate.id BEFORE
 *    any file write. This prevents orphan files on 409 conflict paths.
 * 5. Generates a server-controlled safe filename (never trusts client filename).
 * 6. Writes the file via the injected LocalAssetWriter port.
 * 7. Computes SHA-256 and sizeBytes from the file buffer.
 * 8. If scene.review.kind === "candidate_selected" and provenance.kind ===
 *    "selected_candidate":
 *    - Sets scene.review.localAsset (preserves existing selection).
 * 9. Otherwise, sets scene.review = { kind: "local_asset_attached", localAsset, note? }.
 * 10. Preserves search.candidates — never clears them.
 * 11. Updates project.updatedAt.
 * 12. Re-validates the full project with SpeechToSceneProjectSchema.
 * 13. Saves through repository.save() — exactly one save call.
 * 14. Does not modify other scenes.
 */

import { z } from "zod";
import crypto from "node:crypto";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { LocalAssetWriter } from "./ports/local-asset-writer.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";
import { AssetRightsSchema } from "../domain/asset-schema.js";
import { HttpsUrlSchema } from "../domain/schema-primitives.js";
import {
  ProjectValidationError,
  SceneNotFoundError,
  ProjectConflictError,
  PathSafetyError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum length for the review note.
 */
const MAX_NOTE_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Provenance input schema
// ---------------------------------------------------------------------------

/**
 * Provenance input schema for local asset attachment.
 *
 * Discriminated by `kind`:
 * - `selected_candidate`: asset was downloaded from a selected candidate.
 * - `user_owned`: asset was provided by the user.
 * - `external`: asset was imported from an external source with rights.
 */
const ProvenanceInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("selected_candidate"),
    candidateId: IdSchema,
  }),
  z.strictObject({
    kind: z.literal("user_owned"),
    note: NonEmptyTrimmedStringSchema.refine(
      (s) => s.length <= MAX_NOTE_LENGTH,
      `provenance note 最长 ${MAX_NOTE_LENGTH} 字符`,
    ).optional(),
  }),
  z.strictObject({
    kind: z.literal("external"),
    sourcePageUrl: HttpsUrlSchema.optional(),
    rights: AssetRightsSchema,
    note: NonEmptyTrimmedStringSchema.refine(
      (s) => s.length <= MAX_NOTE_LENGTH,
      `provenance note 最长 ${MAX_NOTE_LENGTH} 字符`,
    ).optional(),
  }),
]);

export type ProvenanceInput = z.infer<typeof ProvenanceInputSchema>;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Full input schema for attachLocalAsset.
 *
 * `projectRoot` and `sceneId` are injected by the HTTP layer from server
 * config and URL path — never from the request body.
 *
 * `fileBuffer` is the raw uploaded file content (validated for magic bytes
 * by the HTTP layer before reaching the use case).
 *
 * `originalFileName` is the client-provided filename (sanitized by safeFileName
 * before being passed here).
 *
 * `mimeType` and `extension` are derived from magic byte validation.
 *
 * `provenance` is the parsed JSON from the multipart form field (optional).
 *
 * `note` is an optional review-level note from the multipart form field.
 */
const AttachLocalAssetInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  fileBuffer: z.instanceof(Buffer),
  originalFileName: NonEmptyTrimmedStringSchema,
  mimeType: z.enum(["image/png", "image/jpeg"]),
  extension: z.enum([".png", ".jpg", ".jpeg"]),
  provenance: ProvenanceInputSchema.optional(),
  note: NonEmptyTrimmedStringSchema.refine(
    (s) => s.length <= MAX_NOTE_LENGTH,
    `note 最长 ${MAX_NOTE_LENGTH} 字符`,
  ).optional(),
});

export type AttachLocalAssetInput = z.infer<typeof AttachLocalAssetInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for attachLocalAsset.
 */
export interface AttachLocalAssetDeps {
  readonly repository: ProjectRepository;
  readonly assetWriter: LocalAssetWriter;
  /** Optional clock injection for deterministic timestamps. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Filename generation
// ---------------------------------------------------------------------------

/**
 * Generates a server-controlled safe filename.
 *
 * Format: `<16-char-hex>.<extension>`
 *
 * The filename is generated from cryptographically random bytes and the
 * server-validated extension. The client-provided filename is never used
 * for filesystem operations.
 */
function generateSafeFileName(extension: string): string {
  const random = crypto.randomBytes(16).toString("hex");
  return `${random}${extension}`;
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Attaches a local asset to a scene.
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository, asset writer, and optional clock.
 * @returns The updated, validated SpeechToSceneProject.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectConflictError} If provenance.kind is "selected_candidate"
 *   but the candidateId does not match the existing selection.
 * @throws {ProjectValidationError} If the updated project fails schema validation.
 * @throws Whatever repository.load(), assetWriter.writeAsset(), or
 *   repository.save() throws (not swallowed).
 */
export async function attachLocalAsset(
  input: unknown,
  deps: AttachLocalAssetDeps,
): Promise<SpeechToSceneProject> {
  // 1. Validate input (unknown → typed)
  const parsed: AttachLocalAssetInput = AttachLocalAssetInputSchema.parse(input);
  const { projectRoot, sceneId, fileBuffer, originalFileName, mimeType, extension } = parsed;

  // Default provenance to user_owned if not provided
  const provenance: ProvenanceInput = parsed.provenance ?? { kind: "user_owned" };
  const note = parsed.note;

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

  // 5. Pre-flight conflict check: if the scene already has a candidate_selected
  //    review and the provenance references a selected_candidate, verify the
  //    candidateId matches BEFORE writing any file to disk. This prevents
  //    orphan files on 409 conflict paths.
  if (scene.review.kind === "candidate_selected" && provenance.kind === "selected_candidate") {
    if (provenance.candidateId !== scene.review.selection.candidate.id) {
      throw new ProjectConflictError(
        `candidateId ${provenance.candidateId} does not match selection candidate ${scene.review.selection.candidate.id}`,
        "该素材的来源候选 ID 与当前选择不匹配",
      );
    }
  }

  // 6. Generate server-controlled safe filename
  const fileName = generateSafeFileName(extension);

  // 7. Write the file via the injected LocalAssetWriter port
  //    If the writer throws a path safety error, convert to PathSafetyError
  //    so the HTTP layer can map it to 400 invalid_request.
  let relativePath: string;
  try {
    const result = await deps.assetWriter.writeAsset(projectRoot, sceneId, fileName, fileBuffer);
    relativePath = result.relativePath;
  } catch (error) {
    if (error instanceof Error && error.name === "LocalAssetPathError") {
      throw new PathSafetyError(
        "Local asset path safety check failed",
        "上传文件路径不安全",
        error,
      );
    }
    throw error;
  }

  // 8. Compute SHA-256 and sizeBytes from the buffer
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const sizeBytes = fileBuffer.length;

  // 9. Build the LocalAsset object
  const now = deps.now?.() ?? new Date();
  const nowIso = now.toISOString();

  const localAsset = {
    relativePath,
    originalFileName,
    mimeType,
    sizeBytes,
    sha256,
    importedAt: nowIso,
    provenance,
  };

  // 10. Apply review state mutation
  //     (Conflict check already performed in step 5 — no file write on mismatch.)
  if (scene.review.kind === "candidate_selected" && provenance.kind === "selected_candidate") {
    // Attach localAsset to the existing candidate_selected review
    // Preserve the existing selection snapshot and note
    const existingReview = scene.review;
    scene.review = {
      kind: "candidate_selected" as const,
      selection: existingReview.selection,
      localAsset,
      ...(existingReview.note !== undefined ? { note: existingReview.note } : {}),
    };

    // If the form provides a note, update the review note
    if (note !== undefined) {
      (scene.review as { note?: string }).note = note;
    }
  } else {
    // For all other cases, set review to local_asset_attached
    scene.review =
      note !== undefined
        ? { kind: "local_asset_attached" as const, localAsset, note }
        : { kind: "local_asset_attached" as const, localAsset };
  }

  // 11. Update project.updatedAt
  updated.project.updatedAt = nowIso;

  // 12. Re-validate the full project with the top-level schema
  let validated: SpeechToSceneProject;
  try {
    validated = SpeechToSceneProjectSchema.parse(updated);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Local asset attachment produced invalid project: ${messages}`,
        "本地素材挂载导致项目数据无效",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  // 13. Save through repository — exactly one save call
  await deps.repository.save(projectRoot, validated);

  return validated;
}
