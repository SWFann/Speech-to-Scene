# AI Task and Audit Playbook

> Purpose: help a fresh Codex or Claude conversation quickly understand how this project is being built, audited, and handed off.
> Last updated: 2026-07-16 (M6-03 final release closure).

## 1. Project Snapshot

Project name: Speech-to-Scene.

Repository:

```text
git@github.com:SWFann/Speech-to-Scene.git
```

Windows workspace:

```text
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo
```

WSL workspace:

```text
/mnt/f/工作盘/实习经历汇总/星星之火-创业/口播/Demo
```

Current Linux workspace used for faster npm/pnpm work:

```text
/home/root/SpeechToScene
```

Preferred execution environment:

```text
WSL Ubuntu2 through SSH alias Ubuntu2-Codex
Node.js v24.x
pnpm 11.7.0
```

The current implementation is Phase 1 only:

```text
script -> semantic scenes -> asset candidates -> local review API
       -> manual download and local asset attachment
```

Do not implement:

- rendering;
- ASR;
- timeline alignment;
- live recording;
- AI media generation;
- cloud accounts;
- databases;
- mobile apps;
- React Review Board UI is now in scope as of M5.

## 2. Source of Truth Files

Before architectural or milestone work, read:

```text
AGENTS.md
docs/planning/Speech-to-Scene_Phase1_Demo_Execution_Plan.md
docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md
docs/PROJECT_SCHEMA.md
docs/VISUAL_GRAMMAR.md
docs/ASSET_LICENSING.md
docs/development/ENVIRONMENT.md
docs/milestones/M4_IMPLEMENTATION_PLAN.md
docs/milestones/M4_CLAUDE_TASK_PACKS.md
web/src/App.tsx
web/src/api/review-api.ts
web/vite.config.ts
src/review/static-serving.ts
src/review/review-server.ts
src/cli/commands/review-command.ts
src/cli/commands/validate-command.ts
src/cli/commands/status-command.ts
src/planner/stepfun-script-planner.ts
```

The persisted project schema is the single source of truth. Do not loosen the schema merely to make an API easier to implement.

## 3. Role Split

Claude is the implementation executor.

Claude should:

- implement one bounded task at a time;
- stop at the requested milestone boundary;
- report modified files and real command results;
- avoid commit and push unless explicitly instructed after audit;
- not broaden scope into React UI, rendering, ASR, cloud, database, or media generation.

Codex is the auditor and release gate.

Codex should:

- inspect code, not only trust Claude's report;
- run or verify checks in WSL/Ubuntu2 when possible;
- prioritize P0/P1 bugs and missing tests;
- produce the next Claude task only after audit;
- commit and push only after audit passes and the user authorizes it.

## 4. Task Context Packaging Rule

Every task sent to Claude must be self-contained enough for a brand-new Claude conversation.

Do not assume Claude has access to earlier chat history, Codex's audit notes, or previous task reports unless they are pasted into the new instruction. Each task instruction must include detailed project background and handoff context, not only the immediate fix request.

At minimum, every Claude task must restate:

- project name, repository, branch, and exact WSL working directory;
- Phase 1 scope and explicit non-goals;
- current milestone and completed prerequisite milestones;
- the last relevant Codex audit result, including P0/P1/P2 findings when applicable;
- current known working-tree expectation, for example "M4-04B changes are uncommitted";
- exact task boundary and stop point;
- required source-of-truth documents to read;
- relevant production files and tests to inspect;
- architecture rules, especially Domain/Application/HTTP/repository boundaries;
- security rules for any Review Server/API task;
- exact behavior and error mapping expectations;
- required checks and final report format;
- explicit "do not commit" and "do not push" unless this is a Codex-authorized release task.

When Codex writes a fix instruction, it must also include the failed audit context:

- the task ID that failed audit;
- each P0/P1 finding with file/line or behavior reference;
- why the behavior is risky;
- the narrow repair scope;
- the tests that must be added or changed;
- the checks that must be rerun.

Good Claude tasks should be long enough to prevent context loss. It is better to repeat essential background than to send a short instruction that depends on hidden conversation history.

## 5. Current Historical Progress

This section summarizes the work completed across the current development thread.

### Project Setup and Planning

