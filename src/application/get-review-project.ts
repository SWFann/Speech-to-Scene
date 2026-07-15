/**
 * getReviewProject use case.
 *
 * Pure read-only operation that loads a project and maps it into a
 * UI-safe ReviewProjectView DTO for the future React Review Board.
 *
 * Design rules:
 * 1. Loads project via ProjectRepository.load() — never touches fs directly.
 * 2. Returns a deep-mapped DTO, not the raw persisted object.
 * 3. Never returns absolute paths, tokens, API keys, or cache paths.
 * 4. Local asset paths remain as schema-validated project-relative paths.
 * 5. Remote URLs (thumbnail, preview, sourcePageUrl) are preserved as-is.
 * 6. Rights and evidence metadata are fully preserved.
 * 7. Derives per-scene and project-level status via pure domain functions.
 * 8. Output is deterministic — no Date.now(), no random ordering.
 * 9. Does not modify the repository's returned object (deep-clones via mapping).
 * 10. Does not call repository.save().
 */

import type { ProjectRepository } from "./ports/project-repository.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import type { Scene } from "../domain/scene-schema.js";
import type {
  AssetCandidate,
  AssetRights,
  AssetProviderSnapshot,
  RightsEvidence,
} from "../domain/asset-schema.js";
import type {
  ReviewDecision,
  LocalAsset,
  SelectedCandidateSnapshot,
} from "../domain/scene-schema.js";
import {
  getProjectStatus,
  type ProjectStatus,
  type SceneStatusValue,
} from "../domain/project-status.js";
import { safeFileName } from "./safe-filename.js";

// ---------------------------------------------------------------------------
// UI-safe DTO types
// ---------------------------------------------------------------------------

/**
 * UI-safe view of rights evidence.
 */
export interface ReviewRightsEvidenceView {
  readonly capturedAt: string;
  readonly referenceUrl: string;
  readonly fields: Record<string, string | number | boolean | null>;
}

/**
 * UI-safe view of asset rights.
 * All fields from the persisted rights are preserved.
 */
export interface ReviewAssetRightsView {
  readonly status: string;
  readonly licenseCode?: string;
  readonly licenseName?: string;
  readonly licenseUrl?: string;
  readonly attributionRequired: boolean;
  readonly attributionText?: string;
  readonly commercialUse: string;
  readonly derivatives: string;
  readonly restrictions?: string[];
  readonly rightsStatementUrl?: string;
  readonly verifiedAt: string;
  readonly evidence: ReviewRightsEvidenceView;
}

/**
 * UI-safe view of a provider snapshot.
 */
export interface ReviewProviderSnapshotView {
  readonly id: string;
  readonly name: string;
  readonly homepageUrl: string;
  readonly termsUrl: string;
  readonly policyRevision: string;
  readonly termsCheckedAt: string;
}

/**
 * UI-safe view of an asset candidate.
 * All remote URLs are preserved. No local paths are included.
 */
export interface ReviewAssetCandidateView {
  readonly id: string;
  readonly provider: ReviewProviderSnapshotView;
  readonly providerAssetId: string;
  readonly mediaType: "photo" | "video";
  readonly thumbnailUrl: string;
  readonly previewUrl?: string;
  readonly sourcePageUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds?: number;
  readonly orientation: "portrait" | "landscape" | "square";
  readonly creator: {
    readonly name: string | null;
    readonly profileUrl?: string;
  };
  readonly rights: ReviewAssetRightsView;
  readonly retrievedAt: string;
  readonly matchedQueryId: string;
  readonly rank: number;
}

/**
 * UI-safe view of a search query.
 */
export interface ReviewSearchQueryView {
  readonly id: string;
  readonly language: "zh" | "en";
  readonly query: string;
  readonly purpose: string;
  readonly enabled: boolean;
}

/**
 * UI-safe view of scene search state.
 */
export interface ReviewSceneSearchView {
  readonly queries: readonly ReviewSearchQueryView[];
  readonly candidates: readonly ReviewAssetCandidateView[];
  readonly lastSearchedAt?: string;
  /** Derived: number of enabled queries. */
  readonly enabledQueryCount: number;
  /** Derived: total candidate count. */
  readonly candidateCount: number;
}

/**
 * UI-safe view of a local asset.
 * `relativePath` is the schema-validated project-relative path (e.g., "assets/<scene-id>/file.png").
 * No absolute paths are ever returned.
 */
export interface ReviewLocalAssetView {
  readonly relativePath: string;
  readonly originalFileName: string | null;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly importedAt: string;
  readonly provenance:
    | { readonly kind: "selected_candidate"; readonly candidateId: string }
    | { readonly kind: "user_owned"; readonly note?: string }
    | {
        readonly kind: "external";
        readonly sourcePageUrl?: string;
        readonly rights: ReviewAssetRightsView;
        readonly note?: string;
      };
}

