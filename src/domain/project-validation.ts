/**
 * Cross-field and cross-object project validators.
 *
 * These validators enforce invariants that cannot be expressed within a
 * single Zod schema:
 * - Block order is consecutive starting from 1.
 * - Scene order is consecutive starting from 1.
 * - Ranges are sorted and non-overlapping.
 * - All ranges fit within source text boundaries.
 * - Scene anchors reference valid blocks in consecutive order.
 * - Scene ranges fall within anchor coverage.
 * - Scene text matches the source text slice.
 * - stock_asset scenes have at least one enabled search query.
 *
 * Single-object rules (field formats, enums, required fields) live in each
 * schema's `.superRefine()` or field-level constraints.
 */

import type { SpeechToSceneProject } from "./project-schema.js";
import type { Scene } from "./scene-schema.js";
import type { SourceBlock } from "./project-schema.js";

// ---------------------------------------------------------------------------
// Domain issue type
// ---------------------------------------------------------------------------

/**
 * Structured validation issue returned by domain validators.
 *
 * `path` is an array of field names and indices describing the location of
 * the issue within the project structure. It never contains user-facing
 * paths, source text, or absolute file paths.
 */
export type DomainIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates that an array of ordered items has consecutive order values
 * starting from 1, and that the array order matches the order field.
 */
function validateConsecutiveOrder(
  items: { order: number }[],
  itemLabel: string,
  pathPrefix: Array<string | number>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (items.length === 0) {
    return issues;
  }

  // Check consecutive order starting from 1
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const expectedOrder = i + 1;
    if (item.order !== expectedOrder) {
      issues.push({
        code: "non_consecutive_order",
        path: [...pathPrefix, i, "order"],
        message: `${itemLabel} order 必须从 1 开始连续递增，第 ${i + 1} 个的 order 是 ${item.order}`,
      });
    }
  }

  // Check array order matches order field
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const curr = items[i]!;
    if (curr.order < prev.order) {
      issues.push({
        code: "order_mismatch",
        path: [...pathPrefix, i, "order"],
        message: `${itemLabel} 数组顺序必须与 order 字段一致`,
      });
    }
  }

  return issues;
}

/**
 * Validates that ranges are sorted by start position and non-overlapping.
 */
function validateSortedNonOverlappingRanges(
  ranges: { start: number; end: number }[],
  itemLabel: string,
  pathPrefix: Array<string | number>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (ranges.length === 0) {
    return issues;
  }

  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1]!;
    const curr = ranges[i]!;
    if (curr.start < prev.start) {
      issues.push({
        code: "range_not_sorted",
        path: [...pathPrefix, i, "sourceRange", "start"],
        message: `${itemLabel} range 必须按 start 排序`,
      });
    }
    if (curr.start < prev.end) {
      issues.push({
        code: "range_overlap",
        path: [...pathPrefix, i, "sourceRange", "start"],
        message: `${itemLabel} range 不能重叠`,
      });
    }
  }

  return issues;
}

/**
 * Validates that all ranges fit within the given boundary.
 */