- The project requirements were analyzed from the Phase 1 execution plan.
- The project was scoped as a TypeScript/Node CLI and local API project.
- The repository was connected to `git@github.com:SWFann/Speech-to-Scene.git`.
- Documentation was reorganized so planning/governance/milestone files live under `docs/`.
- The user asked why Java was not used; the decision remained TypeScript/Node because the project is CLI/API/local review oriented, with strong schema validation and future web UI alignment.

### M1

M1 established:

- project skeleton;
- Zod schema;
- repository and atomic write path;
- CLI base commands;
- initial project status behavior;
- tests and fixtures.

M1 was implemented by Claude and audited by Codex.

### M2

M2 established:

- script planning pipeline;
- fixture planner;
- DeepSeek-compatible planner boundary;
- source blocks and scene generation logic;
- planning tests.

M2 was implemented by Claude and audited by Codex.

### M3

M3 established:

- asset provider ports;
- fixture asset provider;
- Pexels provider/client;
- search use case;
- file search cache;
- `s2s search` CLI;
- project persistence of asset candidates;
- cache and provider hardening.

M3 required several P0/P1 fixes around corrupted tests, candidate schema validity, cache completeness, application/infrastructure boundaries, Pexels mapping, CLI options, and dry-run behavior.

### M4 Through M4-03FR

M4-00 verified test reproducibility.

M4-01 added:

- local review server skeleton;
- `s2s review`;
- `GET /api/health`;
- token generation and lifecycle handling.

M4-02 added:

- Host validation;
- Origin validation;
- session token validation;
- request security gates;
- common JSON response helpers;
- security headers.

M4-03 added:

- UI-safe `getReviewProject` use case;
- `GET /api/project`;
- token-gated project read API;
- production repository error mapping.

M4-03FR fixed:

- `originalFileName` absolute path leakage;
- production error taxonomy for project load failures;
- stale dist smoke risks;
- safe filename edge cases;
- unknown repository error mapping tests.

M4-03FR was audited, committed, and pushed.

Last known pushed commit:

```text
ab536297d67e218a564ff6ddc38feb5dd50c16c4
feat: implement phase 1 demo pipeline and review API
```

### M4-04A

M4-04A added application use cases:

- `updateScene`;
- `updateSceneQueries`;
- `SceneNotFoundError`;
- `ProjectConflictError`.

Codex audit result:

- no P0/P1 blockers;
- WSL checks passed;
- full test count observed by Codex: `39 files / 676 tests`.

P2 notes from audit:

- `patch: { visualPlan: {} }` can become a no-op save unless HTTP layer rejects it;
- replacing query IDs while preserving existing candidates can invalidate `matchedQueryId`, so HTTP mapping should return stable `409 conflict`.

At the time this playbook was written, the working tree may contain uncommitted M4-04A and/or M4-04B changes. A new conversation must start with `git status --short`.

### M5

M5-00 established the React project scaffold:

- `web/` directory with Vite + React 19 + TypeScript configuration.
- `web/src/api/review-api.ts` — typed API client with session token handling.
- `web/vite.config.ts` — Vite config with `/api` proxy to local review server.
- `web/tsconfig.json` — separate tsconfig for the web project.
- `package.json` scripts: `web:build`, `web:dev`, `web:preview`.
- Typecheck includes `web/tsconfig.json`.

M5-02 implemented the React Review Board UI:

- `web/src/App.tsx` — main application component with full review workflow.
- `web/src/components/` — TopBar, SceneList, SceneDetail, Inspector, ErrorView, ActionError, LocalAssetUpload.
- Scene list with active scene selection.
- Scene detail with candidate thumbnails, select/skip/search actions.
- Local asset upload (PNG/JPEG) with provenance.
- Rights acknowledgement conflict flow (409 → confirm dialog).
- Session token input with URL `?token=` extraction and localStorage persistence.
- Error handling with UI-safe messages (no token/path/stack leakage).
- All API calls go through `ReviewApiClient` — React never accesses the filesystem directly.

M5-03 added static serving + smoke + docs:

