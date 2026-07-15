/**
 * DeepSeek planner adapter.
 *
 * Implements ScriptPlanner for DeepSeek's OpenAI-compatible API.
 *
 * Rules:
 * - Do not hard-code model names in Domain (model comes from config).
 * - Do not log API keys.
 * - Base URL must be configurable.
 * - Timeout must be finite.
 * - Non-2xx responses become PlannerError.
 * - Invalid JSON becomes PlannerOutputError.
 * - Valid JSON that fails Zod or relation validation becomes PlannerValidationError.
 */

import type { HttpJsonClient } from "../infrastructure/http-json-client.js";
import { HttpJsonClient as HttpClientClass } from "../infrastructure/http-json-client.js";
import { readPlannerEnv } from "../infrastructure/env.js";
import {
  PlannerOutputSchema,
  validateStockAssetQueries,
} from "../planner/planner-output-schema.js";
import { PlannerError, PlannerOutputError, PlannerValidationError } from "../shared/errors.js";
import type {
  ScriptPlanner,
  PlanScriptInput,
  PlannerRawResult,
  PlannerCapabilities,
} from "../application/ports/script-planner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepSeekPlannerOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Allows injecting a fake HTTP client for tests. */
  readonly client?: HttpJsonClient;
}

// ---------------------------------------------------------------------------
// DeepSeek planner implementation
// ---------------------------------------------------------------------------

/**
 * DeepSeek planner capabilities.
 */
const DEEPSEEK_CAPABILITIES: PlannerCapabilities = {
  jsonMode: true,
  strictJsonSchema: false,
  toolCalling: false,
  usageMetrics: true,
};

/**
 * DeepSeekScriptPlanner implements ScriptPlanner for DeepSeek.
 *
 * It uses the OpenAI-compatible chat completions endpoint with JSON mode.
 */
export class DeepSeekScriptPlanner implements ScriptPlanner {
  readonly providerId = "deepseek";
  readonly capabilities = DEEPSEEK_CAPABILITIES;

  private readonly client: HttpJsonClient;
  private readonly model: string;

  constructor(options: DeepSeekPlannerOptions) {
    if (!options.model || options.model.trim() === "") {
      throw new Error("DeepSeek model is required");
    }
    this.model = options.model;
    this.client =
      options.client ??
      new HttpClientClass({
        baseUrl: options.baseUrl ?? readPlannerEnv().deepseekBaseUrl ?? "https://api.deepseek.com",
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs ?? 30_000,
      });
  }

