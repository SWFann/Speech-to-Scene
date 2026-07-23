# Speech-to-Scene

Speech-to-Scene 是一个本地优先、人在回路中的口播视觉素材规划工具。

当前目标是把 Markdown/TXT 口播稿转换成可执行的语义场景和高质量素材清单：

```text
文稿 → AI 语义场景 → 多源素材检索 → 授权与画幅排序 → 查看下载 / AI 生图
```

项目目前可作为本地 Demo 使用：支持多项目工作区、StepFun 场景规划与生图、多源真实素材检索，以及面向非技术用户的浏览器工作流。

## 当前范围

计划支持：

- Markdown/TXT 文稿；
- Fixture / DeepSeek / StepFun 可插拔 LLM Planner；
- Pexels、Pixabay、Unsplash、Openverse 多源素材候选；
- 本地审核页面；
- 站外来源查看与生成图片本地持久化；
- 来源、许可和署名信息记录；
- 项目完整性检查。

当前不包含视频渲染、ASR、时间轴、自动下载第三方素材、云端账户或数据库。

## 本地 Review Server

M4～M5 实现了一个本地 HTTP Review Server，内置 React Review Board UI，供 CLI 用户在浏览器中审核场景、选择候选、上传本地素材。

### 启动方式

```bash
# 1. 构建后端和前端
pnpm build:all

# 2. 启动 Review Server（自动服务 web/dist 构建产物）
node dist/cli/index.js review ./demo --no-open
```

### 一键启动（面向非技术用户）

```bash
pnpm start
```

`pnpm start` 会自动构建前后端、在 `./workspace` 启动 Review Server、并打开浏览器。首次打开显示项目列表页，可新建项目、粘贴口播文稿一键生成场景与素材候选。外部 API Key（Pexels / DeepSeek / StepFun）在前端「设置」面板配置一次即可，保存在 `./workspace/.s2s/settings.json`（不入 Git）。

开发模式（后端通过 tsx 运行，前端通过 Vite dev server）：

```bash
# 终端 1：前端 dev server（http://localhost:5173）
pnpm web:dev

# 终端 2：后端 Review Server（http://127.0.0.1:3210）
pnpm s2s review ./demo --no-open
```

> 开发模式下，前端 Vite dev server 会代理 `/api/*` 请求到后端 Review Server，无需手动构建前端。

选项：

- `--host <host>`：绑定地址，默认 `127.0.0.1`（仅监听 loopback）
- `--port <port>`：端口，默认 `3210`（`0` 表示 OS 分配）
- `--no-open`：不自动打开浏览器
- `--workspace-root <path>`：工作区根目录，默认当前目录
- `--token <token>`：已废弃（向后兼容，自动忽略）

启动后，终端会输出 URL：

```text
Review server started:
  Workspace: /path/to/workspace
  URL:       http://127.0.0.1:3210
  Press Ctrl+C to stop
```

直接在浏览器打开 URL 即可进入项目列表页面。如果 `web/dist` 尚未构建，页面会显示 503 引导提示，API 端点仍然可用。

### React Review Board UI

React Review Board 提供：

- 项目列表视图（Phase 3）：查看工作区内所有项目，切换、新建、删除项目
- 三步式新建项目流程（文稿、画幅、内容风格）
- 桌面双栏与移动端上一个/下一个场景导航
- 多来源素材聚合；可用素材与站外搜索入口分开展示
- 单场景重新检索与 StepFun AI 图片生成
- 素材来源、署名、商用和修改条件提示

### API 能力

