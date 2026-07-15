# M4 Implementation Plan: Local Review Server and Project APIs

> Target executor: Claude Code
> Follow-up auditor: Codex
> Current prerequisite: fix all blocking items in `docs/milestones/M3_CODE_AUDIT_REPORT.md`
> Milestone boundary: local HTTP API only; do not implement the React review board

## 1. Goal

M4 provides a safe local API for reviewing and editing a planned/searched project:

```bash
s2s review ./demo --no-open
```

After M4:

- the server binds to `127.0.0.1` by default;
- the project root is fixed at server startup;
- clients can read project/scene data;
- clients can update visual decisions and queries;
- clients can search one scene through the existing M3 search use case;
- clients can select a candidate or skip a scene;
- clients can upload a local image/video into `assets/<scene-id>/`;
- all writes go through the repository;
- all request bodies are validated with Zod;
- no arbitrary filesystem paths are accepted from clients.

M5 will build the React UI on top of this API. M4 is the API and security foundation.

## 2. Start Gate

Before M4 starts, complete M3 hardening:

- fixture search writes valid candidates into `project.s2s.json`;
- cache hits cannot write partial candidates;
- Pexels mapping preserves source page URLs and rights evidence;
- `s2s search --dry-run` is byte-stable;
- built CLI smoke passes from `dist`;
- full checks pass in a clean dependency install.

Do not expose a Review API on top of invalid search/project persistence.

## 3. Non-goals

Do not implement:

- React/Vite UI;
- browser styling or component layout;
- automatic media download;
- remote URL proxying;
- video rendering, ASR, timeline, subtitles, or AI media generation;
- cloud accounts, database, mobile app, or multi-user collaboration;
- broad provider expansion beyond the already implemented M3 providers.

M4 may serve a minimal static placeholder or JSON health page, but the real UI belongs to M5.

## 4. Dependencies

Prefer Node's built-in `node:http` for M4 unless a dependency is clearly justified. If adding a dependency such as Fastify is proposed, document:

- why built-in `http` is insufficient;
- security implications;
- dependency license;
- test strategy.

No dependency should be added just for convenience.

## 5. Suggested Structure

```text
src/
├── application/
│   ├── update-scene.ts
│   ├── update-scene-queries.ts
│   ├── select-candidate.ts
│   ├── skip-scene.ts
│   └── attach-local-asset.ts
├── review/
│   ├── server.ts
│   ├── router.ts
│   ├── request-context.ts
│   ├── http-errors.ts
│   ├── json-body.ts
│   ├── multipart-upload.ts
│   ├── routes/
│   │   ├── project-routes.ts
│   │   ├── scene-routes.ts
│   │   ├── search-routes.ts
│   │   └── upload-routes.ts
│   └── security/
│       ├── loopback-host.ts
│       ├── origin-check.ts
│       ├── csrf-token.ts
│       ├── response-headers.ts
│       └── upload-policy.ts
└── cli/
    └── commands/
        └── review-command.ts
```

Keep HTTP parsing/routing in `review/`. Keep project mutation rules in `application/`.

## 6. Server Startup

Add:

```bash
s2s review <project-directory> [--host 127.0.0.1] [--port 3210] [--no-open] [--token <token>]
```

Behavior:

- Load and validate the project at startup.
- Resolve the project root once.
- Bind only to loopback by default.
- Reject non-loopback host unless a clearly named `--unsafe-host` flag exists.
- Generate a random session token when `--token` is absent.
- Print local URL and token instructions.
- `--no-open` prevents launching a browser.
- Do not open a browser in tests.

The server must shut down cleanly on `SIGINT`/`SIGTERM`.

## 7. Security Requirements

### Host and Origin

- Accept only `Host` values for the actual loopback host and port.
- Reject DNS rebinding attempts.
- For mutating requests, require an allowed `Origin` or no browser origin plus token.
- Never set wildcard CORS.

### Session Token

- Generate a random token at server start.
- Require token for all mutating requests.
- Recommended header:

```http
X-S2S-Session: <token>
```

- For GET requests, either require the token or limit data to the local session. Prefer requiring it for all `/api/*` routes.

### Headers

