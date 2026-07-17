# 前端一键流 + API Key 前端化 实现计划（步骤 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让非技术用户一行命令启动后，在浏览器上传文稿、一键切片并搜索素材、审核，外部 API Key 在前端配置后端持久化。

**Architecture:** 复用现有 `createProject / planProject / searchProjectAssets` use case，只新增 HTTP 端点挂到 Review Server；新增 `SettingsStore`（workspace 级 `.s2s/settings.json`）让 key 前端可配；前端加 LandingView/SettingsPanel。S1 单项目模型，projectRoot 默认 `./workspace/default`。

**Tech Stack:** Node 24 + tsx（后端）、React 19 + Vite（前端）、Vitest + jsdom（测试）、Zod（校验）。

**对齐 spec:** `docs/superpowers/specs/2026-07-17-frontend-one-click-flow-design.md`

---

## 文件结构

### 新建
| 文件 | 职责 |
|---|---|
| `src/application/ports/settings-store.ts` | SettingsStore port + Settings/SettingsView 类型 |
| `src/infrastructure/settings-store.ts` | FsSettingsStore：读写 `.s2s/settings.json` + 脱敏 |
| `src/application/create-project-from-content.ts` | 从 bytes 创建项目的 use case |
| `web/src/components/LandingView.tsx` | 上传文稿/粘贴 + 元数据 + 一键生成 |
| `web/src/components/SettingsPanel.tsx` | API key 配置面板 |
| `tests/unit/settings-store.test.ts` | settings 读写 + 脱敏测试 |
| `tests/unit/create-project-from-content.test.ts` | use case 测试 |
| `tests/unit/api-settings.test.ts` | /api/settings 路由测试 |
| `tests/unit/api-project-lifecycle.test.ts` | create/plan/search 路由测试 |

### 修改
| 文件 | 改动 |
|---|---|
| `src/review/review-types.ts` | ReviewServerDependencies 加 5 个成员 |
| `src/review/router.ts` | createRoutes 接收新 deps + 5 个路由 |
| `src/cli/commands/review-command.ts` | 注入新 deps + workspace 自动创建 + --open |
| `src/cli/command-context.ts` | 加 createProjectFromContent 等 |
| `src/cli/provider-factory.ts` | env 来源改 settings 优先 |
| `src/infrastructure/env.ts` | readAssetProviderEnv/readPlannerEnv 支持 settings fallback |
| `package.json` | `start` 脚本 |
| `web/src/api/review-api.ts` | 新增 5 个客户端方法 |
| `web/src/App.tsx` | LandingView/SettingsPanel/视图切换 |
| `web/src/components/TopBar.tsx` | 齿轮按钮 |
| `README.md` | start 说明 + milestone |

---

## Phase A: Settings 持久化层

### Task A1: SettingsStore port 与类型

**Files:**
- Create: `src/application/ports/settings-store.ts`

- [ ] **Step 1: 写 port 与类型**

```ts
// src/application/ports/settings-store.ts
/**
 * SettingsStore port.
 *
 * Persists API keys at the workspace level (./workspace/.s2s/settings.json),
 * NOT inside the project directory (which `create` overwrites).
 * Keys are never committed to git (.gitignore).
 */
export interface Settings {
  readonly plannerProvider: string;
  readonly deepseekApiKey?: string;
  readonly deepseekBaseUrl?: string;
  readonly deepseekModel?: string;
  readonly stepApiKey?: string;
  readonly stepBaseUrl?: string;
  readonly stepModel?: string;
  readonly pexelsApiKey?: string;
  readonly pexelsBaseUrl?: string;
  readonly pexelsVideoBaseUrl?: string;
}

/**
 * Desensitized view returned by GET /api/settings.
 * Keys are reduced to booleans; non-secret config is preserved.
 */
export interface SettingsView {
  readonly plannerProvider: string;
  readonly hasDeepseekKey: boolean;
  readonly hasStepKey: boolean;
  readonly hasPexelsKey: boolean;
  readonly deepseekBaseUrl: string;
  readonly deepseekModel: string;
  readonly stepBaseUrl: string;
  readonly stepModel: string;
  readonly pexelsBaseUrl: string;
  readonly pexelsVideoBaseUrl: string;
}

export interface SettingsStore {
  /** Load settings; returns empty defaults if file missing. */
  load(): Promise<Settings>;
  /** Save settings (full replace, atomic write). */
  save(settings: Settings): Promise<void>;
  /** Return a desensitized view (no plaintext keys). */
  toView(settings: Settings): SettingsView;
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS (port only, no impl yet)

- [ ] **Step 3: Commit**

```bash
git add src/application/ports/settings-store.ts
git commit -m "feat(application): add SettingsStore port and types"
```

### Task A2: FsSettingsStore 实现

**Files:**
- Create: `src/infrastructure/settings-store.ts`
- Create: `tests/unit/settings-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/settings-store.test.ts
import fs from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FsSettingsStore } from "../../src/infrastructure/settings-store.js";

