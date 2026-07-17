# 前端一键流 + API Key 前端化 设计（步骤 1）

> 状态：已与用户确认，待审阅 → 转实现计划
> 日期：2026-07-17
> 范围：方案 A 增量三步中的**步骤 1**（子系统① + 子系统②）
> 对齐：AGENTS.md Phase 1 边界（不碰 ASR / 时间轴 / 渲染 / 云端 / 数据库）

## 1. 背景与目标

当前 `init → plan → search → review` 全链路已实现，但只能通过 CLI 触发。用户希望面向非技术使用者提供"一键"体验：部署后直接在前端上传文稿，自动切片并寻找素材，全程不碰命令行。

目标：把 init / plan / search 从 CLI 搬到前端 HTTP API，并让外部 API Key 在前端配置、后端持久化，启动一行命令自动开浏览器。

### 1.1 用户确认的关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 输入形式 | 文本（文件 .md/.txt 或粘贴） | 不涉及 ASR，复用现有 plan |
| 素材源策略 | API 源搜索 + 无 API 源外链记录 | 国内平台无合法 API，走手动外链 |
| 交付节奏 | 方案 A 增量三步 | 步骤 1 先解决傻瓜体验 |
| 文稿上传路径 | A1 后端接受 bytes | 前端零文件系统 |
| 项目绑定模型 | S1 单项目 | 改动最小，最快跑通 |
| 一键流调用形式 | 前端串行 create→plan→search | 可分步看进度，更灵活 |
| Key 持久化位置 | workspace 级 `.s2s/settings.json` | 不被 create 覆盖，不入 git |

### 1.2 不在步骤 1 范围内（后续步骤）

- 步骤 2：扩充 API 素材源（Pixabay / Unsplash / Openverse，先调研接入条款再接 1-2 个）
- 步骤 3：手动外链层（国内平台 / 免费素材网 / 聚合搜索站 的快捷跳转 + 粘贴链接记录）

## 2. 架构边界与数据流

核心原则：**复用现有 use case，只加 API 端点，前端零文件系统访问。**

```
浏览器（React）
  │  上传文稿 .md/.txt 或粘贴文本
  ▼
POST /api/project/create    （body: 文稿内容 + 元数据）
  │  后端调 createProjectFromContent use case → 写 project.s2s.json
  ▼
POST /api/project/plan      （body: planner provider + maxScenes）
  │  后端调 planProject use case → 切片成场景
  ▼
POST /api/project/search    （body: asset provider + refresh + limit）
  │  后端调 searchProjectAssets use case → 出候选
  ▼
GET /api/project            （现有，返回 UI-safe 视图）
  ▼
前端 Review Board 审核界面
```

边界约束（严格遵守 AGENTS.md）：

- 前端只调本地 HTTP API，不碰文件系统。
- Domain / Application 层不新增 HTTP / React / SDK 依赖（只加 HTTP 路由层调用现有 use case）。
- 每个外部输入走 Zod 严格校验。
- 写操作走 repository 原子写入。
- Planner / Provider 是注入的接口，不绑定具体 SDK。
- 不碰 ASR、时间轴、渲染。

## 3. 项目绑定模型（S1 单项目）

Review Server 启动时绑定一个固定的 `projectRoot`（默认 `./workspace/default`）。前端 `POST /api/project/create` 在这个固定目录上创建或重建项目。

- 若目录已有项目且 `force=false`，后端返回 409，前端弹确认框后带 `force=true` 重试。
- plan / search / review 全部在这个 projectRoot 上，复用现有所有端点和依赖注入。
- 首次启动若 `workspace/default` 不存在，自动创建空目录。

## 4. API 端点设计

所有新增端点需 token + Origin，沿用现有 `mapMutationError` 错误映射和 `applySecurityHeaders`。

### 4.1 POST /api/project/create

从文稿内容创建项目（不暴露文件路径）。

请求体（Zod 严格校验）：