function validateRangesWithinBoundary(
  ranges: { start: number; end: number }[],
  boundary: number,
  itemLabel: string,
  pathPrefix: Array<string | number>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (range.start < 0) {
      issues.push({
        code: "range_out_of_bounds",
        path: [...pathPrefix, i, "sourceRange", "start"],
        message: `${itemLabel} range.start 必须 >= 0`,
      });
    }
    if (range.end > boundary) {
      issues.push({
        code: "range_out_of_bounds",
        path: [...pathPrefix, i, "sourceRange", "end"],
        message: `${itemLabel} range.end 必须 <= ${boundary}`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Block validation
// ---------------------------------------------------------------------------

function validateBlocks(project: SpeechToSceneProject): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const blocks = project.source.blocks;

  if (blocks.length === 0) {
    return issues;
  }

  issues.push(...validateConsecutiveOrder(blocks, "block", ["source", "blocks"]));

  const ranges = blocks.map((b) => b.sourceRange);
  issues.push(...validateSortedNonOverlappingRanges(ranges, "block", ["source", "blocks"]));
  issues.push(
    ...validateRangesWithinBoundary(ranges, project.source.textLengthUtf16, "block", [
      "source",
      "blocks",
    ]),
  );

  return issues;
}

// ---------------------------------------------------------------------------
// Scene range validation
// ---------------------------------------------------------------------------

function validateSceneRanges(project: SpeechToSceneProject): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const scenes = project.scenes;

  if (scenes.length === 0) {
    return issues;
  }

  issues.push(...validateConsecutiveOrder(scenes, "scene", ["scenes"]));

  const ranges = scenes.map((s) => s.sourceRange);
  issues.push(...validateSortedNonOverlappingRanges(ranges, "scene", ["scenes"]));
  issues.push(
    ...validateRangesWithinBoundary(ranges, project.source.textLengthUtf16, "scene", ["scenes"]),
  );

  return issues;
}

// ---------------------------------------------------------------------------
// Scene anchor validation
// ---------------------------------------------------------------------------

function validateSceneAnchors(project: SpeechToSceneProject): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const blocks = project.source.blocks;

  if (blocks.length === 0 || project.scenes.length === 0) {
    return issues;
  }

  // Build block lookup: id -> block
  const blockById = new Map<string, SourceBlock>();
  for (const block of blocks) {
    blockById.set(block.id, block);
  }

  for (let sceneIdx = 0; sceneIdx < project.scenes.length; sceneIdx++) {
    const scene = project.scenes[sceneIdx]!;
    const anchorBlockIds = scene.sourceAnchor.sourceBlockIds;

    // Check that all referenced blocks exist
    const anchorBlocks: SourceBlock[] = [];
    for (const blockId of anchorBlockIds) {
      const block = blockById.get(blockId);
      if (!block) {
        issues.push({
          code: "anchor_block_not_found",
          path: ["scenes", sceneIdx, "sourceAnchor", "sourceBlockIds"],
          message: `Scene ${scene.id} 引用了不存在的 block: ${blockId}`,
        });
        continue;
      }
      anchorBlocks.push(block);
    }

    if (anchorBlocks.length === 0) {
      continue;
    }

    // Check that referenced blocks are consecutive by order
    const sortedByOrder = [...anchorBlocks].sort((a, b) => a.order - b.order);
    for (let i = 1; i < sortedByOrder.length; i++) {
      const prev = sortedByOrder[i - 1]!;
      const curr = sortedByOrder[i]!;
      if (curr.order !== prev.order + 1) {
        issues.push({
          code: "anchor_blocks_not_consecutive",
          path: ["scenes", sceneIdx, "sourceAnchor", "sourceBlockIds"],
          message: `Scene ${scene.id} 引用的 blocks 不连续`,
        });
        break;
      }
    }

    // Check scene range falls within anchor coverage
    const firstBlock = sortedByOrder[0]!;
    const lastBlock = sortedByOrder[sortedByOrder.length - 1]!;
    if (scene.sourceRange.start < firstBlock.sourceRange.start) {
      issues.push({
        code: "scene_range_exceeds_anchor",
        path: ["scenes", sceneIdx, "sourceRange", "start"],
        message: `Scene ${scene.id} range.start 早于首个 anchor block`,
      });
    }
    if (scene.sourceRange.end > lastBlock.sourceRange.end) {
      issues.push({
        code: "scene_range_exceeds_anchor",
        path: ["scenes", sceneIdx, "sourceRange", "end"],
        message: `Scene ${scene.id} range.end 晚于末尾 anchor block`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Scene text validation
// ---------------------------------------------------------------------------

function validateSceneText(): DomainIssue[] {
  // Note: rawText is not stored in the project; it comes from the source
  // document file. Scene text validation against rawText.slice(start, end)
  // is performed by the Application layer (M2 I/O validator) where the
  // actual file bytes are available. The schema ensures text is non-empty.
  // This validator only checks structural consistency.
  return [];
}

// ---------------------------------------------------------------------------
// Search validation
// ---------------------------------------------------------------------------

function validateSearch(): DomainIssue[] {
  // stock_asset validation is handled by SceneSchema.superRefine at parse time.
  // Additional search-level validations (e.g., candidate count limits) can
  // be added here as needed.
  return [];
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Validates all cross-field and cross-object invariants for a parsed project.
 *
 * Call this after the top-level schema parse succeeds. The input must be a
 * successfully parsed SpeechToSceneProject (never `unknown`).
 */
export function validateProjectRelations(project: SpeechToSceneProject): DomainIssue[] {
  const issues: DomainIssue[] = [];

  issues.push(...validateBlocks(project));
  issues.push(...validateSceneRanges(project));
  issues.push(...validateSceneAnchors(project));
  issues.push(...validateSceneText());
  issues.push(...validateSearch());

  return issues;
}

/**
 * Validates scene-level relations within a single scene.
 *
 * Used when validating a scene in isolation (e.g., during scene creation)
 * before it is added to a project.
 */
export function validateSceneRelations(scene: Scene, existingBlocks: SourceBlock[]): DomainIssue[] {
  const issues: DomainIssue[] = [];

  // Validate anchor references against existing blocks
  const blockById = new Map<string, SourceBlock>();
  for (const block of existingBlocks) {
    blockById.set(block.id, block);
  }

  const anchorBlocks: SourceBlock[] = [];
  for (const blockId of scene.sourceAnchor.sourceBlockIds) {
    const block = blockById.get(blockId);
    if (!block) {
      issues.push({
        code: "anchor_block_not_found",
        path: ["sourceAnchor", "sourceBlockIds"],
        message: `引用了不存在的 block: ${blockId}`,
      });
      continue;
    }
    anchorBlocks.push(block);
  }

  if (anchorBlocks.length > 0) {
    const sortedByOrder = [...anchorBlocks].sort((a, b) => a.order - b.order);
    for (let i = 1; i < sortedByOrder.length; i++) {
      const prev = sortedByOrder[i - 1]!;
      const curr = sortedByOrder[i]!;
      if (curr.order !== prev.order + 1) {
        issues.push({
          code: "anchor_blocks_not_consecutive",
          path: ["sourceAnchor", "sourceBlockIds"],
          message: "引用的 blocks 不连续",
        });
        break;
      }
    }

    const firstBlock = sortedByOrder[0]!;
    const lastBlock = sortedByOrder[sortedByOrder.length - 1]!;
    if (scene.sourceRange.start < firstBlock.sourceRange.start) {
      issues.push({
        code: "scene_range_exceeds_anchor",
        path: ["sourceRange", "start"],
        message: "scene range.start 早于首个 anchor block",
      });
    }
    if (scene.sourceRange.end > lastBlock.sourceRange.end) {
      issues.push({
        code: "scene_range_exceeds_anchor",
        path: ["sourceRange", "end"],
        message: "scene range.end 晚于末尾 anchor block",
      });
    }
  }

  // Validate search queries
  const queryIds = scene.search.queries.map((q) => q.id);
  const uniqueQueryIds = new Set(queryIds);
  if (uniqueQueryIds.size !== queryIds.length) {
    issues.push({
      code: "duplicate_query_id",
      path: ["search", "queries"],
      message: "Scene 内 query ID 必须唯一",
    });
  }

  if (scene.visualPlan.decision === "stock_asset") {
    const hasEnabledQuery = scene.search.queries.some((q: { enabled: boolean }) => q.enabled);
    if (!hasEnabledQuery) {
      issues.push({
        code: "stock_asset_no_enabled_query",
        path: ["search", "queries"],
        message: "stock_asset scene 至少需要一个 enabled query",
      });
    }
  }

  return issues;
}