describe("FsSettingsStore", () => {
  let workspace: string;
  let store: FsSettingsStore;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "s2s-settings-"));
    store = new FsSettingsStore({ settingsPath: path.join(workspace, ".s2s", "settings.json") });
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("load returns empty defaults when file missing", async () => {
    const s = await store.load();
    expect(s.plannerProvider).toBe("fixture");
    expect(s.pexelsApiKey).toBeUndefined();
  });

  it("save then load round-trips keys", async () => {
    await store.save({
      plannerProvider: "deepseek",
      deepseekApiKey: "sk-test",
      pexelsApiKey: "px-test",
    });
    const s = await store.load();
    expect(s.deepseekApiKey).toBe("sk-test");
    expect(s.pexelsApiKey).toBe("px-test");
  });

  it("toView never exposes plaintext keys", async () => {
    await store.save({
      plannerProvider: "deepseek",
      deepseekApiKey: "sk-secret",
      pexelsApiKey: "px-secret",
      stepApiKey: "step-secret",
    });
    const view = store.toView(await store.load());
    expect(JSON.stringify(view)).not.toContain("sk-secret");
    expect(JSON.stringify(view)).not.toContain("px-secret");
    expect(view.hasDeepseekKey).toBe(true);
    expect(view.hasPexelsKey).toBe(true);
    expect(view.hasStepKey).toBe(true);
    expect(view.plannerProvider).toBe("deepseek");
  });

  it("toView shows false when key absent", async () => {
    const view = store.toView({ plannerProvider: "fixture" });
    expect(view.hasDeepseekKey).toBe(false);
    expect(view.hasPexelsKey).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/unit/settings-store.test.ts`
Expected: FAIL — `FsSettingsStore` not found

- [ ] **Step 3: 写实现**

```ts
// src/infrastructure/settings-store.ts
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./atomic-write.js";
import type { Settings, SettingsStore, SettingsView } from "../application/ports/settings-store.js";

export interface FsSettingsStoreOptions {
  readonly settingsPath: string;
}

const EMPTY_SETTINGS: Settings = { plannerProvider: "fixture" };

export class FsSettingsStore implements SettingsStore {
  private readonly settingsPath: string;

  constructor(opts: FsSettingsStoreOptions) {
    this.settingsPath = opts.settingsPath;
  }

  async load(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.settingsPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return this.normalize(parsed);
    } catch {
      return { ...EMPTY_SETTINGS };
    }
  }

  async save(settings: Settings): Promise<void> {
    const dir = path.dirname(this.settingsPath);
    await fs.mkdir(dir, { recursive: true });
    const json = JSON.stringify(settings, null, 2) + "\n";
    const bytes = new TextEncoder().encode(json);
    await atomicWrite(this.settingsPath, bytes, "settings.json");
  }

  toView(settings: Settings): SettingsView {
    return {
      plannerProvider: settings.plannerProvider,
      hasDeepseekKey: Boolean(settings.deepseekApiKey),
      hasStepKey: Boolean(settings.stepApiKey),
      hasPexelsKey: Boolean(settings.pexelsApiKey),
      deepseekBaseUrl: settings.deepseekBaseUrl ?? "",
      deepseekModel: settings.deepseekModel ?? "",
      stepBaseUrl: settings.stepBaseUrl ?? "",
      stepModel: settings.stepModel ?? "",
      pexelsBaseUrl: settings.pexelsBaseUrl ?? "",
      pexelsVideoBaseUrl: settings.pexelsVideoBaseUrl ?? "",
    };
  }

  private normalize(parsed: Record<string, unknown>): Settings {
    const s: Record<string, unknown> = { ...parsed };
    if (typeof s.plannerProvider !== "string" || s.plannerProvider.trim() === "") {
      s.plannerProvider = "fixture";
    }
    return s as unknown as Settings;
  }
}
```

> Note: `atomicWrite` 已存在于 `src/infrastructure/atomic-write.ts`（被 json-project-repository 使用）。如签名不同，按其真实签名调用。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/unit/settings-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/settings-store.ts tests/unit/settings-store.test.ts
git commit -m "feat(infra): FsSettingsStore with desensitized view"
```

---

## Phase B: /api/settings 路由

### Task B1: ReviewServerDependencies 扩展 + settings 路由

**Files:**
- Modify: `src/review/review-types.ts`
- Modify: `src/review/router.ts`
- Create: `tests/unit/api-settings.test.ts`

- [ ] **Step 1: 扩展依赖接口**

在 `src/review/review-types.ts` 的 `ReviewServerDependencies` 末尾加：

```ts
  /** Application: load settings (desensitized view). */
  readonly getSettings: () => Promise<import("../application/ports/settings-store.js").SettingsView>;
  /** Application: save settings. */
  readonly saveSettings: (
    input: unknown,
  ) => Promise<import("../application/ports/settings-store.js").SettingsView>;
  /** Application: create project from content bytes. */
  readonly createProjectFromContent: (input: unknown) => Promise<import("../application/create-project.js").CreateProjectResult>;
  /** Application: plan project. */
  readonly planProject: (input: unknown) => Promise<import("../application/plan-script.js").PlanProjectResult>;
  /** Application: search all project assets. */
  readonly searchProjectAssets: (input: unknown) => Promise<import("../application/search-project-assets.js").SearchProjectAssetsResult>;
```

- [ ] **Step 2: typecheck（确认 deps 接口变更）**

Run: `pnpm typecheck`
Expected: FAIL 在 review-command.ts / router.ts（尚未注入新 deps）— 这是预期的，下一步修。

- [ ] **Step 3: 写 settings 路由测试**

```ts
// tests/unit/api-settings.test.ts
import { describe, expect, it } from "vitest";
import { createRoutes, matchRoute } from "../../src/review/router.js";
import type { ReviewServerDependencies } from "../../src/review/review-types.js";
import type { SettingsView } from "../../src/application/ports/settings-store.js";

function fakeDeps(overrides: Partial<ReviewServerDependencies> = {}): ReviewServerDependencies {
  const base = {
    repository: { load: async () => ({}), save: async () => {}, exists: async () => true },
    assetWriter: { writeAsset: async () => ({ relativePath: "x" }) },
    getReviewProject: async () => ({ project: { id: "p", scenes: [] } }),
    updateScene: async () => ({}),
    updateSceneQueries: async () => ({}),
    searchSceneAssets: async () => ({ projectId: "p", status: "searched", sceneCount: 0, totalCandidates: 0, cacheHits: 0, cacheMisses: 0, warnings: [] }),
    selectCandidate: async () => ({}),
    skipScene: async () => ({}),
    attachLocalAsset: async () => ({}),
    getSettings: async () => ({ plannerProvider: "fixture", hasDeepseekKey: false, hasStepKey: false, hasPexelsKey: true, deepseekBaseUrl: "", deepseekModel: "", stepBaseUrl: "", stepModel: "", pexelsBaseUrl: "", pexelsVideoBaseUrl: "" } satisfies SettingsView),
    saveSettings: async () => ({ plannerProvider: "fixture", hasDeepseekKey: false, hasStepKey: false, hasPexelsKey: true, deepseekBaseUrl: "", deepseekModel: "", stepBaseUrl: "", stepModel: "", pexelsBaseUrl: "", pexelsVideoBaseUrl: "" } satisfies SettingsView),
    createProjectFromContent: async () => ({ projectId: "p", title: "t", status: "created", projectRoot: "/", scriptPath: "/s", createdAt: "" }),
    planProject: async () => ({ projectId: "p", title: "t", status: "planned", sceneCount: 0, provider: "fixture", promptVersion: "v", projectRoot: "/" }),
    searchProjectAssets: async () => ({ projectId: "p", status: "searched", sceneCount: 0, totalCandidates: 0, cacheHits: 0, cacheMisses: 0, warnings: [] }),
  } as unknown as ReviewServerDependencies;
  return { ...base, ...overrides } as ReviewServerDependencies;
}

describe("settings routes", () => {
  const cfg = { projectRoot: "/proj", host: "127.0.0.1", getBoundPort: () => 3210, version: "v" };

  it("GET /api/settings is registered", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    const r = matchRoute(routes, "GET", "/api/settings");
    expect(r).toBeDefined();
  });

  it("PUT /api/settings is registered", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    const r = matchRoute(routes, "PUT", "/api/settings");
    expect(r).toBeDefined();
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm test tests/unit/api-settings.test.ts`
Expected: FAIL — routes not registered

- [ ] **Step 5: 在 router.ts 加 settings 路由**

在 `router.ts` 的 `createRoutes` 中（与现有 routes.push 同级）加 GET 和 PUT `/api/settings`。GET 不需要 token gate（脱敏视图无敏感数据）；PUT 需 token + Origin（沿用 post-routing gate，PUT 是 mutating）。

参照现有 `POST /api/scenes/:sceneId/search` 的 handler 结构（`parseJsonBody` + Zod `safeParse` + `sendSuccess`）。PUT body schema：

```ts
// router.ts 顶部 schemas 区
const SaveSettingsBodySchema = z.strictObject({
  plannerProvider: z.enum(["fixture", "deepseek", "stepfun"]).optional(),
  deepseekApiKey: z.string().min(1).optional(),
  deepseekBaseUrl: z.string().url().optional(),
  deepseekModel: z.string().min(1).optional(),
  stepApiKey: z.string().min(1).optional(),
  stepBaseUrl: z.string().url().optional(),
  stepModel: z.string().min(1).optional(),
  pexelsApiKey: z.string().min(1).optional(),
  pexelsBaseUrl: z.string().url().optional(),
  pexelsVideoBaseUrl: z.string().url().optional(),
});
```

GET handler：
```ts
routes.push({
  path: "/api/settings",
  methods: ["GET"],
  handler: async (_req, res) => {
    try {
      const view = await routeDeps.getSettings();
      sendSuccess(res, 200, { settings: view });
    } catch (error) {
      mapMutationError(error, res);
    }
  },
});
```

PUT handler：
```ts
routes.push({
  path: "/api/settings",
  methods: ["PUT"],
  handler: async (req, res) => {
    const bodyResult = await parseJsonBody(req, res);
    if (!bodyResult.success) {
      sendError(res, bodyResult.statusCode, bodyResult.code, bodyResult.message, bodyResult.hint ?? undefined);
      return;
    }
    const parsed = SaveSettingsBodySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid settings body");
      return;
    }
    try {
      const view = await routeDeps.saveSettings(parsed.data);
      sendSuccess(res, 200, { settings: view });
    } catch (error) {
      mapMutationError(error, res);
    }
  },
});
```

> `routeDeps` 是 `createRoutes` 从 config.deps 取出的依赖对象（参照现有 search 路由从 deps 取 searchSceneAssets 的写法）。`mapMutationError` 已在 router.ts 引入。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test tests/unit/api-settings.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/review/review-types.ts src/review/router.ts tests/unit/api-settings.test.ts
git commit -m "feat(review): add GET/PUT /api/settings routes"
```

---

## Phase C: createProjectFromContent use case

### Task C1: 从 bytes 创建项目的 use case

**Files:**
- Create: `src/application/create-project-from-content.ts`
- Create: `tests/unit/create-project-from-content.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/create-project-from-content.test.ts
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createProjectFromContent } from "../../src/application/create-project-from-content.js";
import { SystemClock } from "../../src/infrastructure/system-adapters.js";
import { SystemIdGenerator } from "../../src/infrastructure/system-adapters.js";
import { JsonProjectRepository } from "../../src/infrastructure/json-project-repository.js";
import { FileSystemProjectScaffolder } from "../../src/infrastructure/project-scaffolder.js";

