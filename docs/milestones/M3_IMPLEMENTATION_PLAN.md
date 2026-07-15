# M3 Implementation Plan: Asset Provider Search, Rights Mapping, and Cache

> Target executor: Claude Code
> Follow-up auditor: Codex
> Current prerequisite: fix all blocking items in `docs/milestones/M2_CODE_AUDIT_REPORT.md`
> Milestone boundary: search and cache asset candidates only; do not implement review UI, local file attachment, or automatic downloads

## 1. Goal

M3 turns a planned project into a project with searchable asset candidates:

```bash
s2s init ./demo --script ./script.md
s2s plan ./demo --provider fixture
s2s search ./demo --provider fixture
s2s status ./demo
```

After M3:

- stock-asset scenes can receive normalized `AssetCandidate[]`;
- every candidate has provider snapshot, source URL, creator metadata, and structured `AssetRights`;
- search responses are cached under `cache/search/...`;
- provider failures are isolated per scene/query where possible;
- no remote media is downloaded;
- no review decisions are made automatically.

## 2. Start Gate

Before implementing M3, complete M2 hardening:

- Built CLI can run from `dist`.
- `s2s init -> plan -> status` works with `project.s2s.json`.
- Source block ranges are correct for LF, CRLF, BOM, Chinese, and emoji.
- `s2s plan --dry-run` is byte-stable.
- DeepSeek requires explicit model configuration.
- Full check suite passes in a clean dependency install.

Do not build M3 on top of a broken `plan` pipeline.

## 3. Non-goals

Do not implement:

- automatic media download;
- local asset attachment;
- review server or React UI;
- candidate selection, skip, or approval workflows;
- multi-provider ranking beyond simple per-provider result sorting;
- Openverse, Wikimedia, Unsplash, Pixabay, or other providers;
- AI visual reranking;
- video rendering, ASR, subtitle, timeline, or database support.

Pexels is the only real provider for M3. A fixture provider is required for tests.

## 4. Architecture

Suggested structure:

```text
src/
├── application/
│   ├── search-project-assets.ts
│   └── ports/
│       ├── asset-provider.ts
│       └── search-cache.ts
├── providers/
│   ├── fixture/
│   │   └── fixture-asset-provider.ts
│   └── pexels/
│       ├── pexels-client.ts
│       ├── pexels-provider.ts
│       ├── pexels-mapper.ts
│       ├── pexels-policy.ts
│       └── pexels-types.ts
├── infrastructure/
│   ├── file-search-cache.ts
│   └── env.ts
└── cli/
    └── commands/
        └── search-command.ts
```

Domain remains independent from HTTP, filesystem, Pexels, CLI, and cache details.

## 5. Asset Provider Port

Define:

```ts
export interface AssetProvider {
  readonly providerId: string;
  readonly providerSnapshot: AssetProviderSnapshot;
  search(input: AssetSearchInput): Promise<AssetSearchResult>;
}
```

Required input:

- `queryId`
- `query`
- `language`
- `mediaTypes: Array<"photo" | "video">`
- `orientation?: "portrait" | "landscape" | "square"`
- `perPage`
- `page`
- `projectPolicy`
- `sceneId`

Required result:

- normalized `AssetCandidate[]`
- provider request metadata
- cacheability metadata
- non-fatal warnings

All external provider data is `unknown` until validated or mapped through typed guards.

## 6. Search Use Case

Create `searchProjectAssets(input, repository, provider, cache, clock)`:

Input:

- `projectRoot`
- `provider`
- `sceneId?`
- `refresh`
- `perSceneLimit`
- `perQueryLimit`
- `mediaType?`
- `json`

Flow:

1. Load project through repository.
2. Require `generation !== null` and at least one scene.
3. Select target scenes:
   - all scenes by default;
   - one scene when `--scene <id>` is provided.
4. For each scene, use only enabled queries.
5. Skip scenes whose `visualPlan.decision` is not `stock_asset`, unless explicitly requested with `--include-non-stock`.
6. For each query/media type, check cache unless `--refresh`.
7. Call provider on cache miss.
8. Map, validate, dedupe, sort, and limit candidates.
9. Update `scene.search.candidates` and `scene.search.lastSearchedAt`.
10. Save the project once at the end through repository.

Partial failure rule:

- One query failure should not fail the entire project.
- Record a warning in command output.
- If every query fails, return a provider/search error and do not save partial candidates unless explicitly designed and documented.

## 7. Candidate Normalization

Every candidate must satisfy existing `AssetCandidateSchema`.

M3 must set:

- stable candidate ID;
- provider snapshot;
- provider asset ID;
- media type;
- thumbnail URL;
- preview URL when available;
- source page URL;
- width, height, orientation;
- video duration when media type is video;
- creator name or `null`;
- creator profile URL when available;
- rights snapshot;
- retrieved timestamp;
- matched query ID;
- rank.

Candidate ID should be deterministic from provider, media type, provider asset ID, and query ID.

## 8. Rights Mapping

Pexels uses a platform license. Do not call it "open source" or "copyright free".

For Pexels candidates:

- `rights.status = "platform_license"`
- `licenseName = "Pexels License"`
- `licenseUrl` points to the official Pexels license/terms URL
- `attributionRequired = false`
- `commercialUse = "allowed"` only if the current verified policy supports it
- `derivatives = "allowed"` only if the current verified policy supports it
- `restrictions` must include key practical restrictions from provider policy
- `evidence.referenceUrl` must point to official provider policy
- `provider.termsCheckedAt` must be a fixed, explicit verification timestamp in code or catalog
- `policyRevision` must be project-owned, e.g. `pexels-policy-2026-07-14`