- `src/review/static-serving.ts` — static file serving with multi-layer path traversal protection, MIME type mapping, SPA fallback, missing-build 503 page.
- `src/review/review-server.ts` — integrated static serving after API route matching fails (API paths never enter static serving).
- `src/cli/commands/review-command.ts` — passes `staticRoot` (defaults to `web/dist`), adds `Review:` URL line with `?token=`.
- `src/review/review-types.ts` — `staticRoot` added to `ReviewServerConfig`.
- `tests/unit/review-static.test.ts` — path traversal, MIME types, SPA fallback, missing build, API priority.
- `tests/unit/dist-smoke-project.test.ts` — static serving smoke test (GET / returns HTML, API still works).
- `package.json` — `build:all` script (`pnpm build && pnpm web:build`).
- Documentation updates: README.md, PRIVACY.md, SECURITY.md.

M5-03 status: implementation complete, pending Codex audit.

## 6. WSL and SSH Procedure

Use WSL/Ubuntu2 as the authoritative environment.

Basic connection check:

```bash
ssh Ubuntu2-Codex "cd /mnt/f/工作盘/实习经历汇总/星星之火-创业/口播/Demo && pwd && node --version && pnpm --version"
```

Expected shape:

```text
/mnt/f/工作盘/实习经历汇总/星星之火-创业/口播/Demo
v24.x
11.7.0
```

Run commands through WSL:

```bash
ssh Ubuntu2-Codex "cd /mnt/f/工作盘/实习经历汇总/星星之火-创业/口播/Demo && pnpm test"
```

Important dependency warning:

- Windows and WSL share the same project folder, but should not share a single `node_modules` state.
- Native packages may flip between Windows and Linux bindings.
- If pnpm reports `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, run in WSL:

```bash
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
```

If a Windows/WSL file lock causes `EACCES` during install, retry once. Do not delete `node_modules` unless explicitly approved or clearly safe.

## 7. Required Checks

For implementation tasks, Claude must run and report:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For review server/API tasks after M4-03FR, also run:

```bash
pnpm test:dist-smoke
```

Codex should independently verify at least:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

When a task modifies dist smoke or review server lifecycle, also verify:

```bash
pnpm test:dist-smoke
```

Do not claim success without command evidence.

## 8. Claude Task Instruction Template

Use this template when assigning a new task to Claude.

```text
请执行 Speech-to-Scene <TASK_ID>：<TASK_TITLE>。

重要背景：
项目：Speech-to-Scene
仓库：git@github.com:SWFann/Speech-to-Scene.git
当前分支：main
WSL 工作目录：
/mnt/f/工作盘/实习经历汇总/星星之火-创业/口播/Demo

本任务必须能在 Claude 新开对话中独立执行。请不要依赖任何未粘贴的历史聊天记录。

当前阶段：
- M1：项目骨架、Schema、Repository、CLI 基础已完成
- M2：script -> semantic scenes 已完成
- M3：semantic scenes -> asset candidates 已完成
- M4：local Review Server and Project API 已完成
- M5：React Review Board UI 和静态服务正在实现

Phase 1 范围：
script -> semantic scenes -> asset candidates -> local review API
       -> manual download and local asset attachment

Phase 1 禁止扩张：
- 不做 rendering / ASR / timeline alignment / live recording
- 不做 AI media generation
- 不做 cloud accounts / databases / mobile apps
- 不做 React Review Board UI 扩展，除非任务明确要求（M5 已实现核心 UI）

上一次 Codex 审计/项目状态：
<粘贴最近一次相关审计结论，例如通过/不通过、P0/P1/P2、已知工作树状态、最后提交哈希>

本任务范围：
<明确说明只做什么>

禁止事项：
- 不做 React UI 扩展，除非任务明确要求（M5 已实现核心 UI）
- 不做 rendering / ASR / timeline / live recording
- 不做 AI media generation
- 不做 cloud account / database / mobile app
- 不调用真实外部服务的单元测试
- 不引入无关依赖
- 不 commit
- 不 push

开始前必须执行：
git status --short

如果工作树包含无关改动，停止并报告。

必须阅读：
1. AGENTS.md
2. docs/development/AI_TASK_AND_AUDIT_PLAYBOOK.md
3. <任务相关文档>
4. <任务相关源码>
5. <任务相关测试>

任务目标：
1. <目标 1>
2. <目标 2>
3. <目标 3>