describe("createProjectFromContent", () => {
  it("creates a project from text bytes without a file path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "s2s-content-"));
    const projectDir = path.join(dir, "myproj");
    const content = "# 标题\n\n这是一段口播稿。";

    const result = await createProjectFromContent(
      {
        projectDirectory: projectDir,
        content: new TextEncoder().encode(content),
        originalFileName: "script.md",
        title: "",
        language: "zh-CN",
        aspectRatio: "9:16",
        style: "knowledge",
        intendedUse: "commercial_capable",
        willModify: true,
      },
      new SystemClock(),
      new SystemIdGenerator(),
      new JsonProjectRepository(),
      new FileSystemProjectScaffolder(),
    );

    expect(result.status).toBe("created");
    expect(result.projectRoot).toBe(path.resolve(projectDir));
    // repository can load it back
    const repo = new JsonProjectRepository();
    const loaded = await repo.load(result.projectRoot);
    expect(loaded.source.sha256).toBeTruthy();
  });

  it("rejects empty content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "s2s-empty-"));
    await expect(
      createProjectFromContent(
        {
          projectDirectory: path.join(dir, "p"),
          content: new TextEncoder().encode(""),
          originalFileName: "script.md",
          title: "",
          language: "zh-CN",
          aspectRatio: "9:16",
          style: "knowledge",
          intendedUse: "commercial_capable",
          willModify: true,
        },
        new SystemClock(),
        new SystemIdGenerator(),
        new JsonProjectRepository(),
        new FileSystemProjectScaffolder(),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/unit/create-project-from-content.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写实现**

`createProjectFromContent` 基于 `createProject`，但接受 `content: Uint8Array` + `originalFileName` 而非 `scriptPath`，跳过路径读取。复用 `computeSourceMeta`、`scaffolder`、`repository.create`。

```ts
// src/application/create-project-from-content.ts
/**
 * createProjectFromContent use case.
 *
 * Like createProject, but accepts in-memory content bytes instead of a file
 * path. Used by the frontend "upload script" flow (POST /api/project/create).
 * The HTTP layer never exposes filesystem paths to the browser.
 */
import path from "node:path";

import type { Clock } from "./ports/clock.js";
import type { IdGenerator } from "./ports/id-generator.js";
import type { ProjectRepository } from "./ports/project-repository.js";
import type { ProjectScaffolder } from "./ports/project-scaffolder.js";
import { SpeechToSceneProjectSchema } from "../domain/project-schema.js";
import { InvalidArgumentError, SourceDocumentError, ProjectWriteError } from "../shared/errors.js";
import { computeSourceMeta, getScriptFileName } from "../infrastructure/source-document.js";

export interface CreateProjectFromContentInput {
  projectDirectory: string;
  content: Uint8Array;
  originalFileName: string;
  title: string;
  language: "zh-CN" | "en-US";
  aspectRatio: "9:16" | "16:9" | "1:1";
  style: "knowledge" | "story" | "commentary";
  intendedUse: "commercial_capable" | "noncommercial" | "editorial";
  willModify: boolean;
}

export type CreateProjectFromContentResult = {
  projectId: string;
  title: string;
  status: "created";
  projectRoot: string;
  scriptPath: string;
  createdAt: string;
};

export async function createProjectFromContent(
  input: CreateProjectFromContentInput,
  clock: Clock,
  idGenerator: IdGenerator,
  repository: ProjectRepository,
  scaffolder: ProjectScaffolder,
): Promise<CreateProjectFromContentResult> {
  if (!input.projectDirectory?.trim()) {
    throw new InvalidArgumentError("Project directory is required", "请提供项目目录路径");
  }
  if (input.content.length === 0) {
    throw new SourceDocumentError("Content is empty", "文稿内容为空");
  }
  if (!input.originalFileName?.trim()) {
    throw new InvalidArgumentError("Original file name is required", "请提供文稿文件名");
  }

  const sourceBytes = input.content;
  const meta = computeSourceMeta(input.originalFileName, sourceBytes);
  const scriptDestName = getScriptFileName(meta.originalFileName);
  const resolvedProjectRoot = path.resolve(input.projectDirectory);

  const now = clock.now();
  const createdAt = now.toISOString();
  const projectId = idGenerator.projectId();
  const title = input.title?.trim() || path.basename(input.originalFileName, path.extname(input.originalFileName));
  const sentinelToken = idGenerator.temporaryId();

  if (await repository.exists(resolvedProjectRoot)) {
    throw new ProjectWriteError("Project already exists", "项目已存在", undefined);
  }

  const initialProject = SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: projectId,
      title,
      createdAt,
      updatedAt: createdAt,
      language: input.language,
      aspectRatio: input.aspectRatio,
      style: input.style,
      assetUsePolicy: { intendedUse: input.intendedUse, willModify: input.willModify },
    },
    source: {
      path: scriptDestName,
      originalFileName: meta.originalFileName,
      sha256: meta.sha256,
      encoding: "utf-8",
      sizeBytes: meta.sizeBytes,
      textLengthUtf16: meta.textLengthUtf16,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
  });

  await scaffolder.createRoot(resolvedProjectRoot);
  await scaffolder.writeSentinel(resolvedProjectRoot, sentinelToken);
  try {
    await scaffolder.createSubdirectories(resolvedProjectRoot);
    await scaffolder.copySourceDocument(resolvedProjectRoot, sourceBytes, meta.originalFileName);
    await repository.create(resolvedProjectRoot, initialProject);
    await scaffolder.removeSentinel(resolvedProjectRoot);
    return {
      projectId,
      title,
      status: "created",
      projectRoot: resolvedProjectRoot,
      scriptPath: path.join(resolvedProjectRoot, scriptDestName),
      createdAt,
    };
  } catch (error) {
    const owns = await scaffolder.checkSentinel(resolvedProjectRoot, sentinelToken);
    if (owns) {
      try {
        await import("node:fs/promises").then((fs) => fs.rm(resolvedProjectRoot, { recursive: true, force: true }));
      } catch {
        /* best-effort */
      }
    }
    throw new ProjectWriteError(
      error instanceof Error ? error.message : "Project creation failed",
      "项目创建失败",
      error instanceof Error ? error : undefined,
    );
  }
}
```

> Note: `computeSourceMeta` / `getScriptFileName` 已在 `src/infrastructure/source-document.ts`（被 create-project.ts 使用）。`ProjectWriteError` 构造签名需与 `src/shared/errors.ts` 一致——若第三参数非 `cause`，按真实签名调整。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/unit/create-project-from-content.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/application/create-project-from-content.ts tests/unit/create-project-from-content.test.ts
git commit -m "feat(application): createProjectFromContent use case"
```

---

## Phase D: project lifecycle 路由（create/plan/search）

### Task D1: /api/project/create + /plan + /search 路由

**Files:**
- Modify: `src/review/router.ts`
- Create: `tests/unit/api-project-lifecycle.test.ts`

- [ ] **Step 1: 写路由注册测试**

```ts
// tests/unit/api-project-lifecycle.test.ts
import { describe, expect, it } from "vitest";
import { createRoutes, matchRoute } from "../../src/review/router.js";
import type { ReviewServerDependencies } from "../../src/review/review-types.js";

function fakeDeps(): ReviewServerDependencies {
  return {
    repository: { load: async () => ({}), save: async () => {}, exists: async () => true },
    assetWriter: { writeAsset: async () => ({ relativePath: "x" }) },
    getReviewProject: async () => ({ project: { id: "p", scenes: [] } }),
    updateScene: async () => ({}),
    updateSceneQueries: async () => ({}),
    searchSceneAssets: async () => ({ projectId: "p", status: "searched", sceneCount: 0, totalCandidates: 0, cacheHits: 0, cacheMisses: 0, warnings: [] }),
    selectCandidate: async () => ({}),
    skipScene: async () => ({}),
    attachLocalAsset: async () => ({}),
    getSettings: async () => ({ plannerProvider: "fixture", hasDeepseekKey: false, hasStepKey: false, hasPexelsKey: false, deepseekBaseUrl: "", deepseekModel: "", stepBaseUrl: "", stepModel: "", pexelsBaseUrl: "", pexelsVideoBaseUrl: "" }),
    saveSettings: async () => ({ plannerProvider: "fixture", hasDeepseekKey: false, hasStepKey: false, hasPexelsKey: false, deepseekBaseUrl: "", deepseekModel: "", stepBaseUrl: "", stepModel: "", pexelsBaseUrl: "", pexelsVideoBaseUrl: "" }),
    createProjectFromContent: async () => ({ projectId: "p", title: "t", status: "created", projectRoot: "/", scriptPath: "/s", createdAt: "" }),
    planProject: async () => ({ projectId: "p", title: "t", status: "planned", sceneCount: 0, provider: "fixture", promptVersion: "v", projectRoot: "/" }),
    searchProjectAssets: async () => ({ projectId: "p", status: "searched", sceneCount: 0, totalCandidates: 0, cacheHits: 0, cacheMisses: 0, warnings: [] }),
  } as unknown as ReviewServerDependencies;
}

describe("project lifecycle routes", () => {
  const cfg = { projectRoot: "/proj", host: "127.0.0.1", getBoundPort: () => 3210, version: "v" };

  it("registers POST /api/project/create", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/create")).toBeDefined();
  });

  it("registers POST /api/project/plan", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/plan")).toBeDefined();
  });

  it("registers POST /api/project/search", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/search")).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/unit/api-project-lifecycle.test.ts`
Expected: FAIL — routes not registered

- [ ] **Step 3: 在 router.ts 加三个路由**

Body schemas（router.ts 顶部）：

```ts
const CreateProjectBodySchema = z.strictObject({
  content: z.string().min(1),
  fileName: z.string().min(1).optional(),
  title: z.string().optional(),
  language: z.enum(["zh-CN", "en-US"]).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  style: z.enum(["knowledge", "story", "commentary"]).optional(),
  intendedUse: z.enum(["commercial_capable", "noncommercial", "editorial"]).optional(),
  willModify: z.boolean().optional(),
  force: z.boolean().optional().default(false),
});

const PlanProjectBodySchema = z.strictObject({
  provider: z.enum(["fixture", "deepseek", "stepfun"]),
  maxScenes: z.number().int().min(1).max(50).optional().default(12),
  force: z.boolean().optional().default(false),
});

const SearchProjectBodySchema = z.strictObject({
  provider: z.enum(["fixture", "pexels"]),
  refresh: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(12),
});
```

create handler（`projectRoot` 来自 config，`content` 用 `TextEncoder` 编码）：

```ts
routes.push({
  path: "/api/project/create",
  methods: ["POST"],
  handler: async (req, res) => {
    const bodyResult = await parseJsonBody(req, res);
    if (!bodyResult.success) {
      sendError(res, bodyResult.statusCode, bodyResult.code, bodyResult.message, bodyResult.hint ?? undefined);
      return;
    }
    const parsed = CreateProjectBodySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid project create body");
      return;
    }
    try {
      await routeDeps.createProjectFromContent({
        projectDirectory: config.projectRoot,
        content: new TextEncoder().encode(parsed.data.content),
        originalFileName: parsed.data.fileName ?? "script.md",
        title: parsed.data.title ?? "",
        language: parsed.data.language ?? "zh-CN",
        aspectRatio: parsed.data.aspectRatio ?? "9:16",
        style: parsed.data.style ?? "knowledge",
        intendedUse: parsed.data.intendedUse ?? "commercial_capable",
        willModify: parsed.data.willModify ?? true,
      });
      const project = await routeDeps.getReviewProject(config.projectRoot, config.deps!.repository);
      sendSuccess(res, 200, { project });
    } catch (error) {
      mapMutationError(error, res);
    }
  },
});
```

> `force` 处理：若 `force=false` 且项目已存在，`createProjectFromContent` 抛 `ProjectWriteError`（Project already exists）。`mapMutationError` 应将其映射为 409。若现有 mapMutationError 不识别该错误码，在 handler 内 catch `ProjectWriteError` 显式返回 409。实现时核对 `src/review/router.ts` 中 `mapMutationError` 的错误映射表，补 `project_already_exists → 409`。

plan handler：

```ts
routes.push({
  path: "/api/project/plan",
  methods: ["POST"],
  handler: async (req, res) => {
    const bodyResult = await parseJsonBody(req, res);
    if (!bodyResult.success) {
      sendError(res, bodyResult.statusCode, bodyResult.code, bodyResult.message, bodyResult.hint ?? undefined);
      return;
    }
    const parsed = PlanProjectBodySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid plan body");
      return;
    }
    try {
      await routeDeps.planProject({
        projectRoot: config.projectRoot,
        provider: parsed.data.provider,
        maxScenes: parsed.data.maxScenes,
        force: parsed.data.force,
        dryRun: false,
      });
      const project = await routeDeps.getReviewProject(config.projectRoot, config.deps!.repository);
      sendSuccess(res, 200, { project });
    } catch (error) {
      mapMutationError(error, res);
    }
  },
});
```

search handler：

```ts
routes.push({
  path: "/api/project/search",
  methods: ["POST"],
  handler: async (req, res) => {
    const bodyResult = await parseJsonBody(req, res);
    if (!bodyResult.success) {
      sendError(res, bodyResult.statusCode, bodyResult.code, bodyResult.message, bodyResult.hint ?? undefined);
      return;
    }
    const parsed = SearchProjectBodySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid search body");
      return;
    }
    try {
      await routeDeps.searchProjectAssets({
        projectRoot: config.projectRoot,
        provider: parsed.data.provider,
        maxAssetsPerQuery: parsed.data.limit,
        refresh: parsed.data.refresh,
      });
      const project = await routeDeps.getReviewProject(config.projectRoot, config.deps!.repository);
      sendSuccess(res, 200, { project });
    } catch (error) {
      mapMutationError(error, res);
    }
  },
});
```

> `config.deps!.repository` 的取法：参照现有 search-scene 路由如何从 deps 取 repository（现有路由用闭包内的 `repository` 变量，按真实写法对齐）。三个 handler 都复用 `getReviewProject(projectRoot, repository)` 返回 UI-safe 视图。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/unit/api-project-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/router.ts tests/unit/api-project-lifecycle.test.ts
git commit -m "feat(review): add project create/plan/search routes"
```

---

## Phase E: 依赖注入 + env 读取顺序 + 启动脚本

### Task E1: review-command 注入新 deps + workspace 自动创建 + --open

**Files:**
- Modify: `src/cli/commands/review-command.ts`
- Modify: `src/cli/command-context.ts`

- [ ] **Step 1: 注入新 use case 与 settings store**

在 `review-command.ts` 的 action 里：
- 创建 `FsSettingsStore({ settingsPath: path.join(workspaceRoot, ".s2s", "settings.json") })`，其中 `workspaceRoot = path.dirname(path.resolve(resolvedProjectRoot))`（projectRoot 是 `./workspace/default`，workspace 根是其父目录 `./workspace`）。
- 构造 `getSettings` / `saveSettings` 闭包：`getSettings = async () => store.toView(await store.load())`；`saveSettings = async (input) => { const current = await store.load(); const merged = { ...current, ...cleanUndefined(input) }; await store.save(merged); return store.toView(merged); }`。
- 构造 `createProjectFromContent` 闭包：绑定 `ctx.clock / ctx.idGenerator / ctx.repository / ctx.scaffolder`。
- 构造 `planProject` 闭包：需创建 planner provider（参照现有 `createSearchProvider` 的工厂模式，planner 工厂从 settings 读 key）。若 planner 工厂尚未在 review-command 注入，新增一个 `createPlanner(providerName, settings)` 调用现有 `src/cli` 的 planner 工厂。
- 构造 `searchProjectAssets` 闭包：复用现有 `searchSceneAssetsBound` 逻辑但全项目（无 sceneId）。
- 把这 5 个闭包加入 `deps` 对象。

> planner 工厂：现有 CLI `plan` 命令在 `src/cli/commands/plan-command.ts` 创建 planner（fixture/deepseek/stepfun）。提取其创建逻辑为共享工厂 `createPlannerProvider(name, env)`，放在 `src/cli/provider-factory.ts`（与 `createSearchProvider` 同文件），env 来源改为 settings 优先。

- [ ] **Step 2: workspace/default 自动创建 + --open**

在 action 开头（validate project 前）：
```ts
// 自动确保 workspace/default 存在（首次启动）
const fs = await import("node:fs/promises");
await fs.mkdir(resolvedProjectRoot, { recursive: true });
```

`--open`：将 `--no-open` 选项改为默认 open=true。修改 option 定义：
```ts
.option("--no-open", "Do not open a browser (default: open browser)")
```
并在启动成功后，若 `options.open` 为 true，用 `import("node:child_process")` 打开 `http://${host}:${handle.port}/?token=${handle.token}`。

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/review-command.ts src/cli/command-context.ts
git commit -m "feat(cli): inject lifecycle deps + workspace auto-create + --open"
```

### Task E2: env 读取顺序 settings 优先

**Files:**
- Modify: `src/infrastructure/env.ts`
- Modify: `src/cli/provider-factory.ts`

- [ ] **Step 1: 调整工厂读取顺序**

`createSearchProvider` / `createPlannerProvider` 的 env 来源改为：先读 settings.json（经 SettingsStore.load()），缺失字段 fallback 到 process.env（.env）。具体：工厂函数签名加一个可选 `settings?: Settings` 参数，优先取 `settings.pexelsApiKey ?? env.pexelsApiKey`。

- [ ] **Step 2: typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: PASS（现有 test 不受影响，因为 fallback 仍是 .env）

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/env.ts src/cli/provider-factory.ts
git commit -m "feat(cli): settings.json takes priority over .env for provider keys"
```

### Task E3: pnpm start 脚本 + README

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: 加 start 脚本**

`package.json` scripts 加：
```json
"start": "pnpm build:all && node dist/cli/index.js review ./workspace/default"
```

- [ ] **Step 2: README 加一键启动说明**

在 README 的 Quick Start 区加一段「一键启动」：`pnpm start` → 自动构建 + 启动 + 开浏览器 + token 自动带。首次需在设置页填 API key。

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "chore: add pnpm start one-click launch script"
```

---

## Phase F: 前端

### Task F1: review-api 客户端新增方法

**Files:**
- Modify: `web/src/api/review-api.ts`

- [ ] **Step 1: 加 5 个方法**

在 `ReviewApiClient` 类中加（沿用现有 `jsonMutation` / `json` 模式）：

```ts
async createProject(input: {
  content: string;
  fileName?: string;
  title?: string;
  language?: "zh-CN" | "en-US";
  aspectRatio?: "9:16" | "16:9" | "1:1";
  style?: "knowledge" | "story" | "commentary";
  intendedUse?: "commercial_capable" | "noncommercial" | "editorial";
  willModify?: boolean;
  force?: boolean;
}): Promise<ReviewProjectView> {
  return this.jsonMutation("/api/project/create", "POST", input);
}

async planProject(input: {
  provider: "fixture" | "deepseek" | "stepfun";
  maxScenes?: number;
  force?: boolean;
}): Promise<ReviewProjectView> {
  return this.jsonMutation("/api/project/plan", "POST", input);
}

async searchProject(input: {
  provider: "fixture" | "pexels";
  refresh?: boolean;
  limit?: number;
}): Promise<ReviewProjectView> {
  return this.jsonMutation("/api/project/search", "POST", input);
}

async getSettings(): Promise<SettingsView> {
  const res = await this.json("/api/settings", "GET");
  return res.settings as SettingsView;
}

async saveSettings(input: Record<string, unknown>): Promise<SettingsView> {
  const res = await this.jsonMutation("/api/settings", "PUT", input);
  return res.settings as SettingsView;
}
```

> `SettingsView` 类型在前端 `web/src/types.ts` 新增（镜像后端脱敏视图）。`json` 方法用于 GET（参照现有 `getProject` 用法）。

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/api/review-api.ts web/src/types.ts
git commit -m "feat(web): add project lifecycle + settings API client methods"
```

### Task F2: LandingView 组件

**Files:**
- Create: `web/src/components/LandingView.tsx`

- [ ] **Step 1: 写组件**

```tsx
// web/src/components/LandingView.tsx
import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";

interface LandingViewProps {
  onCreate: (input: {
    content: string;
    fileName?: string;
    title?: string;
  }) => Promise<void>;
  busy: boolean;
  error: { message: string; hint?: string } | null;
}

export function LandingView({ onCreate, busy, error }: LandingViewProps): React.ReactElement {
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("script.md");
  const [title, setTitle] = useState("");

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    file.text().then((text) => setContent(text));
  };

  const canSubmit = content.trim().length > 0 && !busy;

  return (
    <section className="landing">
      <div className="landing-header">
        <Sparkles size={24} />
        <h1>Speech-to-Scene</h1>
        <p>上传或粘贴口播文稿，一键生成视觉场景与素材候选</p>
      </div>
      {error && (
        <div className="action-error">
          <strong>{error.message}</strong>
          {error.hint && <span>{error.hint}</span>}
        </div>
      )}
      <div className="landing-body">
        <label className="file-upload">
          <FileText size={16} />
          <input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={handleFile} disabled={busy} />
          <span>{fileName || "选择 .md/.txt 文件"}</span>
        </label>
        <textarea
          className="script-input"
          placeholder="或在此粘贴口播文稿…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={busy}
          rows={12}
        />
        <input
          className="title-input"
          type="text"
          placeholder="项目标题（可选，默认用文件名）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
        <button className="btn primary" disabled={!canSubmit} onClick={() => onCreate({ content, fileName, title })}>
          {busy ? "生成中…" : "一键生成"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 加样式（styles.css 的 .landing 区）**

```css
.landing { max-width: 720px; margin: 40px auto; padding: 0 16px; }
.landing-header { text-align: center; margin-bottom: 24px; }
.landing-header h1 { margin: 8px 0 4px; }
.landing-header p { color: var(--muted); font-size: 13px; }
.landing-body { display: flex; flex-direction: column; gap: 12px; }
.file-upload { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px dashed var(--line-strong); border-radius: var(--radius); cursor: pointer; }
.script-input { width: 100%; border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 12px; font-size: 14px; font-family: inherit; resize: vertical; }
.title-input { height: 36px; border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 0 12px; font-size: 14px; }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/LandingView.tsx web/src/styles.css
git commit -m "feat(web): add LandingView upload/paste component"
```

### Task F3: SettingsPanel 组件

**Files:**
- Create: `web/src/components/SettingsPanel.tsx`

- [ ] **Step 1: 写组件**

```tsx
// web/src/components/SettingsPanel.tsx
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ReviewApiClient } from "../api/review-api.js";
import type { SettingsView } from "../types.js";

interface SettingsPanelProps {
  client: ReviewApiClient;
  onClose: () => void;
}

export function SettingsPanel({ client, onClose }: SettingsPanelProps): React.ReactElement {
  const [view, setView] = useState<SettingsView | null>(null);
  const [pexelsKey, setPexelsKey] = useState("");
  const [planner, setPlanner] = useState("fixture");
  const [plannerKey, setPlannerKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client.getSettings().then((v) => {
      setView(v);
      setPlanner(v.plannerProvider);
    }).catch(() => {});
  }, [client]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const body: Record<string, unknown> = { plannerProvider: planner };
    if (pexelsKey) body.pexelsApiKey = pexelsKey;
    if (planner === "deepseek" && plannerKey) body.deepseekApiKey = plannerKey;
    if (planner === "stepfun" && plannerKey) body.stepApiKey = plannerKey;
    try {
      const v = await client.saveSettings(body);
      setView(v);
      setPexelsKey("");
      setPlannerKey("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>API Key 配置</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        {view && (
          <div className="settings-body">
            <label>Planner 提供方</label>
            <select value={planner} onChange={(e) => setPlanner(e.target.value)} disabled={saving}>
              <option value="fixture">Fixture（测试，不联网）</option>
              <option value="deepseek">DeepSeek</option>
              <option value="stepfun">StepFun</option>
            </select>
            {planner !== "fixture" && (
              <>
                <label>{planner === "deepseek" ? "DeepSeek" : "StepFun"} API Key</label>
                <input type="password" placeholder={view && ((planner === "deepseek" && view.hasDeepseekKey) || (planner === "stepfun" && view.hasStepKey)) ? "已配置，留空不修改" : "粘贴 API Key"} value={plannerKey} onChange={(e) => setPlannerKey(e.target.value)} disabled={saving} />
              </>
            )}
            <label>Pexels API Key</label>
            <input type="password" placeholder={view?.hasPexelsKey ? "已配置，留空不修改" : "粘贴 Pexels API Key"} value={pexelsKey} onChange={(e) => setPexelsKey(e.target.value)} disabled={saving} />
            {saved && <span className="settings-saved">已保存</span>}
            <button className="btn primary" onClick={() => void handleSave()} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
            <p className="settings-hint">Key 保存在本地 .s2s/settings.json，不入 Git。</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 加样式（.settings-overlay/.settings-modal）**

```css
.settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: grid; place-items: center; z-index: 50; }
.settings-modal { background: var(--panel); border-radius: 12px; width: min(480px, 90vw); max-height: 80vh; overflow: auto; padding: 20px; }
.settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.settings-body { display: flex; flex-direction: column; gap: 8px; }
.settings-body label { font-size: 12px; color: var(--muted); margin-top: 8px; }
.settings-body input, .settings-body select { height: 36px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 10px; }
.settings-saved { color: green; font-size: 12px; }
.settings-hint { font-size: 11px; color: var(--muted); margin-top: 8px; }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SettingsPanel.tsx web/src/styles.css
git commit -m "feat(web): add SettingsPanel for API key configuration"
```

### Task F4: App.tsx 视图切换 + TopBar 齿轮 + 一键流串联

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`

- [ ] **Step 1: 加视图状态与一键流串联**

在 App.tsx 加：
- `const [showSettings, setShowSettings] = useState(false);`
- `const [landing, setLanding] = useState(true);`（无项目时显示 LandingView）

一键流 handler：
```ts
const handleCreate = useCallback(async (input: { content: string; fileName?: string; title?: string }) => {
  if (!client) return;
  setActionError(null);
  setBusyAction("search");
  try {
    let project = await client.createProject({ content: input.content, fileName: input.fileName, title: input.title, force: true });
    project = await client.planProject({ provider: "fixture", maxScenes: 12, force: true });
    project = await client.searchProject({ provider: "pexels", limit: 12 });
    syncFromProject(project);
    setLanding(false);
  } catch (err) {
    setActionError(toActionError(err));
  } finally {
    setBusyAction(null);
  }
}, [client, syncFromProject]);
```

渲染逻辑：`landing` 为 true 时渲染 `<LandingView onCreate={handleCreate} busy={busyAction !== null} error={actionError} />`，否则渲染现有 Review Board。`showSettings` 为 true 时渲染 `<SettingsPanel client={client} onClose={() => setShowSettings(false)} />`。

TopBar 加齿轮按钮 `onSettings={() => setShowSettings(true)}`。

> planner provider：一键流里 plan 默认 fixture（不联网、不耗 key，先跑通切片）。真实 planner 由用户在设置页选后，从 `getSettings()` 读 plannerProvider，一键流改用该值。可在 handleCreate 开头 `const settings = await client.getSettings();` 取 plannerProvider。

- [ ] **Step 2: 构建验证**

Run: `pnpm web:build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx web/src/components/TopBar.tsx
git commit -m "feat(web): wire LandingView + SettingsPanel + one-click flow"
```

---

## Phase G: 全量验证

### Task G1: 完整检查

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm web:build`
Expected: 全部 PASS

- [ ] **Step 2: 端到端 smoke（fixture）**

手动跑：`pnpm start` → 浏览器开 → 粘贴一段文稿 → 一键生成 → 看到 fixture 候选 → 确认无灰色（fixture 仍假，但流程通）。配 Pexels key 后重试，应看到真实缩略图。

- [ ] **Step 3: 最终 commit**

```bash
git add -A
git commit -m "chore: step 1 complete — one-click flow + api key frontend"
```

---

## Self-Review 备注（给执行者）

- **Spec 覆盖**：create/plan/search/settings 四组端点（§4）✓；createProjectFromContent（§4.1）✓；settings 持久化 workspace 级（§6.1）✓；env 优先级（§6.4）✓；LandingView/SettingsPanel（§5）✓；pnpm start + --open（§7）✓；错误映射（§8）在 Task D1 Step3 已标注核对 mapMutationError。
- **类型一致**：`Settings`/`SettingsView` 跨 Phase A-E-F 一致；`createProjectFromContent` 返回 `CreateProjectFromContentResult` 与路由使用一致；`ReviewServerDependencies` 5 个新成员命名贯穿 B1/E1。
- **注意点**：Task D1/E1 中 `routeDeps` / `config.deps.repository` 的确切取法，需对齐现有 `createRoutes` 如何从 config 拆出 deps（读 router.ts 现有 search 路由的闭包写法）。`mapMutationError` 对 `ProjectWriteError`/`ProjectAlreadyPlannedError` 的映射需核对，缺失则补。
```
