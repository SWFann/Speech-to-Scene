# M4 Claude Task Packs

> Created: 2026-07-15
> Executor: Claude
> Auditor: Codex
> Rule: each task below is a standalone instruction that can be sent directly to Claude.

## Cadence

不要等 Claude 把 M4 全部做完才审计。

建议节奏：

- `M4-00` 做完后审计一次：这是测试可复现门禁。
- `M4-01～M4-02` 做完后审计一次：Server skeleton + security envelope 是 M4 的安全底座。
- `M4-03～M4-04` 做完后审计一次：Read APIs + edit APIs 会影响项目数据写入边界。
- `M4-05～M4-06` 做完后审计一次：Scene search + review decision 是 Review Board 的核心交互。
- `M4-07～M4-08` 做完后做最终审计：Local asset upload + docs/smoke 是 M4 完成门禁。

如果时间紧，至少在 `M4-02`、`M4-06`、`M4-08` 后各审一次。

每次只发一条指令给 Claude。Claude 完成后，把它的最终输出交给 Codex 审计，再继续下一条。

## Shared Project Background

下面这些背景信息已经写入每条任务指令；这里集中放一份，方便维护。

项目：Speech-to-Scene

工作目录：

```text
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo
```

当前阶段：

- M1：项目骨架、Schema、CLI 基础已完成。
- M2：`script -> semantic scenes` 已完成。
- M3：`semantic scenes -> asset candidates` 已基本通过 Codex gate，仍需 Claude 在自己的环境持续报告 `pnpm test`。
- M4：目标是本地 Review Server 和 Project API，不做 React UI。

M4 项目边界：

```text
script -> semantic scenes -> asset candidates -> local review API
```

不要实现：

- rendering
- ASR
- timeline alignment
- live recording
- AI media generation
- cloud accounts
- databases
- mobile apps
- React Review Board UI

架构边界：

- Domain 不得 import filesystem、HTTP、React、model SDK、asset-provider。
- Application services 依赖 interfaces，不依赖 concrete infrastructure。
- CLI 是 composition root，可以组装 concrete providers / repositories / caches。
- React 未来只调用本地 API，不直接访问 filesystem。
- 每次项目写入必须经过 repository 和 atomic-write。
- 所有外部输入都是 `unknown`，必须 Zod validate 后使用。
- 单元测试不能调用真实外部服务。

必跑检查：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

如果 `pnpm test` 不能运行，必须报告真实原因，不得声称测试通过。

---

## M4-00: Test Reproducibility Gate

```text
请执行 Speech-to-Scene M4-00：测试可复现门禁。

项目背景：
这是一个本地优先的口播稿视觉素材规划工具。当前 M3 已经基本完成：CLI 可以执行 init -> plan -> search -> status，并能用 fixture provider 生成 asset candidates。接下来准备进入 M4，也就是本地 Review Server 和 Project API。M4 之前必须确认测试环境可复现。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请先阅读并以以下文档为准：
1. AGENTS.md
2. docs/milestones/M3_FINAL_GATE_AUDIT_REPORT.md
3. docs/milestones/M3_REAUDIT_REPORT.md
4. docs/milestones/M4_IMPLEMENTATION_PLAN.md
5. package.json
6. pnpm-lock.yaml

任务目标：
确认 pnpm test 在你的环境中可复现。如果不能复现，修复依赖安装/lockfile/环境问题，但不要改产品功能。

当前已知情况：
Codex 当前环境可以通过 format/lint/typecheck/build，但 Vitest 启动失败，原因是 node_modules 里只有 @rolldown/binding-linux-x64-gnu，缺少 Windows 环境需要的 @rolldown/binding-win32-x64-msvc。

要求：
1. 只做 M4-00，不要开始 M4 server/API。
2. 先运行 pnpm test，记录真实结果。
3. 如果测试失败，判断是代码问题还是依赖安装问题。
4. 如果是依赖问题，请通过 pnpm install / lockfile / packageManager 的正确方式修复。
5. 不要手动提交 native binary。
6. 不要引入无关依赖。
7. 不要修改业务逻辑来绕过测试。

验收标准：
- pnpm test 能在你的环境运行，并报告通过/失败的真实摘要。
- 如果修改 lockfile，说明为什么。
- 如果仍不能修复，明确阻塞原因和下一步建议。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-00 后停止，不要继续 M4-01。把结果交给 Codex 审计。
```