Do not overclaim rights. If unsure, use `unclear` plus restrictions.

## 9. Pexels Provider

Environment:

```dotenv
PEXELS_API_KEY=
PEXELS_BASE_URL=https://api.pexels.com/v1
PEXELS_VIDEO_BASE_URL=https://api.pexels.com/videos
```

Client rules:

- Authorization header is required.
- Timeout is finite.
- 429 becomes a typed rate-limit error.
- 5xx can retry a small fixed number of times with bounded backoff.
- 4xx, except 429, should not retry.
- Tests use fake HTTP clients only.
- Do not call the real Pexels API in CI.

Endpoints:

- Photo search: `/search`
- Video search: `/search` under video base URL

Mapper tests must use fixture JSON copied from documented shape or synthetic minimal examples, not live responses.

## 10. Cache

Cache path:

```text
cache/search/<provider>/<hash>.json
```

Hash input must include:

- provider ID;
- provider policy revision;
- media type;
- query text;
- language;
- orientation;
- perPage;
- page;
- mapper version.

Cache entry:

```ts
type SearchCacheEntry = {
  schemaVersion: "0.1";
  providerId: string;
  createdAt: string;
  expiresAt: string;
  request: AssetSearchInput;
  response: AssetCandidate[];
  warnings: string[];
};
```

Rules:

- Cache files are JSON, UTF-8, LF, two-space indentation.
- Cache writes are atomic.
- `--refresh` bypasses cache read and overwrites cache on success.
- Expired cache is ignored.
- Cache validation failure is treated as cache miss, not project failure.
- Cache must never contain API keys.

## 11. Dedupe and Ranking

Dedupe key:

```text
provider.id + mediaType + providerAssetId
```

Ranking should be simple and deterministic:

1. Prefer orientation matching project aspect ratio.
2. Prefer higher resolution up to a reasonable cap.
3. Preserve provider rank as a stable tiebreaker.
4. Keep photo/video balance only if both are requested.

Limit candidates per scene, default 12.

## 12. CLI

Add:

```bash
s2s search <project-directory> [--provider fixture|pexels] [--scene <scene-id>] [--refresh] [--limit <n>] [--json]
```

Behavior:

- Default provider is `fixture`.
- `--provider pexels` requires `PEXELS_API_KEY`.
- Human output includes:
  - searched scene count;
  - successful query count;
  - failed query count;
  - candidate count added;
  - cache hit/miss count;
  - warning summary.
- `--json` prints machine-readable output only.

Exit codes:

- `0`: success, including partial per-query misses if at least one query succeeded;
- `1`: I/O/provider runtime failure;
- `2`: invalid user input or missing env;
- `3`: schema, mapping, rights, or project validation failure.

## 13. Tests

Required tests:

- Fixture provider returns deterministic photo/video candidates.
- Pexels photo mapper.
- Pexels video mapper.
- Pexels rights mapping.
- Orientation derivation.
- Dedupe by provider/media/providerAssetId.
- Ranking and scene limit.
- Cache hit.
- Cache miss.
- Cache expiry.
- `--refresh` bypass.
- 429 formatting.
- 5xx bounded retry.
- Missing API key.
- One scene/query with no results does not fail whole project.
- Project with no planned scenes rejects search.
- Non-stock scenes are skipped by default.
- `scene.search.lastSearchedAt` is set only when candidates are present.
- No test calls the real network.

## 14. Documentation Updates

Update:

- `README.md`: add `s2s search` example.
- `.env.example`: add Pexels base URL variables if implemented.
- `docs/PROJECT_SCHEMA.md`: document candidate and search state after M3.
- `docs/ASSET_LICENSING.md`: document Pexels platform-license interpretation and user responsibilities.
- `catalog/sources.yaml`: ensure Pexels entry has official policy URLs and verification date.
- `docs/milestones/M3_IMPLEMENTATION_PLAN.md`: mark task completion only after checks pass.

## 15. Definition of Done

M3 is complete only when:

- M2 audit blocking findings are fixed.
- `s2s search --provider fixture` writes valid candidates to stock-asset scenes.
- `s2s search --provider pexels` is implemented behind fake-client-tested infrastructure.
- Every candidate validates with `AssetCandidateSchema`.
- Every candidate has structured `AssetRights`.
- Cache is used and tested.
- No media files are downloaded.
- No real network calls occur in tests.
- Built CLI works from `dist`.
- Full checks pass:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 16. Suggested Claude Prompt

```text
请先阅读：
1. AGENTS.md
2. CLAUDE.md
3. docs/milestones/M2_CODE_AUDIT_REPORT.md
4. docs/milestones/M3_IMPLEMENTATION_PLAN.md
5. docs/PROJECT_SCHEMA.md
6. docs/ASSET_LICENSING.md
7. catalog/sources.yaml

任务：
先修复 M2_CODE_AUDIT_REPORT.md 中所有 Blocking Findings，并补齐测试。
确认 init -> plan -> status 的 dist CLI 烟测通过后，再实现 M3：AssetProvider port、fixture provider、Pexels client/provider/mapper、rights mapping、file search cache、searchProjectAssets use case 和 s2s search CLI。

边界：
不得实现 Review UI、Review Server、上传、本地素材关联、自动下载素材、视频渲染、ASR 或数据库。
不得真实调用网络测试。Pexels 只能通过 fake HTTP client 测试。
不得把 API key、远程原始响应大包或下载素材提交到 Git。
完成后保留未提交工作树，交给 Codex 审计。
```