架构要求：
1. Domain 不得 import filesystem、HTTP、React、model SDK、provider code。
2. Application services 依赖 interfaces，不依赖 concrete infrastructure。
3. HTTP 层只做 route、security、parse、error mapping。
4. 所有外部输入都是 unknown，必须 Zod validate 后使用。
5. 所有项目写入必须经过 repository.save。
6. 不得绕过 project schema。

行为要求：
1. <详细行为规则>
2. <详细错误规则>
3. <安全要求>

测试要求：
至少覆盖：
1. <成功路径>
2. <失败路径>
3. <安全路径>
4. <持久化验证>
5. <不泄露敏感信息>

必须运行并报告：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
<如涉及 review/dist> pnpm test:dist-smoke

最终报告必须包含：
1. 修改文件列表
2. 行为说明
3. 错误映射说明
4. 测试结果
5. 未解决问题

停止点：
完成 <TASK_ID> 后停止。
不要开始下一任务。
不要 commit。
不要 push。
```

## 9. Claude Final Report Template

Ask Claude to report in this format.

```text
<TASK_ID> 完成报告

1. 修改文件列表

| 文件 | 操作 | 说明 |
|---|---|---|
| ... | 新增/修改 | ... |

2. 实现摘要

- ...

3. 行为规则

- ...

4. 错误映射

| 场景 | HTTP/Application Error | Code |
|---|---|---|
| ... | ... | ... |

5. 测试摘要

- 新增测试文件：
- 新增测试数：
- 关键覆盖：

6. 检查结果

| 检查 | 结果 |
|---|---|
| pnpm format:check | PASS/FAIL |
| pnpm lint | PASS/FAIL |
| pnpm typecheck | PASS/FAIL |
| pnpm test | PASS/FAIL + test count |
| pnpm build | PASS/FAIL |
| pnpm test:dist-smoke | PASS/FAIL, if applicable |

7. 明确声明

- 未开始下一任务。
- 未 commit。
- 未 push。
- 未解决问题：...
```

## 10. Codex Audit Procedure

Use this flow whenever Claude reports a completed task.

### Step 1: Establish Context

Run:

```bash
git status --short
git diff --stat
git diff -- <relevant files>
```

Check:

- only expected files changed;
- no unrelated generated files;
- no `node_modules`, `dist`, caches, logs, `.env`, downloaded media, or user projects;
- no unexpected broadened scope.

### Step 2: Read Production Code

Look for:

- architecture boundary violations;
- Domain importing forbidden layers;
- Application importing concrete infrastructure;
- HTTP layer directly mutating project data;
- missing `unknown` validation;
- repository writes outside `repository.save`;
- raw filesystem path leaks;
- raw provider/API responses stored or returned;
- token/API key leakage;
- stale or partial DTOs.

### Step 3: Read Tests

Do not trust test counts alone.

Check:

- happy path;
- failure path;
- unknown fields;
- malformed inputs;
- security gates;
- persistence;
- no-op writes;
- stale dist artifacts;
- real production repository behavior where needed;
- fake tests are not hiding production bugs.

### Step 4: Run Checks

In WSL:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If applicable:

```bash
pnpm test:dist-smoke
```

If WSL dependencies are broken:

```bash
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
```

### Step 5: Classify Findings

Use this severity scale:

- P0: must fix before continuing. Data corruption, security bypass, broken main workflow, failing required check.
- P1: should fix before next milestone. Production behavior mismatch, missing critical tests, unsafe error mapping, stale dist verification.
- P2: acceptable short-term but should be tracked. Edge-case no-op, weaker wording, test/report mismatch.
- P3: style/docs polish.

### Step 6: Decide Gate

If P0/P1 exists:

- do not approve;
- do not commit;
- give Claude a focused fix instruction.

If only P2/P3 exists:

- approve with notes;
- give next task instruction.

## 11. Codex Audit Response Template

```text
审计结论：<通过/不通过/有条件通过>。

P0/P1 Findings:
- <如果没有，写“未发现 P0/P1 阻塞问题。”>

P2/P3 Notes:
- ...

我在 WSL/Ubuntu2 复验：
- pnpm format:check: PASS/FAIL
- pnpm lint: PASS/FAIL
- pnpm typecheck: PASS/FAIL
- pnpm test: PASS/FAIL, count
- pnpm build: PASS/FAIL
- pnpm test:dist-smoke: PASS/FAIL, if applicable

工作树状态：
- <clean / only expected files / unexpected files>