/**
 * UI-safe view of a selected candidate snapshot.
 */
export interface ReviewSelectedCandidateSnapshotView {
  readonly selectedAt: string;
  readonly candidate: ReviewAssetCandidateView;
  readonly rightsAcknowledgement?: {
    readonly acknowledgedAt: string;
    readonly warningCodes: string[];
  };
}

/**
 * UI-safe view of a review decision (discriminated union).
 */
export type ReviewDecisionView =
  | { readonly kind: "pending"; readonly note?: string }
  | { readonly kind: "skipped"; readonly decidedAt: string; readonly note?: string }
  | {
      readonly kind: "candidate_selected";
      readonly selection: ReviewSelectedCandidateSnapshotView;
      readonly localAsset?: ReviewLocalAssetView;
      readonly note?: string;
    }
  | {
      readonly kind: "local_asset_attached";
      readonly localAsset: ReviewLocalAssetView;
      readonly note?: string;
    };

/**
 * UI-safe view of a scene's visual plan.
 */
export interface ReviewVisualPlanView {
  readonly decision: string;
  readonly rationale: string;
  readonly preferredMedia: readonly ("photo" | "video")[];
  readonly visualKeywords: readonly string[];
}

/**
 * UI-safe view of a scene's source anchor.
 */
export interface ReviewSourceAnchorView {
  readonly strategy: "source-blocks-v1";
  readonly sourceBlockIds: readonly string[];
  readonly startQuote: string;
  readonly endQuote: string;
}

/**
 * UI-safe view of a single scene.
 */
export interface ReviewSceneView {
  readonly id: string;
  readonly order: number;
  readonly sourceAnchor: ReviewSourceAnchorView;
  readonly sourceRange: { readonly start: number; readonly end: number };
  readonly text: string;
  readonly summary: string;
  readonly narrativeRole: string;
  readonly visualPlan: ReviewVisualPlanView;
  readonly search: ReviewSceneSearchView;
  readonly review: ReviewDecisionView;
  /** Derived: scene review status. */
  readonly status: SceneStatusValue;
}

/**
 * UI-safe view of project source metadata.
 * `path` is the schema-validated relative file name (e.g., "script.md"), not an absolute path.
 */
export interface ReviewSourceView {
  readonly path: string;
  readonly originalFileName: string | null;
  readonly sha256: string;
  readonly encoding: string;
  readonly sizeBytes: number;
  readonly textLengthUtf16: number;
  readonly offsetUnit: string;
  readonly blockCount: number;
}

/**
 * UI-safe view of project metadata.
 */
export interface ReviewProjectMetaView {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly language: string;
  readonly aspectRatio: string;
  readonly style: string;
  readonly assetUsePolicy: {
    readonly intendedUse: string;
    readonly willModify: boolean;
  };
}

/**
 * UI-safe view of generation metadata.
 */
export interface ReviewGenerationView {
  readonly plannerProvider: string;
  readonly apiProtocol?: string;
  readonly model?: string;
  readonly promptVersion: string;
  readonly plannerOutputSchemaVersion: string;
  readonly sourceBlockVersion: string;
  readonly generatedAt: string;
}

/**
 * Top-level UI-safe project view DTO.
 * This is what GET /api/project will return as `project`.
 */
export interface ReviewProjectView {
  readonly schemaVersion: "0.1";
  readonly project: ReviewProjectMetaView;
  readonly source: ReviewSourceView;
  readonly generation: ReviewGenerationView | null;
  readonly scenes: readonly ReviewSceneView[];
  /** Derived: overall project status. */
  readonly status: "created" | "planned";
  /** Derived: total scene count. */
  readonly sceneCount: number;
  /** Derived: scenes with non-pending status. */
  readonly producingSceneCount: number;
  /** Derived: last generation timestamp, null if no generation. */
  readonly lastGenerationAt: string | null;
  /** Derived: per-scene status summary. */
  readonly sceneStatuses: readonly {
    readonly sceneId: string;
    readonly sceneOrder: number;
    readonly status: SceneStatusValue;
  }[];
}

// ---------------------------------------------------------------------------
// Pure mapping functions
// ---------------------------------------------------------------------------

function mapRightsEvidence(evidence: RightsEvidence): ReviewRightsEvidenceView {
  return {
    capturedAt: evidence.capturedAt,
    referenceUrl: evidence.referenceUrl,
    fields: { ...evidence.fields },
  };
}