Set at least:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cache-Control: no-store` for API responses

### Request Limits

- JSON body size limit, default 1 MiB.
- Upload size limit, default 100 MiB or a documented smaller value.
- Request timeout.
- Method allowlist per route.

## 8. API Routes

### Health

```http
GET /api/health
```

Returns server status, project id, schema version, and server version.

### Project Read

```http
GET /api/project
```

Returns a UI-safe project view:

- project metadata;
- source metadata;
- scenes;
- candidates;
- derived statuses;
- no absolute local paths except safe relative asset paths.

### Scene Update

```http
PATCH /api/scenes/:sceneId
```

Allowed updates:

- `visualPlan.decision`
- `visualPlan.rationale`
- `visualPlan.preferredMedia`
- `visualPlan.visualKeywords`
- `review.note`

Rules:

- Validate `sceneId`.
- Reject unknown fields.
- Re-run project validation.
- Save through repository.

### Query Update

```http
PUT /api/scenes/:sceneId/queries
```

Replaces scene queries with a validated array.

Rules:

- query IDs must remain unique;
- `stock_asset` scenes need at least one enabled query;
- disabled queries are preserved but not searched;
- no candidate deletion unless explicitly requested and documented.

### Search One Scene

```http
POST /api/scenes/:sceneId/search
```

Calls the M3 search use case for exactly one scene.

Body:

```json
{
  "provider": "fixture",
  "refresh": false,
  "limit": 12
}
```

Rules:

- No arbitrary query text bypassing project query records.
- Use configured provider factory from server composition.
- Return warnings and candidate counts.

### Select Candidate

```http
PUT /api/scenes/:sceneId/selection
```

Body:

```json
{
  "candidateId": "candidate-id",
  "rightsAcknowledged": true
}
```

Rules:

- Candidate must exist in that scene.
- Persist full selected candidate snapshot.
- Record `selectedAt`.
- If rights are restricted/unclear, require acknowledgement.
- Do not download remote media.

### Skip Scene

```http
PUT /api/scenes/:sceneId/skip
```

Body:

```json
{
  "note": "No external asset needed"
}
```

Rules:

- Persist review decision `skipped`.
- Preserve candidates for audit unless explicitly cleared later.

### Upload Local Asset

```http
POST /api/scenes/:sceneId/local-asset
```

Multipart upload field:

- `file`
- optional `provenance`
- optional `note`

Rules:

- Accept only image/video types allowed by policy.
- Validate magic bytes, MIME, and extension.
- Limit file size.
- Write to `assets/<scene-id>/<safe-generated-name>`.
- Compute SHA-256.
- Persist `localAsset`.
- Do not trust client-provided paths.
- Reject symlinks/junction escapes.

## 9. Application Use Cases

Implement pure application functions:

- `updateScene`
- `replaceSceneQueries`
- `searchSceneAssets`
- `selectCandidate`
- `skipScene`
- `attachLocalAsset`

Each use case should:

1. Load project through repository.
2. Locate scene or throw not found.
3. Validate input.
4. Apply mutation on a cloned project object.
5. Update `project.updatedAt`.
6. Validate full project.
7. Save through repository.
8. Return a UI-safe view.

Avoid letting route handlers directly mutate project JSON.

## 10. Upload Safety

Local asset filenames:

- generated by the server;
- lowercase safe extension;
- no user-controlled directory segments;
- stored under `assets/<scene-id>/`.

Allowed extensions:

- images: `.jpg`, `.jpeg`, `.png`, `.webp`
- videos: `.mp4`, `.webm`, `.mov` only if MIME/magic support is implemented

Magic byte checks:

- JPEG
- PNG
- WebP
- MP4/ISO BMFF
- WebM/Matroska if supported

If magic byte validation is not implemented for a type, reject that type for M4.

## 11. Error Model

All API errors return JSON:

```json
{
  "error": {
    "code": "scene_not_found",
    "message": "Scene not found",
    "hint": "Refresh the project and try again"
  }
}
```

Status mapping:

- 400: invalid JSON/body/params
- 401: missing token
- 403: Host/Origin/token rejected
- 404: route or scene not found
- 409: conflict, invalid state transition
- 413: payload too large
- 415: unsupported media type
- 500: unexpected server error

Never return stack traces, source text dumps, API keys, absolute internal paths, or full raw provider responses.

## 12. Tests

Required tests:

- server starts on loopback;
- server rejects non-loopback host unless explicitly unsafe;
- Host header validation;
- Origin validation;
- token required for mutating requests;
- `GET /api/project` returns UI-safe view;
- invalid scene ID returns 404;
- invalid request body returns 400;
- unknown fields rejected;
- scene visual decision update persists;
- query update persists and validates stock query rule;
- selecting candidate persists immutable snapshot;
- skipping scene persists decision;
- upload rejects path traversal;
- upload rejects unsupported MIME;
- upload rejects mismatched magic bytes;
- upload writes under `assets/<scene-id>/`;
- repository write failure returns clear 500/409;
- request size limit works;
- no route accepts arbitrary absolute filesystem paths.

Add at least one dist smoke:

```bash
node dist/cli/index.js review <project> --no-open --port 0
```

If port `0` is used, expose the actual bound port in test output programmatically.

## 13. Documentation Updates

Update:

- `README.md`: add `s2s review --no-open` once implemented.
- `docs/PROJECT_SCHEMA.md`: document review decisions and local assets touched by M4.
- `docs/PRIVACY.md`: explain local server, loopback binding, remote previews, and upload handling.
- `docs/governance/SECURITY.md`: document local server security model and vulnerability reporting.
- `.env.example`: add review server defaults if needed.

## 14. Definition of Done

M4 is complete only when:

- M3 audit blocking findings are fixed.
- Review server starts and stops cleanly.
- All mutating routes require token validation.
- Host/Origin checks are tested.
- Scene updates, query updates, selection, skip, and local upload persist through repository.
- Upload path and MIME protections are tested.
- No React UI is implemented.
- Built CLI works from `dist`.
- Full checks pass:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 15. Suggested Claude Prompt

```text
请先阅读：
1. AGENTS.md
2. CLAUDE.md
3. docs/milestones/M3_CODE_AUDIT_REPORT.md
4. docs/milestones/M4_IMPLEMENTATION_PLAN.md
5. docs/PROJECT_SCHEMA.md
6. docs/PRIVACY.md
7. docs/governance/SECURITY.md

任务：
先修复 M3_CODE_AUDIT_REPORT.md 中所有 Blocking Findings，并补齐测试。
确认 init -> plan -> search -> status 的 dist CLI 烟测能写入有效候选后，再实现 M4：本地 Review Server、项目读取 API、场景更新 API、查询更新 API、当前场景搜索 API、候选选择、跳过场景、本地文件上传和安全校验。

边界：
不得实现 React/Vite UI、自动下载远程素材、视频渲染、ASR、数据库或云账户。
不得接受客户端任意绝对路径。
所有写操作必须通过 repository。
完成后保留未提交工作树，交给 Codex 审计。
```