---

## M4-01: Review Server Skeleton and CLI Command

```text
请执行 Speech-to-Scene M4-01：实现 Review Server 骨架和 s2s review CLI 命令。

项目背景：
Speech-to-Scene 的 Phase 1 范围是：
script -> semantic scenes -> asset candidates -> local review board
当前 M3 已能通过 CLI 生成 scenes 和 asset candidates。M4 要提供本地 Review Server 和 Project API，供未来 M5 React Review Board 调用。本任务只做 server skeleton，不做具体业务 mutation API。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请先阅读并以以下文档为准：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/PROJECT_SCHEMA.md
4. docs/VISUAL_GRAMMAR.md
5. docs/ASSET_LICENSING.md
6. src/cli/index.ts
7. src/cli/commands/search-command.ts
8. src/cli/command-context.ts

任务目标：
新增 `s2s review <project-directory>` 命令，并启动一个最小本地 HTTP server。该 server 只提供 health endpoint，为后续 API 打地基。

要求：
1. 只做 M4-01，不要实现 M4-02 或后续安全/业务 API。
2. 使用 Node 内置 `node:http`，除非有非常明确理由，否则不要新增 Web 框架依赖。
3. CLI 命令：
   - `s2s review <project-directory>`
   - `--host <host>`，默认 `127.0.0.1`
   - `--port <port>`，默认 `3210`
   - `--no-open`
   - `--token <token>`，可选；没有则生成随机 token
4. 默认必须绑定 `127.0.0.1`。
5. 新增 GET `/api/health`，返回 JSON：
   - ok
   - projectRoot
   - host
   - port
   - version 或 server 标识
6. server 启动时固定 project root，后续请求不得重新选择任意路径。
7. 不实现 React/static UI。
8. 不实现 project read/write API。
9. 不实现 upload。
10. 不调用外部服务。

建议文件结构：
- src/review/review-server.ts
- src/review/review-types.ts
- src/cli/commands/review-command.ts
- tests/unit/cli-review.test.ts
- tests/unit/review-server.test.ts

验收标准：
- `s2s review --help` 能正常显示。
- `s2s review <project> --no-open` 能启动本地 server。
- GET `/api/health` 返回 JSON。
- 测试能启动和关闭 server，不留下悬挂进程。
- 默认 host 是 127.0.0.1。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-01 后停止，把结果交给 Codex 审计。不要继续 M4-02。
```

---

## M4-02: Security Envelope and Request Utilities

```text
请执行 Speech-to-Scene M4-02：为 Review Server 增加安全外壳和请求工具。

项目背景：
M4 Review Server 是本地工具，但本地 HTTP server 仍然需要防 DNS rebinding、恶意网页跨源请求、任意 Host、过大 body 和 JSON 注入等问题。未来 M5 React UI 会调用这些 API，因此安全边界必须在 M4 API 层先建立。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请先阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md
4. src/review/review-server.ts
5. src/cli/commands/review-command.ts
6. tests/unit/review-server.test.ts

任务目标：
在 M4-01 server 骨架上增加通用安全层和请求/响应工具，但不新增业务 mutation endpoints。

要求：
1. 只做 M4-02。
2. 不实现 project read/write API。
3. Host allowlist：
   - 允许 `127.0.0.1`
   - 允许 `localhost`
   - 允许显式配置的 host
   - 拒绝可疑 Host
4. Origin validation：
   - mutating requests 必须校验 Origin
   - 只允许本地同源/配置允许来源
5. Session token：
   - mutating requests 必须带 `X-S2S-Session`
   - token 不正确返回 401/403 JSON error
6. JSON parser：
   - 所有 body 先作为 unknown
   - 设置 body size limit
   - malformed JSON 返回结构化错误
7. Security headers：
   - Content-Security-Policy
   - X-Content-Type-Options: nosniff
   - Referrer-Policy
   - Cache-Control: no-store for API
8. 统一 JSON error model，后续 endpoints 复用。

建议文件：
- src/review/http-security.ts
- src/review/http-json.ts
- src/review/review-errors.ts
- tests/unit/review-security.test.ts

验收标准：
- Host 攻击请求被拒绝。
- 缺 token 的 mutating request 被拒绝。
- 错 token 的 mutating request 被拒绝。
- malformed JSON 返回 JSON error。
- body too large 返回 JSON error。
- health/read-only 请求不需要 session token。
- API 响应带安全 headers。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-02 后停止。M4-01～M4-02 是一个安全底座审计点，请交给 Codex 综合审计。
```