function mapRights(rights: AssetRights): ReviewAssetRightsView {
  return {
    status: rights.status,
    attributionRequired: rights.attributionRequired,
    commercialUse: rights.commercialUse,
    derivatives: rights.derivatives,
    verifiedAt: rights.verifiedAt,
    evidence: mapRightsEvidence(rights.evidence),
    ...(rights.licenseCode !== undefined ? { licenseCode: rights.licenseCode } : {}),
    ...(rights.licenseName !== undefined ? { licenseName: rights.licenseName } : {}),
    ...(rights.licenseUrl !== undefined ? { licenseUrl: rights.licenseUrl } : {}),
    ...(rights.attributionText !== undefined ? { attributionText: rights.attributionText } : {}),
    ...(rights.restrictions !== undefined ? { restrictions: [...rights.restrictions] } : {}),
    ...(rights.rightsStatementUrl !== undefined
      ? { rightsStatementUrl: rights.rightsStatementUrl }
      : {}),
  };
}

function mapProviderSnapshot(provider: AssetProviderSnapshot): ReviewProviderSnapshotView {
  return {
    id: provider.id,
    name: provider.name,
    homepageUrl: provider.homepageUrl,
    termsUrl: provider.termsUrl,
    policyRevision: provider.policyRevision,
    termsCheckedAt: provider.termsCheckedAt,
  };
}

function mapCandidate(candidate: AssetCandidate): ReviewAssetCandidateView {
  return {
    id: candidate.id,
    provider: mapProviderSnapshot(candidate.provider),
    providerAssetId: candidate.providerAssetId,
    mediaType: candidate.mediaType,
    thumbnailUrl: candidate.thumbnailUrl,
    sourcePageUrl: candidate.sourcePageUrl,
    width: candidate.width,
    height: candidate.height,
    orientation: candidate.orientation,
    creator: {
      name: candidate.creator.name,
      ...(candidate.creator.profileUrl !== undefined
        ? { profileUrl: candidate.creator.profileUrl }
        : {}),
    },
    rights: mapRights(candidate.rights),
    retrievedAt: candidate.retrievedAt,
    matchedQueryId: candidate.matchedQueryId,
    rank: candidate.rank,
    ...(candidate.previewUrl !== undefined ? { previewUrl: candidate.previewUrl } : {}),
    ...(candidate.durationSeconds !== undefined
      ? { durationSeconds: candidate.durationSeconds }
      : {}),
  };
}

function mapQuery(query: {
  id: string;
  language: "zh" | "en";
  query: string;
  purpose: string;
  enabled: boolean;
}): ReviewSearchQueryView {
  return {
    id: query.id,
    language: query.language,
    query: query.query,
    purpose: query.purpose,
    enabled: query.enabled,
  };
}

function mapLocalAsset(asset: LocalAsset): ReviewLocalAssetView {
  const base: ReviewLocalAssetView = {
    relativePath: asset.relativePath,
    originalFileName: safeFileName(asset.originalFileName),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    importedAt: asset.importedAt,
    provenance: mapProvenance(asset),
  };
  return base;
}

function mapProvenance(asset: LocalAsset): ReviewLocalAssetView["provenance"] {
  switch (asset.provenance.kind) {
    case "selected_candidate":
      return { kind: "selected_candidate", candidateId: asset.provenance.candidateId };
    case "user_owned":
      return asset.provenance.note !== undefined
        ? { kind: "user_owned", note: asset.provenance.note }
        : { kind: "user_owned" };
    case "external": {
      return {
        kind: "external" as const,
        rights: mapRights(asset.provenance.rights),
        ...(asset.provenance.sourcePageUrl !== undefined
          ? { sourcePageUrl: asset.provenance.sourcePageUrl }
          : {}),
        ...(asset.provenance.note !== undefined ? { note: asset.provenance.note } : {}),
      };
    }
    default: {
      const _exhaustive: never = asset.provenance;
      return _exhaustive;
    }
  }
}

function mapSelectedSnapshot(
  snapshot: SelectedCandidateSnapshot,
): ReviewSelectedCandidateSnapshotView {
  const view: ReviewSelectedCandidateSnapshotView = {
    selectedAt: snapshot.selectedAt,
    candidate: mapCandidate(snapshot.candidate),
  };
  if (snapshot.rightsAcknowledgement !== undefined) {
    return {
      ...view,
      rightsAcknowledgement: {
        acknowledgedAt: snapshot.rightsAcknowledgement.acknowledgedAt,
        warningCodes: [...snapshot.rightsAcknowledgement.warningCodes],
      },
    };
  }
  return view;
}

function mapReviewDecision(review: ReviewDecision): ReviewDecisionView {
  switch (review.kind) {
    case "pending":
      return review.note !== undefined
        ? { kind: "pending", note: review.note }
        : { kind: "pending" };
    case "skipped":
      return review.note !== undefined
        ? { kind: "skipped", decidedAt: review.decidedAt, note: review.note }
        : { kind: "skipped", decidedAt: review.decidedAt };
    case "candidate_selected": {
      return {
        kind: "candidate_selected" as const,
        selection: mapSelectedSnapshot(review.selection),
        ...(review.localAsset !== undefined
          ? { localAsset: mapLocalAsset(review.localAsset) }
          : {}),
        ...(review.note !== undefined ? { note: review.note } : {}),
      };
    }
    case "local_asset_attached": {
      return {
        kind: "local_asset_attached" as const,
        localAsset: mapLocalAsset(review.localAsset),
        ...(review.note !== undefined ? { note: review.note } : {}),
      };
    }
    default: {
      const _exhaustive: never = review;
      return _exhaustive;
    }
  }
}

