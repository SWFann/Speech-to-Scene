/**
 * ScriptPlanner port.
 *
 * Abstraction over LLM-based script planning. The Application layer defines
 * the contract; Infrastructure provides the implementation (fixture, DeepSeek, etc.).
 *
 * The planner is responsible for:
 * - Receiving pre-extracted source blocks and project metadata
 * - Producing a structured plan with scenes, anchors, visual decisions, and queries
 * - Returning raw output plus optional usage metrics
 *
 * The Application layer never calls a specific provider SDK, model name, or
 * API base URL.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Capabilities advertised by a planner implementation.
 */
export interface PlannerCapabilities {
  /** Whether the provider supports strict JSON schema mode. */
  readonly jsonMode: boolean;
  /** Whether the provider supports strict JSON schema (as opposed to free-form JSON). */
  readonly strictJsonSchema: boolean;
  /** Whether the provider supports tool/function calling. */
  readonly toolCalling: boolean;
  /** Whether the provider returns token usage metrics. */
  readonly usageMetrics: boolean;
}

/**
 * Visual decision for a scene (subset of VisualDecision used in planning).
 */
export type VisualDecision =
  | "speaker_only"
  | "stock_asset"
  | "title_card"
  | "structured_graphic"
  | "screen_capture"
  | "user_asset"
  | "none";

/**
 * Narrative role for a scene (subset of NarrativeRole used in planning).
 */
export type NarrativeRole =
  | "hook"
  | "question"
  | "claim"
  | "explanation"
  | "example"
  | "comparison"
  | "process"
  | "data"
  | "story"
  | "emotion"
  | "transition"
  | "conclusion"
  | "call_to_action";

/**
 * Media type preference for visual assets.
 */
export type PreferredMedia = "photo" | "video";

/**
 * Search query for a stock asset.
 */
export interface SearchQuery {
  readonly language: "zh" | "en";
  readonly query: string;
  readonly purpose: string;
  readonly enabled: boolean;
}

/**
 * Visual plan for a scene.
 */
export interface VisualPlan {
  readonly decision: VisualDecision;
  readonly rationale: string;
  readonly preferredMedia: readonly PreferredMedia[];
  readonly visualKeywords: readonly string[];
}

/**
 * Source anchor for a scene (references source blocks).
 */
export interface SourceAnchor {
  readonly strategy: "source-blocks-v1";
  readonly sourceBlockIds: readonly string[];
  readonly startQuote: string;
  readonly endQuote: string;
}

/**
 * A single scene produced by the planner.
 */
export interface PlannedScene {
  readonly sourceAnchor: SourceAnchor;
  readonly summary: string;
  readonly narrativeRole: NarrativeRole;
  readonly visualPlan: VisualPlan;
  readonly queries: readonly SearchQuery[];
}

/**
 * Input to the planner.
 */
export interface PlanScriptInput {
  readonly rawText: string;
  readonly sourceBlocks: readonly SourceBlockForPlanner[];
  readonly language: string;
  readonly aspectRatio: string;
  readonly style: string;
  readonly assetUsePolicy: {
    readonly intendedUse: string;
    readonly willModify: boolean;
  };
  readonly maxScenes: number;
  readonly promptVersion: string;
}

/**
 * Source block as seen by the planner (simplified from persisted SourceBlock).
 */
export interface SourceBlockForPlanner {
  readonly id: string;
  readonly order: number;
  readonly kind: "heading" | "paragraph" | "list_item" | "blockquote" | "code_block" | "other";
  readonly sourceRange: {
    readonly start: number;
    readonly end: number;
  };
}

/**
 * API protocol used by the planner.
 */
export type PlannerApiProtocol = "fixture" | "openai-compatible" | "anthropic";

/**
 * Token usage metrics from the planner.
 */
export interface PlannerUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

/**
 * Raw result from the planner.
 */
export interface PlannerRawResult {
  readonly output: unknown;
  readonly model?: string;
  readonly apiProtocol: PlannerApiProtocol;
  readonly usage?: PlannerUsage;
  readonly requestId?: string;
}

/**
 * ScriptPlanner port.
 *
 * Implementations must be pure in their interface: they accept input and
 * return output. Network I/O, retries, and provider-specific details are
 * confined to the Infrastructure layer.
 */
export interface ScriptPlanner {
  /** Stable provider identifier (e.g., "fixture", "deepseek"). */
  readonly providerId: string;

  /** Capabilities advertised by this implementation. */
  readonly capabilities: PlannerCapabilities;

  /**
   * Plan a script into scenes.
   *
   * @param input - Pre-extracted source blocks and project metadata.
   * @returns Raw result from the planner.
   */
  plan(input: PlanScriptInput): Promise<PlannerRawResult>;
}
