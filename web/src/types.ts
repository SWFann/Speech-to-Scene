/**
 * Type definitions matching the GET /api/project response.
 *
 * These types mirror the ReviewProjectView DTO from
 * src/application/get-review-project.ts but are declared independently
 * in the web app to avoid importing backend code.
 *
 * Phase 1 material-discovery redesign:
 * - AssetCandidate is a discriminated union (asset | link).
 * - The review state machine (selection/skip/local-asset) has been removed.
 * - Scene status reflects search progress only (pending | candidates_ready).
 */

export interface ReviewProviderSnapshotView {
  readonly id: string;
  readonly name: string;
  readonly homepageUrl: string;
  readonly termsUrl: string;
  readonly policyRevision: string;
  readonly termsCheckedAt: string;
}

export interface ReviewRightsEvidenceView {
  readonly capturedAt: string;
  readonly referenceUrl: string;
  readonly fields: Record<string, string | number | boolean | null>;
}

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
 * Asset-kind candidate (a library result with thumbnail/rights/dimensions).
 */
export interface ReviewAssetCandidateAssetView {
  readonly kind: "asset";
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
 * Link-kind candidate (a "search link card" for platforms without an API).
 */
export interface ReviewAssetCandidateLinkView {
  readonly kind: "link";
  readonly id: string;
  readonly platform: "xiaohongshu" | "douyin" | "bilibili" | "youtube";
  readonly searchUrl: string;
  readonly keyword: string;
  readonly retrievedAt: string;
  readonly matchedQueryId: string;
  readonly rank: number;
}

/**
 * Generated-kind candidate (an AI-generated image).
 */
export interface ReviewAssetCandidateGeneratedView {
  readonly kind: "generated";
  readonly id: string;
  readonly provider: ReviewProviderSnapshotView;
  readonly prompt: string;
  readonly imageUrl: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly orientation: "portrait" | "landscape" | "square";
  readonly model: string;
  readonly generatedAt: string;
  readonly matchedQueryId: string;
  readonly rank: number;
}

/**
 * Asset candidate (discriminated union on `kind`).
 */
export type ReviewAssetCandidateView =
  | ReviewAssetCandidateAssetView
  | ReviewAssetCandidateLinkView
  | ReviewAssetCandidateGeneratedView;

export interface ReviewSearchQueryView {
  readonly id: string;
  readonly language: "zh" | "en";
  readonly query: string;
  readonly purpose: string;
  readonly enabled: boolean;
}

export interface ReviewSceneSearchView {
  readonly queries: readonly ReviewSearchQueryView[];
  readonly candidates: readonly ReviewAssetCandidateView[];
  readonly lastSearchedAt?: string;
  readonly enabledQueryCount: number;
  readonly candidateCount: number;
}

export interface ReviewVisualPlanView {
  readonly decision: string;
  readonly rationale: string;
  readonly preferredMedia: readonly ("photo" | "video")[];
  readonly visualKeywords: readonly string[];
}

export interface ReviewSourceAnchorView {
  readonly strategy: "source-blocks-v1";
  readonly sourceBlockIds: readonly string[];
  readonly startQuote: string;
  readonly endQuote: string;
}

export type SceneStatusValue = "pending" | "candidates_ready";

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
  readonly status: SceneStatusValue;
}

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

export interface ReviewGenerationView {
  readonly plannerProvider: string;
  readonly apiProtocol?: string;
  readonly model?: string;
  readonly promptVersion: string;
  readonly plannerOutputSchemaVersion: string;
  readonly sourceBlockVersion: string;
  readonly generatedAt: string;
}

export interface ReviewProjectView {
  readonly schemaVersion: "0.1";
  readonly project: ReviewProjectMetaView;
  readonly source: ReviewSourceView;
  readonly generation: ReviewGenerationView | null;
  readonly scenes: readonly ReviewSceneView[];
  readonly status: "created" | "planned";
  readonly sceneCount: number;
  readonly searchedSceneCount: number;
  readonly lastGenerationAt: string | null;
  readonly sceneStatuses: readonly {
    readonly sceneId: string;
    readonly sceneOrder: number;
    readonly status: SceneStatusValue;
  }[];
}

/** GET /api/project response envelope. */
export interface ProjectApiResponse {
  readonly ok: true;
  readonly project: ReviewProjectView;
}

/** Phase 3: a single project entry in the workspace listing. */
export interface ProjectListItem {
  readonly name: string;
  readonly path: string;
  readonly hasProject: true;
  readonly title: string;
  readonly sceneCount: number;
  readonly updatedAt: string;
  readonly isActive: boolean;
}

/** Phase 3: GET /api/projects response envelope. */
export interface ProjectsApiResponse {
  readonly ok: true;
  readonly projects: readonly ProjectListItem[];
  readonly activeProject: string | null;
}

/** Phase 3: DELETE /api/project response envelope. */
export interface DeleteProjectApiResponse {
  readonly ok: true;
}

/** GET /api/health response. */
export interface HealthApiResponse {
  readonly ok: true;
  readonly projectRoot: string;
  readonly host: string;
  readonly port: number;
  readonly version: string;
}

/** Error response from the API. */
export interface ApiErrorResponse {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly hint?: string;
  };
}

/** Desensitized settings view (no plaintext keys). Mirrors backend SettingsView. */
export interface SettingsView {
  readonly plannerProvider: string;
  readonly hasDeepseekKey: boolean;
  readonly hasStepKey: boolean;
  readonly hasPexelsKey: boolean;
  readonly hasPixabayKey: boolean;
  readonly hasUnsplashKey: boolean;
  readonly hasOpenverseKey: boolean;
  readonly deepseekBaseUrl: string;
  readonly deepseekModel: string;
  readonly stepBaseUrl: string;
  readonly stepModel: string;
  readonly stepImageModel: string;
  readonly pexelsBaseUrl: string;
  readonly pexelsVideoBaseUrl: string;
}

/** Asset provider names accepted by search endpoints. */
export type SearchProviderName = "fixture" | "pexels" | "pixabay" | "unsplash" | "openverse";