function mapScene(scene: Scene, status: SceneStatusValue): ReviewSceneView {
  const enabledQueryCount = scene.search.queries.filter((q) => q.enabled).length;
  return {
    id: scene.id,
    order: scene.order,
    sourceAnchor: {
      strategy: scene.sourceAnchor.strategy,
      sourceBlockIds: [...scene.sourceAnchor.sourceBlockIds],
      startQuote: scene.sourceAnchor.startQuote,
      endQuote: scene.sourceAnchor.endQuote,
    },
    sourceRange: { start: scene.sourceRange.start, end: scene.sourceRange.end },
    text: scene.text,
    summary: scene.summary,
    narrativeRole: scene.narrativeRole,
    visualPlan: {
      decision: scene.visualPlan.decision,
      rationale: scene.visualPlan.rationale,
      preferredMedia: [...scene.visualPlan.preferredMedia],
      visualKeywords: [...scene.visualPlan.visualKeywords],
    },
    search: {
      queries: scene.search.queries.map(mapQuery),
      candidates: scene.search.candidates.map(mapCandidate),
      ...(scene.search.lastSearchedAt !== undefined
        ? { lastSearchedAt: scene.search.lastSearchedAt }
        : {}),
      enabledQueryCount,
      candidateCount: scene.search.candidates.length,
    },
    review: mapReviewDecision(scene.review),
    status,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads a project and maps it into a UI-safe ReviewProjectView.
 *
 * @param projectRoot - Path to the project directory (fixed at server startup).
 * @param repository - Project repository implementation (dependency-injected).
 * @returns UI-safe project view DTO.
 * @throws Whatever errors repository.load() throws (ProjectNotFoundError, etc.).
 */
export async function getReviewProject(
  projectRoot: string,
  repository: ProjectRepository,
): Promise<ReviewProjectView> {
  // 1. Load project (validates schema, relations, version)
  const project: SpeechToSceneProject = await repository.load(projectRoot);

  // 2. Derive status using the pure domain function
  const status: ProjectStatus = getProjectStatus(project);

  // 3. Map scenes with derived per-scene status
  const sceneStatusMap = new Map<string, SceneStatusValue>();
  for (const ss of status.scenes) {
    sceneStatusMap.set(ss.sceneId, ss.status);
  }

  const scenes: ReviewSceneView[] = project.scenes.map((scene) =>
    mapScene(scene, sceneStatusMap.get(scene.id) ?? "pending"),
  );

  // 4. Build the top-level view
  return {
    schemaVersion: project.schemaVersion,
    project: {
      id: project.project.id,
      title: project.project.title,
      createdAt: project.project.createdAt,
      updatedAt: project.project.updatedAt,
      language: project.project.language,
      aspectRatio: project.project.aspectRatio,
      style: project.project.style,
      assetUsePolicy: {
        intendedUse: project.project.assetUsePolicy.intendedUse,
        willModify: project.project.assetUsePolicy.willModify,
      },
    },
    source: {
      path: project.source.path,
      originalFileName: safeFileName(project.source.originalFileName),
      sha256: project.source.sha256,
      encoding: project.source.encoding,
      sizeBytes: project.source.sizeBytes,
      textLengthUtf16: project.source.textLengthUtf16,
      offsetUnit: project.source.offsetUnit,
      blockCount: project.source.blocks.length,
    },
    generation:
      project.generation !== null
        ? {
            plannerProvider: project.generation.plannerProvider,
            ...(project.generation.apiProtocol !== undefined
              ? { apiProtocol: project.generation.apiProtocol }
              : {}),
            ...(project.generation.model !== undefined ? { model: project.generation.model } : {}),
            promptVersion: project.generation.promptVersion,
            plannerOutputSchemaVersion: project.generation.plannerOutputSchemaVersion,
            sourceBlockVersion: project.generation.sourceBlockVersion,
            generatedAt: project.generation.generatedAt,
          }
        : null,
    scenes,
    status: status.status,
    sceneCount: status.sceneCount,
    producingSceneCount: status.producingSceneCount,
    lastGenerationAt: status.lastGenerationAt,
    sceneStatuses: status.scenes.map((ss) => ({
      sceneId: ss.sceneId,
      sceneOrder: ss.sceneOrder,
      status: ss.status,
    })),
  };
}