---

## M4-03: Read-only Project API

```text
请执行 Speech-to-Scene M4-03：实现只读 Project API。

项目背景：
M4 的目标是让未来 Review Board 能通过本地 API 查看项目、场景、候选素材和审核状态。当前 M3 已将项目数据保存在 project.s2s.json，Zod project schema 是持久化数据的唯一事实源。本任务只做 read-only API，不做任何写入。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请先阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/PROJECT_SCHEMA.md
4. src/domain/project-schema.ts
5. src/domain/scene-schema.ts
6. src/domain/project-status.ts
7. src/infrastructure/json-project-repository.ts
8. src/application/get-project-status.ts
9. src/review/*

任务目标：
新增只读 API，让客户端能读取项目和场景数据，返回未来 UI 可用的 safe view model。

要求：
1. 只做 M4-03，不实现 mutation。
2. 实现：
   - GET `/api/project`
   - GET `/api/scenes`
   - GET `/api/scenes/:sceneId`
3. 所有读取必须通过 repository。
4. 加载出的 project 必须经过 Zod schema validation。
5. 返回 safe view，不暴露不必要的绝对路径。
6. 返回 scene search summary：
   - query count
   - candidate count
   - lastSearchedAt
   - review kind
   - derived scene status
7. scene not found 返回结构化 JSON error。
8. 不接受客户端传入任意 filesystem path。

验收标准：
- GET project 返回项目基础信息、status、scene summary。
- GET scenes 返回按 order 排序的 scene 列表。
- GET single scene 返回 scene detail 和 candidates。
- invalid project file 返回结构化错误。
- 响应不泄露任意绝对 filesystem path。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-03 后停止，交给 Codex 审计后再继续 M4-04。
```

---

## M4-04: Scene Edit APIs

```text
请执行 Speech-to-Scene M4-04：实现 Scene 编辑 API。

项目背景：
Review Board 需要允许用户人工调整每个 scene 的视觉决策和搜索 query。M4-03 已提供只读 API，本任务开始写入项目数据。项目写入必须严格经过 repository 和 atomic-write，不能绕过 schema。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/PROJECT_SCHEMA.md
4. docs/VISUAL_GRAMMAR.md
5. src/domain/scene-schema.ts
6. src/domain/project-schema.ts
7. src/infrastructure/json-project-repository.ts
8. src/review/*

任务目标：
实现两个 mutating endpoints：
1. PATCH `/api/scenes/:sceneId/visual-plan`
2. PUT `/api/scenes/:sceneId/queries`

要求：
1. 只做 M4-04。
2. 所有 mutating requests 必须要求 `X-S2S-Session`。
3. request body 必须用 Zod 校验。
4. 外部输入先视为 unknown。
5. 加载 project -> 修改 owned/cloned object -> 更新 `project.project.updatedAt` -> validate full project -> repository.save。
6. 不允许直接写 project.s2s.json。
7. visual decision 必须符合 schema 和 VISUAL_GRAMMAR。
8. query replacement 必须保留 enabled/language/query/purpose 的 schema 约束。
9. invalid body 不得保存。
10. unknown scene 不得保存。

验收标准：
- 合法 visual-plan update 成功保存。
- 非法 visual-plan 被拒绝。
- 合法 query replacement 成功保存。
- enabled false 的 query 能被保留。
- updatedAt 会更新。
- 缺 token / 错 token 被拒绝。
- 保存前 validation 失败时文件不改变。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-04 后停止。M4-03～M4-04 是数据读写边界审计点，请交给 Codex 综合审计。
```