```jsonc
{
  "content": "文稿正文文本",        // 必填，非空
  "fileName": "script.md",         // 可选，用于推断 .md/.txt
  "title": "可选标题",
  "language": "zh-CN",             // 默认 zh-CN
  "aspectRatio": "9:16",           // 默认 9:16
  "style": "knowledge",            // 默认 knowledge
  "intendedUse": "commercial_capable",
  "willModify": true,
  "force": false
}
```

后端：

- 新增 `createProjectFromContent` use case（基于 `createProject`，接受 `content: Uint8Array` + `originalFileName` 而非 `scriptPath`，跳过路径读取，其余流程一致）。
- 写入绑定的 projectRoot。
- 成功返回 `{ project: ReviewProjectView }`（复用 `getReviewProject`）。

### 4.2 POST /api/project/plan

请求体：

```jsonc
{
  "provider": "fixture",     // fixture | deepseek | stepfun
  "maxScenes": 12,           // 可选，默认 12
  "force": false
}
```

后端调 `planProject` use case。请求体的 `provider` 决定用哪个 planner；该 planner 所需的 key 从 settings 读取（见 §6.4）。返回 `{ project }`。

### 4.3 POST /api/project/search

请求体：

```jsonc
{
  "provider": "pexels",      // fixture | pexels
  "refresh": false,
  "limit": 12
}
```

后端调 `searchProjectAssets` use case（全项目搜索，非单场景）。返回 `{ project }`。

## 5. 前端组件设计

### 5.1 LandingView（新）

无项目或项目可重建时的引导页：

- 文稿上传（文件选择 `.md`/`.txt`）或粘贴文本框。
- 元数据选择：语言、比例、风格、用途、是否修改（带合理默认值）。
- 「一键生成」按钮：串行调用 create → plan → search。
- 若 `force` 需求（已有项目），弹确认框。

### 5.2 PlanProgress

plan 是 LLM 调用（fixture 即时，真实 planner 几秒到几十秒）。前端在三步串行过程中显示分步进度态：「创建项目中… → 正在切片… → 正在搜索素材…」。

### 5.3 现有组件接管

plan + search 完成后，现有 `SceneList / SceneDetail / Inspector` 正常显示。CandidateCard 的 provider 下拉框（步骤 1 前序已实现）继续用于单场景重检索。

## 6. API Key 前端化（子系统②）

### 6.1 持久化

- 存在 **workspace 根目录**（即 `./workspace/`，与 projectRoot `./workspace/default` 同级）的 `.s2s/settings.json`，完整路径 `./workspace/.s2s/settings.json`，加入 `.gitignore`（不入 git）。
- 不放进项目目录内——S1 单项目模型下 create 会覆盖项目目录，key 不能跟着丢。
- 结构：

```jsonc
{
  "plannerProvider": "fixture",
  "deepseekApiKey": "...",
  "deepseekBaseUrl": "https://api.deepseek.com",
  "deepseekModel": "...",
  "stepApiKey": "...",
  "stepBaseUrl": "https://api.stepfun.com/v1",
  "stepModel": "step-3.7-flash",
  "pexelsApiKey": "...",
  "pexelsBaseUrl": "",
  "pexelsVideoBaseUrl": ""
}
```

- 后端启动加载 `settings.json`，优先级：`settings.json > .env`（向后兼容已配 `.env` 的用户）。

### 6.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 返回**脱敏视图**：每个 key 只返回 boolean（已设/未设）+ provider 配置，不返回明文 |
| PUT | `/api/settings` | 持久化到 `settings.json`（需 token + Origin） |

GET 响应示例：

```jsonc
{
  "plannerProvider": "fixture",
  "hasDeepseekKey": false,
  "hasStepKey": false,
  "hasPexelsKey": true,
  "deepseekBaseUrl": "https://api.deepseek.com",
  "deepseekModel": "",
  "stepBaseUrl": "https://api.stepfun.com/v1",
  "stepModel": "step-3.7-flash"
}
```