  /**
   * Plans a script using DeepSeek.
   *
   * Sends the source blocks and metadata to DeepSeek's chat completions
   * endpoint with JSON mode enabled.
   */
  async plan(input: PlanScriptInput): Promise<PlannerRawResult> {
    // Build the system prompt
    const systemPrompt = this.buildSystemPrompt(input);
    const userPrompt = this.buildUserPrompt(input);

    // Call DeepSeek API
    const response = await this.client.post<{
      choices: Array<{
        message: {
          content: string;
        };
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      model: string;
    }>("/chat/completions", {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4096,
    });

    if (!response.ok) {
      const errorData = response.data as { error?: { message: string } };
      const message = errorData?.error?.message ?? `DeepSeek API error: ${response.status}`;
      throw new PlannerError(message, "请检查 API 密钥和网络连接");
    }

    const choice = response.data.choices?.[0];
    if (!choice) {
      throw new PlannerOutputError("DeepSeek returned no choices", "API 返回了空响应");
    }

    const content = choice.message.content;
    if (!content) {
      throw new PlannerOutputError("DeepSeek returned empty content", "API 返回了空内容");
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new PlannerOutputError(
        "Failed to parse DeepSeek response as JSON",
        "API 返回了无效的 JSON",
      );
    }

    // Validate with Zod schema
    let validated;
    try {
      validated = PlannerOutputSchema.parse(parsed);
    } catch (error) {
      if (error instanceof Error) {
        throw new PlannerValidationError(
          `Planner output validation failed: ${error.message}`,
          "Planner 输出不符合要求，请检查提示词",
        );
      }
      throw new PlannerValidationError(
        "Planner output validation failed",
        "Planner 输出不符合要求",
      );
    }

    // Validate stock asset queries
    try {
      validateStockAssetQueries(validated);
    } catch (error) {
      if (error instanceof Error) {
        throw new PlannerValidationError(
          `Stock asset query validation failed: ${error.message}`,
          "stock_asset 场景必须有 enabled query",
        );
      }
      throw error;
    }

    const baseResult: Omit<PlannerRawResult, "usage" | "requestId"> = {
      output: validated,
      model: response.data.model,
      apiProtocol: "openai-compatible" as const,
    };
    const result: PlannerRawResult = response.data.usage
      ? {
          ...baseResult,
          usage: {
            inputTokens: response.data.usage.prompt_tokens,
            outputTokens: response.data.usage.completion_tokens,
            totalTokens: response.data.usage.total_tokens,
          },
          ...(response.requestId !== undefined ? { requestId: response.requestId } : {}),
        }
      : {
          ...baseResult,
          ...(response.requestId !== undefined ? { requestId: response.requestId } : {}),
        };
    return result;
  }

  /**
   * Builds the system prompt for the planner.
   */
  private buildSystemPrompt(input: PlanScriptInput): string {
    const blockList = input.sourceBlocks
      .map((b) => `[${b.id}] (${b.kind}) range(${b.sourceRange.start}-${b.sourceRange.end})`)
      .join("\n");

    return `You are a script planning assistant. Analyze the provided script and produce a structured plan.

RULES:
1. Segment by semantic beats, not every sentence.
2. Do not overuse stock assets. Prefer speaker_only or title_card when appropriate.
3. Preserve personal/emotional segments as speaker_only.
4. Convert abstract ideas into concrete searchable visuals.
5. Do not create generic "success/future/technology" imagery.
6. Use block IDs and short quotes, not character offsets.
7. Keep scene order identical to source order.
8. Do not add facts or change the speaker's viewpoint.
9. Generate practical search queries only when a stock asset is useful.
10. Anchors must reference existing blocks by ID and use quotes found in those blocks.

SOURCE BLOCKS:
${blockList}

OUTPUT FORMAT (strict JSON):
{
  "scenes": [
    {
      "sourceAnchor": {
        "strategy": "source-blocks-v1",
        "sourceBlockIds": ["block-0001"],
        "startQuote": "exact quote from first block",
        "endQuote": "exact quote from last block"
      },
      "summary": "Brief summary of the scene",
      "narrativeRole": "hook|question|claim|explanation|example|comparison|process|data|story|emotion|transition|conclusion|call_to_action",
      "visualPlan": {
        "decision": "speaker_only|stock_asset|title_card|structured_graphic|screen_capture|user_asset|none",
        "rationale": "Why this visual decision",
        "preferredMedia": ["photo|video"],
        "visualKeywords": ["keyword1", "keyword2"]
      },
      "queries": [
        {
          "language": "zh|en",
          "query": "concrete search query",
          "purpose": "why this query is needed",
          "enabled": true
        }
      ]
    }
  ]
}

VALIDATION RULES:
- scenes.length >= 1
- sourceBlockIds must reference existing blocks and be consecutive
- startQuote and endQuote must be exact substrings of the referenced blocks
- stock_asset scenes must have at least one enabled query
- speaker_only, title_card, structured_graphic, screen_capture, user_asset, none do NOT need external queries
- No scene may add facts not present in the source`;
  }

  /**
   * Builds the user prompt for the planner.
   */
  private buildUserPrompt(input: PlanScriptInput): string {
    const sourceBlocksList = input.sourceBlocks
      .map((b) => `[${b.id}] ${b.kind}: range(${b.sourceRange.start}-${b.sourceRange.end})`)
      .join("\n---\n");

    return `Please plan the following script.

SCRIPT TEXT:
${input.rawText}

SOURCE BLOCKS:
${sourceBlocksList}

CONFIG:
- Language: ${input.language}
- Aspect Ratio: ${input.aspectRatio}
- Style: ${input.style}
- Asset Use Policy: ${input.assetUsePolicy.intendedUse}, willModify=${input.assetUsePolicy.willModify}
- Max Scenes: ${input.maxScenes}
- Prompt Version: ${input.promptVersion}

Return the plan as strict JSON matching the specified format.`;
  }
}
