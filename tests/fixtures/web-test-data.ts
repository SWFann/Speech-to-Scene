/**
 * Test fixtures for web component tests.
 *
 * These fixtures mirror the shape of the GET /api/project response
 * but are minimal — only enough fields to test rendering.
 */

import type { ReviewProjectView } from "../../web/src/types.js";

export function createMinimalProject(): ReviewProjectView {
  return {
    schemaVersion: "0.1",
    project: {
      id: "project-test-001",
      title: "测试项目",
      createdAt: "2026-07-16T10:00:00.000Z",
      updatedAt: "2026-07-16T10:00:00.000Z",
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: {
        intendedUse: "commercial_capable",
        willModify: true,
      },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: "abc123",
      encoding: "utf-8",
      sizeBytes: 100,
      textLengthUtf16: 50,
      offsetUnit: "utf16_code_unit",
      blockCount: 1,
    },
    generation: {
      plannerProvider: "fixture",
      promptVersion: "plan-script-v1",
      plannerOutputSchemaVersion: "0.1",
      sourceBlockVersion: "0.1",
      generatedAt: "2026-07-16T10:00:00.000Z",
    },
    scenes: [
      {
        id: "scene-001",
        order: 1,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "测试引用开始",
          endQuote: "测试引用结束",
        },
        sourceRange: { start: 0, end: 20 },
        text: "这是第一个场景的原文。",
        summary: "场景一摘要",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "stock_asset",
          rationale: "需要外部素材",
          preferredMedia: ["photo"],
          visualKeywords: ["关键词A", "关键词B"],
        },
        search: {
          queries: [
            {
              id: "query-001",
              language: "zh",
              query: "测试搜索词",
              purpose: "搜索图片",
              enabled: true,
            },
          ],
          candidates: [
            {
              kind: "asset" as const,
              id: "candidate-001",
              provider: {
                id: "fixture",
                name: "Fixture",
                homepageUrl: "https://example.com",
                termsUrl: "https://example.com/terms",
                policyRevision: "v1",
                termsCheckedAt: "2026-07-16T10:00:00.000Z",
              },
              providerAssetId: "fixture-001",
              mediaType: "photo",
              thumbnailUrl: "https://example.com/thumb.jpg",
              sourcePageUrl: "https://example.com/page",
              width: 1920,
              height: 1080,
              orientation: "landscape",
              creator: { name: "Test Creator" },
              rights: {
                status: "platform_license",
                attributionRequired: false,
                commercialUse: "allowed",
                derivatives: "allowed",
                verifiedAt: "2026-07-16T10:00:00.000Z",
                evidence: {
                  capturedAt: "2026-07-16T10:00:00.000Z",
                  referenceUrl: "https://example.com",
                  fields: {},
                },
              },
              retrievedAt: "2026-07-16T10:00:00.000Z",
              matchedQueryId: "query-001",
              rank: 1,
            },
          ],
          lastSearchedAt: "2026-07-16T10:00:00.000Z",
          enabledQueryCount: 1,
          candidateCount: 1,
        },
        status: "candidates_ready",
      },
      {
        id: "scene-002",
        order: 2,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0002"],
          startQuote: "第二段引用",
          endQuote: "结束",
        },
        sourceRange: { start: 20, end: 40 },
        text: "这是第二个场景的原文。",
        summary: "场景二摘要",
        narrativeRole: "conclusion",
        visualPlan: {
          decision: "speaker_only",
          rationale: "人物主体",
          preferredMedia: ["video"],
          visualKeywords: ["人物"],
        },
        search: {
          queries: [],
          candidates: [],
          enabledQueryCount: 0,
          candidateCount: 0,
        },
        status: "pending",
      },
    ],
    status: "planned",
    sceneCount: 2,
    searchedSceneCount: 1,
    lastGenerationAt: "2026-07-16T10:00:00.000Z",
    sceneStatuses: [
      { sceneId: "scene-001", sceneOrder: 1, status: "candidates_ready" },
      { sceneId: "scene-002", sceneOrder: 2, status: "pending" },
    ],
  };
}

/**
 * Phase 1 redesign: local asset and selected candidate review states have
 * been removed. These helpers are retained as no-ops for backward
 * compatibility with any remaining imports.
 */
export function createProjectWithLocalAsset(): ReviewProjectView {
  // Review state machine removed in Phase 1 redesign — return base project.
  return createMinimalProject();
}

export function createProjectWithSelectedCandidate(): ReviewProjectView {
  // Review state machine removed in Phase 1 redesign — return base project.
  return createMinimalProject();
}