---

## M4-05: Single-scene Search API

```text
请执行 Speech-to-Scene M4-05：实现单 Scene 搜索 API。

项目背景：
M3 已有 `searchProjectAssets` use case 和 `s2s search` CLI，可对项目 scene 搜索素材候选。Review Board 需要在用户调整 scene/query 后，只重新搜索一个 scene，而不是整个项目。本任务要复用 M3 use case，不要复制搜索逻辑。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/milestones/M3_FINAL_GATE_AUDIT_REPORT.md
4. src/application/search-project-assets.ts
5. src/application/ports/asset-provider.ts
6. src/application/ports/search-cache.ts
7. src/cli/commands/search-command.ts
8. src/providers/fixture/fixture-asset-provider.ts
9. src/providers/pexels/pexels-asset-provider.ts
10. src/review/*

任务目标：
实现 POST `/api/scenes/:sceneId/search`，让本地 API 能对一个 scene 执行素材搜索。

要求：
1. 只做 M4-05。
2. 必须复用 `searchProjectAssets`。
3. 必须传入 sceneId，只搜索一个 scene。
4. request body 用 Zod validate，支持：
   - provider
   - refresh
   - limit
5. 复用或抽取 provider/cache composition，避免 CLI 和 Review Server 重复大量 provider 构造逻辑。
6. cache 路径仍必须在 `<projectRoot>/cache/search/<provider>` 下。
7. 不调用真实外部服务的单元测试必须使用 fixture/mock。
8. 返回更新后的 scene search summary 和 candidate count。

验收标准：
- fixture provider 单 scene search 成功。
- unknown scene 返回结构化错误。
- invalid provider 返回结构化错误。
- disabled queries 行为与 M3 use case 一致。
- non-stock_asset scene 行为明确且有测试。
- cache 仍写在项目目录下。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-05 后停止，交给 Codex 审计后再继续 M4-06。
```

---

## M4-06: Review Decision APIs

```text
请执行 Speech-to-Scene M4-06：实现审核决策 API。

项目背景：
M4 Review Server 的核心用途是让用户人工选择每个 scene 的素材候选，或者跳过该 scene。M3 已经能产生 candidates，M4-05 已提供单 scene search。现在需要把用户决策写回 project.s2s.json。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/PROJECT_SCHEMA.md
4. docs/ASSET_LICENSING.md
5. src/domain/scene-schema.ts
6. src/domain/asset-schema.ts
7. src/domain/project-status.ts
8. src/review/*

任务目标：
实现两个 mutating endpoints：
1. PUT `/api/scenes/:sceneId/selection`
2. PUT `/api/scenes/:sceneId/skip`

要求：
1. 只做 M4-06。
2. 必须要求 `X-S2S-Session`。
3. request body 必须 Zod validate。
4. selection 必须引用当前 scene 中已存在的 candidate。
5. 不允许选择其他 scene 的 candidate。
6. skip 应保留 search candidates，只更新 review decision。
7. 写入 decidedAt。
8. 更新 project.project.updatedAt。
9. 保存前 validate full project。
10. 保存必须通过 repository。

验收标准：
- 可以选择一个已有 candidate。
- 选择不存在的 candidate 被拒绝。
- skip scene 成功。
- 缺 token / 错 token 被拒绝。
- GET APIs 能反映 selection/skip 后的新状态。
- 不破坏 rights/licensing metadata。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-06 后停止。M4-05～M4-06 是 Review 核心交互审计点，请交给 Codex 综合审计。
```

