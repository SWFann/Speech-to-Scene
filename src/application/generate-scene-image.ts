/**
 * generateSceneImage use case.
 *
 * Generates an AI image for a single scene using an ImageGenerator provider
 * and appends the result as a `kind: "generated"` candidate to the scene's
 * search candidates.
 *
 * Design rules:
 * 1. Input is `unknown`; validated with a strict Zod schema before any work.
 * 2. Loads project via ProjectRepository.load() — never touches fs directly.
 * 3. Deep-clones the project before mutation.
 * 4. Calls the ImageGenerator port to produce an image.
 * 5. Constructs an AssetCandidateGenerated and appends it to scene.search.candidates.
 * 6. Updates scene.search.lastSearchedAt and project.updatedAt.
 * 7. Re-validates the full project with SpeechToSceneProjectSchema.
 * 8. Saves through repository.save() — exactly one save call.
 * 9. Does not modify other scenes or existing candidates.
 */

import { z } from "zod";

import type { ProjectRepository } from "./ports/project-repository.js";
import type { ImageGenerator } from "./ports/image-generator.js";
import type { GeneratedImageDownloader } from "./ports/generated-image-downloader.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import type { Scene } from "../domain/scene-schema.js";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";
import {
  ProjectNotPlannedError,
  SceneNotFoundError,
  ProjectValidationError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Input schema for generateSceneImage.
 *
 * `projectRoot` and `sceneId` are injected by the HTTP layer from the server
 * config and URL path — never from the request body.
 */
const GenerateSceneImageInputSchema = z.strictObject({
  projectRoot: z.string().min(1, "projectRoot 不能为空"),
  sceneId: IdSchema,
  prompt: NonEmptyTrimmedStringSchema.max(512, "prompt 不能超过 512 个字符"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
});

export type GenerateSceneImageInput = z.infer<typeof GenerateSceneImageInputSchema>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for generateSceneImage.
 */
export interface GenerateSceneImageDeps {
  readonly repository: ProjectRepository;
  readonly imageGenerator: ImageGenerator;
  /** Downloads generated images to the project's assets directory. */
  readonly imageDownloader: GeneratedImageDownloader;
  /** The review server port (for constructing local image URLs). */
  readonly serverPort: number;
  /** Generates a unique candidate ID. Injected for testability. */
  readonly generateId: () => string;
  /** Clock for deterministic timestamps. */
  readonly now: () => Date;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds a concise production prompt with subject, composition, visual
 * treatment, and negative constraints. StepFun accepts at most 512 chars.
 *
 * @param scene - The scene to build a prompt for.
 * @returns A prompt string suitable for text-to-image generation.
 */
export function buildGenerationPrompt(scene: Scene): string {
  const keywords = scene.visualPlan.visualKeywords
    .slice(0, 5)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .join(", ");
  const keywordClause = keywords ? `Key subjects: ${keywords}. ` : "";
  const prompt =
    `Create a polished 9:16 vertical editorial image for a short-form knowledge video. ` +
    `Scene: ${scene.summary.trim()}. ${keywordClause}` +
    `Clear single focal subject, natural action, realistic environment, strong foreground-background separation, ` +
    `cinematic natural light, credible details, mobile-safe composition. ` +
    `No text, subtitles, logos, watermarks, UI, collage, distorted hands, or duplicated objects.`;
  return prompt.slice(0, 512);
}

// ---------------------------------------------------------------------------
// Use case implementation
// ---------------------------------------------------------------------------

/**
 * Generates an AI image for a scene and appends it as a candidate.
 *
 * Flow:
 * 1. Validate input (unknown → typed).
 * 2. Load project through repository.
 * 3. Verify the project has been planned.
 * 4. Find the scene → SceneNotFoundError if not found.
 * 5. Call imageGenerator.generate() to produce an image.
 * 6. Construct an AssetCandidateGenerated candidate.
 * 7. Append to scene.search.candidates, update lastSearchedAt.
 * 8. Update project.updatedAt.
 * 9. Re-validate and save.
 *
 * @param input - Unknown input, validated with Zod before use.
 * @param deps - Repository, image generator, ID factory, and clock.
 * @returns The updated, validated SpeechToSceneProject.
 * @throws {z.ZodError} If input fails schema validation.
 * @throws {ProjectNotPlannedError} If the project has no generation or no scenes.
 * @throws {SceneNotFoundError} If the sceneId does not exist in the project.
 * @throws {ProjectValidationError} If the updated project fails schema validation.
 */
export async function generateSceneImage(
  input: unknown,
  deps: GenerateSceneImageDeps,
): Promise<SpeechToSceneProject> {
  // 1. Validate input
  const parsed: GenerateSceneImageInput = GenerateSceneImageInputSchema.parse(input);
  const { projectRoot, sceneId, prompt, aspectRatio } = parsed;

  // 2. Load project
  const project = await deps.repository.load(projectRoot);

  // 3. Check project is planned
  if (!project.generation || project.scenes.length === 0) {
    throw new ProjectNotPlannedError(projectRoot);
  }

  // 4. Find scene
  const sceneIndex = project.scenes.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) {
    throw new SceneNotFoundError(sceneId);
  }

  // 5. Generate image
  const result = await deps.imageGenerator.generate({ prompt, aspectRatio });

  // 5b. Persist the image before recording it; provider URLs may expire.
  const candidateId = deps.generateId();
  const localUrl = await deps.imageDownloader.download(
    projectRoot,
    result.imageUrl,
    candidateId,
    deps.serverPort,
  );

  // 6. Deep-clone the project for mutation
  const updated = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
  const scene = updated.scenes[sceneIndex]!;

  // Determine the matchedQueryId: use the first enabled query, or the first query
  const enabledQuery = scene.search.queries.find((q) => q.enabled) ?? scene.search.queries[0];
  const matchedQueryId = enabledQuery?.id ?? sceneId;

  // Compute the next rank (max existing rank + 1, or 1 if no candidates)
  const maxRank = scene.search.candidates.reduce((max, c) => Math.max(max, c.rank), 0);
  const rank = maxRank + 1;

  // 7. Construct the generated candidate
  const generatedCandidate = {
    kind: "generated" as const,
    id: candidateId,
    provider: result.providerSnapshot,
    prompt,
    imageUrl: localUrl,
    thumbnailUrl: localUrl,
    width: result.width,
    height: result.height,
    orientation:
      result.width > result.height
        ? ("landscape" as const)
        : result.width < result.height
          ? ("portrait" as const)
          : ("square" as const),
    model: result.model,
    generatedAt: deps.now().toISOString(),
    matchedQueryId,
    rank,
  };

  // Append to candidates
  scene.search.candidates.push(generatedCandidate);

  // Update lastSearchedAt
  scene.search.lastSearchedAt = deps.now().toISOString();

  // 8. Update project.updatedAt
  updated.project.updatedAt = deps.now().toISOString();

  // 9. Re-validate and save
  let validated: SpeechToSceneProject;
  try {
    validated = SpeechToSceneProjectSchema.parse(updated);
  } catch (error) {
    if (z.ZodError[Symbol.hasInstance](error)) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new ProjectValidationError(
        `Image generation produced invalid project: ${messages}`,
        "图片生成导致项目数据无效",
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }

  await deps.repository.save(projectRoot, validated);

  return validated;
}