| 方法   | 路径                           | 说明                                        |
| ------ | ------------------------------ | ------------------------------------------- |
| GET    | `/api/health`                  | 服务器健康状态                              |
| GET    | `/api/projects`                | 工作区项目列表（Phase 3）                   |
| POST   | `/api/project/switch`          | 切换当前活跃项目（Phase 3）                 |
| DELETE | `/api/project`                 | 删除当前活跃项目（Phase 3，需确认）         |
| GET    | `/api/project`                 | 当前项目 UI-safe 视图                       |
| POST   | `/api/project/create`          | 从文稿创建项目（Phase 3，支持 projectName） |
| POST   | `/api/project/plan`            | 规划项目场景                                |
| POST   | `/api/project/search`          | 批量素材搜索                                |
| PATCH  | `/api/scenes/:sceneId`         | 更新场景视觉决策（需要 Origin）             |
| PUT    | `/api/scenes/:sceneId/queries` | 替换场景搜索 queries（需要 Origin）         |
| POST   | `/api/scenes/:sceneId/search`  | 单场景素材搜索（需要 Origin）               |
| GET    | `/api/settings`                | 获取设置面板状态                            |
| PUT    | `/api/settings`                | 保存设置面板配置（需要 Origin）             |

### 安全提示

- 默认只监听 `127.0.0.1`（loopback），不暴露到外网。
- Phase 3 移除了 session token 机制，改用三重校验：loopback 绑定 + Host header 验证 + Origin header 验证。
- Host / Origin gate 已启用，防止 DNS rebinding 和 CSRF。
- 本地素材上传只允许 PNG/JPEG，三层校验（magic bytes + MIME + extension），不支持 SVG。
- 项目删除需输入项目名确认，防止误删。
- **不要把项目文件、上传素材、cache、日志提交到 Git。**

### 静态服务安全

M5-03 增加了内置静态文件服务（`s2s review` 直接服务 `web/dist`），安全模型包括：

- **API 优先**：`/api/*` 路径永远不会触发静态服务，API 的 404/405/400 逻辑不受影响。
- **路径穿越防护**：三层校验（原始 URL `..` 检查、解码后 `..` 检查、`path.resolve` 边界检查），加上 `fs.realpath` 符号链接校验。
- **SPA Fallback**：非 API 的无后缀 GET 路径自动回退至 `index.html`，支持客户端路由。带后缀但文件不存在的路径返回 404。
- **静态安全头**：CSP 允许同源脚本/样式和 HTTPS 图片，`Referrer-Policy: no-referrer` 防止本地页面地址泄露。
- **构建缺失处理**：`web/dist` 不存在时返回 503 友好 HTML 页面，引导用户运行 `pnpm web:build`。

详见 [M4 Smoke Report](./docs/development/M4_SMOKE_REPORT.md)。

## 开发环境

- Node.js 24 LTS
- pnpm 11
- **推荐使用 WSL/Linux 环境运行 `pnpm install`、`pnpm test`、`pnpm build`**

### 平台注意事项

- **不要在 Windows 和 WSL 之间共享同一个 `node_modules`**。
  项目依赖的 native binding（如 `@rolldown/binding-*`）是平台相关的，
  WSL 安装的是 `binding-linux-x64-gnu`，Windows 需要 `binding-win32-x64-msvc`。
  混用会导致 Vitest 等工具启动失败。
- 如果切换平台（例如从 Windows 切到 WSL，或反之），
  请先删除 `node_modules`，然后在新平台上重新执行 `pnpm install`。
  `pnpm-lock.yaml` 是跨平台的，不需要删除。
- Codex 当前 Windows sandbox 无法直接访问 WSL distro（如 Ubuntu2），
  因此 `pnpm test` 以 Claude 在 WSL/Ubuntu2 中的输出为准。
- 所有 Codex / Claude 审计结果需要注明执行环境（操作系统、Node.js 版本、pnpm 版本）。

```bash
corepack enable
pnpm install
pnpm check
pnpm s2s --help
```

环境变量请从 `.env.example` 开始配置。CLI 会自动读取当前工作目录下的本地 `.env` 文件；任何 API Key 都不得提交到 Git。

## Quick Start

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm build:all

tmpdir=$(mktemp -d)
cat > "$tmpdir/script.md" <<'EOF'
# Demo