下一步：
- <给 Claude 的下一条任务或修复指令>
```

## 12. Fix Instruction Template

Use this when audit finds blockers.

```text
请执行 <TASK_ID>F：修复 Codex 审计发现。

背景：
Codex 审计 <TASK_ID> 未通过，发现以下问题：

P0/P1:
1. <问题，文件/行为/风险>
2. <问题，文件/行为/风险>

本任务只修复上述问题。
不要开始下一 milestone。
不要重构无关代码。
不要 commit。
不要 push。

修复要求：
1. <具体要求>
2. <测试要求>
3. <错误映射要求>

必须运行：
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
<如适用> pnpm test:dist-smoke

最终报告：
- 修改文件列表
- 每个审计问题如何修复
- 新增/修改测试
- 检查结果
- 明确未开始下一任务
```

## 13. Commit and Push Protocol

Only commit and push after Codex audit passes and the user asks for it.

Pre-commit checklist:

```bash
git status --short
git ls-files --others --exclude-standard
```

Verify no forbidden content:

```text
node_modules/
dist/
.env
.env.*
cache/
logs/
downloaded media
user project files
API keys
```

Run checks before commit:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:dist-smoke
```

Stage and commit:

```bash
git add -A
git status --short
git commit -m "<message>"
```

Push:

```bash
git push origin main
```

After push, verify:

```bash
git status --short
git log --oneline -1
git ls-remote origin refs/heads/main
```

Final commit report should include:

- branch;
- commit hash;
- commit message;
- push result;
- final `git status --short`;
- checks that passed.

## 14. M4–M5 Task Cadence

M4 cadence (all completed and committed):

```text
M4-04B -> Codex audit ✓
M4-05  -> Codex audit ✓
M4-06  -> Codex audit ✓
M4-07  -> Codex audit ✓
M4-08  -> final M4 audit ✓
```

M5 cadence:

```text
M5-00  -> React scaffold ✓ (committed)
M5-02  -> Review Board UI ✓ (committed)
M5-03  -> Static serving + smoke + docs ✓ (committed)
```

M6 cadence:

```text
M6-01  -> s2s validate ✓ (committed)
M6-02  -> enhanced s2s status ✓ (committed)
M6-03  -> StepFun planner + final release docs + smoke closure (current)
```

M6-03 security notes:

- StepFun provider uses OpenAI-compatible API with `STEP_API_KEY`, `STEP_BASE_URL`, and `STEP_MODEL`.
- The default StepFun model is `step-3.7-flash`.
- Real API keys may exist only in ignored local `.env` files or shell environment variables.
- Do not paste or commit real API keys in reports, docs, fixtures, snapshots, logs, or terminal output.
- CI and deterministic smoke should use `fixture`, not live StepFun.

## 15. M4-04B Known Requirements

M4-04B should expose:

```http
PATCH /api/scenes/:sceneId
PUT /api/scenes/:sceneId/queries
```

Important audit points:

- token required;
- Host gate runs before route/body parse;
- Origin validation applies;
- malformed JSON returns `400 invalid_json`;
- input validation returns `400 invalid_request`;
- `SceneNotFoundError` maps to `404 not_found`;
- `ProjectConflictError` maps to `409 conflict`;
- `ProjectValidationError` maps to `409 conflict`;
- query replacement that invalidates existing candidate `matchedQueryId` maps to `409 conflict`;
- `visualPlan: {}` should be rejected as `400 invalid_request`;
- success returns `ReviewProjectView`, not raw project;
- dist smoke proves PATCH/PUT persist and GET reflects changes.

## 16. Quick Start for a New Codex Conversation

Paste this into a new Codex conversation:

```text
请先阅读 docs/development/AI_TASK_AND_AUDIT_PLAYBOOK.md。

当前项目路径：
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo

WSL 路径：
/mnt/f/工作盘/实习经历汇总/星星之火-创业/口播/Demo

请通过 SSH alias Ubuntu2-Codex 在 WSL 中审计。

第一步：
git status --short

然后根据当前工作树判断：
1. 如果 Claude 刚完成任务，请按 playbook 审计。
2. 如果审计通过，请给出下一步 Claude 指令。
3. 如果用户要求提交，请先跑完整 checks，再 commit/push。
```