---

## M4-07: Local Asset Upload API

```text
请执行 Speech-to-Scene M4-07：实现本地素材上传/挂载 API。

项目背景：
Phase 1 明确采用 human-in-the-loop：系统推荐素材候选，但用户可以手动下载免费/开源素材，然后把本地素材挂载到 scene。M4 的本地 API 需要支持安全上传或挂载本地素材，但绝不能允许客户端传入任意 filesystem path。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/PROJECT_SCHEMA.md
4. docs/ASSET_LICENSING.md
5. src/domain/scene-schema.ts
6. src/domain/asset-schema.ts
7. src/infrastructure/project-paths.ts
8. src/review/*

任务目标：
实现 POST `/api/scenes/:sceneId/local-asset`，把用户上传的本地图片/视频安全保存到项目 assets 目录，并更新 scene review state。

要求：
1. 只做 M4-07。
2. 必须要求 `X-S2S-Session`。
3. 不接受客户端传入任意 filesystem path。
4. 只能由 server 生成安全文件名。
5. 文件必须保存到 `assets/<scene-id>/` 下。
6. 防 path traversal。
7. 限制 body size。
8. 限制 extension/MIME allowlist。
9. 必须做 magic byte validation。
10. 如果某种媒体类型还没有 magic byte validation，M4 阶段直接拒绝该类型。
11. 保存文件后更新 scene.review：
    - 根据 schema 使用 local_asset_attached，或 candidate_selected.localAsset。
12. 更新 project.project.updatedAt。
13. 保存 project 必须通过 repository。

验收标准：
- 支持至少一种安全图片类型，例如 PNG 或 JPEG。
- valid upload 成功写入 assets/<scene-id>/。
- oversized upload 被拒绝。
- wrong magic bytes 被拒绝。
- path traversal filename 不会影响保存路径。
- unknown scene 被拒绝。
- 缺 token / 错 token 被拒绝。
- project.s2s.json 更新符合 schema。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-07 后停止，交给 Codex 审计后再继续 M4-08。
```

---

## M4-08: Final Integration, Docs, and Smoke

```text
请执行 Speech-to-Scene M4-08：M4 最终集成、文档和 smoke 验证。

项目背景：
M4 的目标是完成本地 Review Server 和 Project API，为 M5 React Review Board 做准备。本任务不新增大功能，只做最终集成、文档、help、smoke 和范围核查。

工作目录：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

执行前请阅读：
1. AGENTS.md
2. docs/milestones/M4_IMPLEMENTATION_PLAN.md
3. docs/PROJECT_SCHEMA.md
4. README.md
5. src/cli/index.ts
6. src/review/*
7. tests/unit/review*.test.ts

任务目标：
完成 M4 的最终 polish 和验收材料。

要求：
1. 只做 M4-08。
2. 不实现 React UI。
3. 不实现 rendering/ASR/timeline/AI generation/cloud/database/mobile。
4. 更新 README，加入：
   - `s2s review ./demo --no-open`
   - 本地 API 简要说明
   - 安全提示：默认 127.0.0.1、session token
5. 如果 M4 改动了 review/local asset schema 语义，同步 docs/PROJECT_SCHEMA.md。
6. 添加或记录 M4 smoke steps。
7. 验证 help：
   - s2s --help
   - s2s review --help
   - s2s search --help
8. 跑完整本地流程：
   - init
   - plan fixture
   - search fixture
   - review --no-open
   - GET /api/health
   - GET /api/project
   - 至少一个 mutating API
9. 检查没有新增秘密、下载素材、缓存、日志或用户项目文件进入仓库。

验收标准：
- M4 API 可由未来 React UI 使用。
- README 能指导用户启动本地 review server。
- smoke flow 有真实输出摘要。
- 所有 M4 endpoints 有测试覆盖。
- 项目范围没有越界。

完成后必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

停止点：
完成 M4-08 后停止，交给 Codex 做 M4 最终综合审计。
```