我们用一个本地优先的工具，把口播稿拆成可审核的视觉场景。
EOF

pnpm s2s init "$tmpdir/demo" --script "$tmpdir/script.md"
pnpm s2s plan "$tmpdir/demo" --provider fixture
pnpm s2s search "$tmpdir/demo" --provider fixture
pnpm s2s review "$tmpdir/demo" --no-open
pnpm s2s status "$tmpdir/demo"
pnpm s2s validate "$tmpdir/demo"
```

`fixture` provider 不调用外部服务，适合本地 smoke 和 CI。真实 planner 可选 DeepSeek 或 StepFun。

### StepFun Planner

StepFun 使用 OpenAI-compatible API，默认模型为 `step-3.7-flash`：

```bash
S2S_PLANNER_PROVIDER=stepfun
STEP_API_KEY=<redacted>
STEP_BASE_URL=https://api.stepfun.com/v1
STEP_MODEL=step-3.7-flash
```

运行：

```bash
pnpm s2s plan ./new-demo --provider stepfun --max-scenes 6
```

不要提交 `.env`，不要在 issue、日志、截图或报告中粘贴 API key。

## 开发命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

## 项目文档

- [第一阶段原始执行计划](./docs/planning/Speech-to-Scene_Phase1_Demo_Execution_Plan.md)
- [项目分析与修订建议](./docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md)
- [M1 详细实施计划（交给 Claude 执行）](./docs/milestones/M1_IMPLEMENTATION_PLAN.md)
- [M1 代码审计报告](./docs/milestones/M1_CODE_AUDIT_REPORT.md)
- [M2 详细实施计划](./docs/milestones/M2_IMPLEMENTATION_PLAN.md)
- [M2 代码审计报告](./docs/milestones/M2_CODE_AUDIT_REPORT.md)
- [M3 详细实施计划](./docs/milestones/M3_IMPLEMENTATION_PLAN.md)
- [M3 代码审计报告](./docs/milestones/M3_CODE_AUDIT_REPORT.md)
- [M4 详细实施计划](./docs/milestones/M4_IMPLEMENTATION_PLAN.md)
- [M4 Smoke Report](./docs/development/M4_SMOKE_REPORT.md)
- [开发环境基准记录](./docs/development/ENVIRONMENT.md)
- [项目 Schema](./docs/PROJECT_SCHEMA.md)
- [视觉语法](./docs/VISUAL_GRAMMAR.md)
- [素材许可策略](./docs/ASSET_LICENSING.md)
- [隐私说明](./docs/PRIVACY.md)
- [贡献指南](./docs/governance/CONTRIBUTING.md)
- [安全策略](./docs/governance/SECURITY.md)
- [行为准则](./docs/governance/CODE_OF_CONDUCT.md)
- [第三方声明](./docs/governance/THIRD_PARTY_NOTICES.md)

## 开源与素材许可

仓库代码采用 [MIT License](./LICENSE)。第三方图片、视频、音频及其许可证不因代码采用 MIT 而改变。项目只提供来源记录和许可辅助，不构成法律意见；使用者仍需在发布前核验具体素材页面、许可证、署名、肖像、商标和隐私要求。

## 状态

Phase 1（M1～M6）已完成 Demo ready：本地 Review Server、Project API、React Review Board UI、静态 serving、`s2s validate`、增强版 `s2s status` 和 StepFun planner 接入可用。

Phase 3 已完成：多项目工作区管理（`listProjects` / `switchProject` / `deleteProject` use case + `WorkspaceScanner` port）、移除 session token（改用 loopback + Host + Origin 三重校验）、AI 生图接入、前端 `ProjectListView` 和 `TopBar` 项目列表入口。新增 `GET /api/projects`、`POST /api/project/switch`、`DELETE /api/project` 路由，`createProject` 支持 `projectName` 参数。后续测试应聚焦真实脚本、真实 StepFun planner、多项目切换流程和素材授权核验。