### 6.3 SettingsPanel（新前端组件）

TopBar 加齿轮按钮 → 弹设置面板：

- Planner provider 选择（fixture / deepseek / stepfun）。
- 对应 provider 的 key / baseURL / model 输入框。
- Pexels API key 输入框。
- key 字段用 `password` 类型，不显示明文。
- 保存调 PUT `/api/settings`。

### 6.4 Provider 工厂读取顺序

`createSearchProvider` / planner 工厂的 env 来源改为：settings.json 优先，.env fallback。无 key 时抛带 code 的错误，前端识别后引导去设置页。

## 7. 一行启动

新增 `pnpm start` 脚本：

```
pnpm build:all && node dist/cli/index.js review ./workspace/default --open
```

- `--open` 自动开浏览器（去掉现有 `--no-open`）。
- token 自动带在 URL（已实现，`?token=xxx` 前端自动提取）。
- 首次启动若 `workspace/default` 不存在，自动创建空目录。

非技术用户最终体验：一行命令 / 双击 → 自动构建 + 启动 + 开浏览器 → 看到 LandingView（若 key 未配则提示去设置页填一次）→ 粘贴文稿 → 一键生成 → 审核。外部 API key 只需在前端填一次，后端持久化，之后不再碰。

## 8. 错误处理

沿用现有 `mapMutationError` + 前端 `ActionError` 组件。

| 场景 | HTTP | 前端提示 |
|---|---|---|
| create 时已有项目且 force=false | 409 | 弹确认框 → 带 force=true 重试 |
| plan 时项目未创建 | 409 | "请先上传文稿" |
| planner provider key 缺失 | 400 + code | "API key 未配置，去设置页填写" |
| pexels key 缺失 | 400 + code | 同上 |
| pexels 限流 | 429 | "请求过频，稍后重试" |
| settings 格式错误 | 400 | 字段级提示 |
| settings 文件写入失败 | 500 | "保存失败，检查磁盘权限" |

所有外部输入走 Zod 严格校验；key 缺失时返回带 code 的错误，前端识别 code 后引导去设置页。

## 9. 测试

遵循"单元测试不调真实外部服务"原则。

- 后端 HTTP 路由测试：用 fixture provider + injected fake，覆盖 create / plan / search / settings 端点。
- `createProjectFromContent` use case 单元测试：接受 bytes，断言写入 + 元数据正确。
- settings 读写测试：脱敏视图不返回明文、持久化可读回、.env fallback。
- 前端组件测试：`LandingView`、`SettingsPanel`、`PlanProgress`（testing-library，已有依赖）。
- 复用现有 vitest + jsdom。

## 10. 范围声明

本设计是 Phase 1 范围内的**体验增强**：把 init / plan / search 从 CLI 搬到前端 + API key 前端化 + 一行启动。

明确**不包含**：

- ASR、时间轴对齐、渲染、自动下载第三方素材、云端账户、数据库。
- 多项目管理（S1 单项目模型）。
- 多素材源扩充（步骤 2/3，后续）。

需更新 `README.md` milestone 记录，明确这是新的体验增强里程碑。严格遵守"前端不碰文件系统 / 外部输入 Zod 校验 / 写操作走 repository 原子写入 / 不提交 secrets"。

## 11. 交付物清单

- 后端：`createProjectFromContent` use case、`/api/project/create|plan|search` 路由、`/api/settings` GET/PUT 路由、settings 持久化模块、provider 工厂读取顺序调整。
- 前端：`LandingView`、`SettingsPanel`、`PlanProgress`、review-api 客户端新增方法、App.tsx 视图切换。
- 启动：`pnpm start` 脚本、`workspace/default` 自动创建、`--open` 默认开启。
- 测试：上述各模块单元/集成测试。
- 文档：README milestone 更新。
