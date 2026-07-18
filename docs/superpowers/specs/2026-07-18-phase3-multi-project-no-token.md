# 多项目列表 + 去 Token（阶段 3）Spec

> 定位：从「单项目绑定」升级为「workspace 多项目列表」，并移除 session token 依赖（仅靠 loopback 边界 + Host/Origin 校验），让非技术用户一行启动后零配置进入。
> 本 spec 覆盖**阶段 3**：项目列表页 + 去 token。阶段 2（文生图）另见 spec。

## 1. 目标与非目标

**目标**
- Review Server 启动时扫描 `workspace/` 目录，列出所有子项目（含 `project.s2s.json` 的目录）。
- 前端新增项目列表页，可切换/新建/删除项目。
- 移除 session token 机制：所有 API 不再要求 `X-S2S-Session` header，URL 不再需要 `?token=`。
- 安全模型简化为：loopback 绑定（127.0.0.1）+ Host 校验 + Origin 校验（防 DNS rebinding + CSRF）。
- `pnpm start` 一行启动后自动开浏览器，零配置直达项目列表或上次项目。

**非目标（阶段 3 不做）**
- 不做项目导入/导出。
- 不做项目模板。
- 不做项目间素材共享。
- 不做云端同步。
- 不做远程访问（仍只监听 loopback）。

## 2. 安全模型变更

### 2.1 移除 Token

**现状**：所有 mutating routes 需 `X-S2S-Session` header；GET /api/project 也需 token。

**变更后**：
- 移除 `validateSessionToken` 调用（所有路由）。
- 移除 `TOKEN_GATED_PATHS` 集合。
- 移除 `ReviewServerConfig.token` 字段。
- 移除 `ReviewServerHandle.token` 字段。
- 移除前端 `resolveSessionToken` / `saveSessionToken` / token header 逻辑。
- `pnpm start` 不再生成/传递 token。
- URL 不再需要 `?token=`。

### 2.2 保留的安全层

| 层 | 保留 | 说明 |
|---|---|---|
| Loopback 绑定 | ✅ | 只监听 127.0.0.1，不暴露外网 |
| Host 校验 | ✅ | 拒绝非 loopback Host header（防 DNS rebinding） |
| Origin 校验 | ✅ | mutating routes 校验 Origin（防 CSRF） |
| Security headers | ✅ | CSP / X-Content-Type-Options 等不变 |
| Token | ❌ 移除 | loopback + Host + Origin 已足够 |

**安全论证**：
- 本工具是本地单用户工具，不像 Jupyter 那样可能暴露到局域网。
- Host 校验防止 DNS rebinding（恶意域名解析到 127.0.0.1）。
- Origin 校验防止浏览器 CSRF（恶意网站跨域请求）。
- 唯一残余风险：本机其他进程调用 API。但本机已有代码执行权限的进程可做更大危害，token 不增加实质安全。

## 3. 多项目模型

### 3.1 Workspace 扫描

Review Server 启动时扫描 `workspace/` 直接子目录：
- 含 `project.s2s.json` 的目录 → 已有项目。
- 不含的 → 忽略（不报错）。
- `workspace/.s2s/` 目录 → 跳过（是 settings 目录，不是项目）。

### 3.2 活跃项目

- Server 启动时：若 `workspace/default` 存在且含项目文件 → 设为活跃项目；否则活跃项目为 null（显示项目列表页）。
- 切换项目：`POST /api/project/switch` 更新 server 的 `projectRoot`，后续所有 `/api/project*` / `/api/scenes*` 操作作用于新项目。
- 新建项目：`POST /api/project/create` 的 `projectDirectory` 从 server 配置的 `workspaceRoot` + body 中的 `projectName` 推导（默认 `default`）。

### 3.3 配置变更

```ts
// ReviewServerConfig 变更
interface ReviewServerConfig {
  readonly workspaceRoot: string;    // 新增：workspace 根目录
  readonly projectRoot: string;      // 保留：当前活跃项目（可运行时切换）
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly staticRoot?: string;
  // token 字段移除
}
```

`projectRoot` 从 `readonly` 改为可变（server 内部维护 `currentProjectRoot` 状态）。

## 4. API 变化

### 4.1 GET /api/projects（新）

列出 workspace 下所有项目。

响应：
```jsonc
{
  "ok": true,
  "projects": [
    {
      "name": "default",
      "path": "default",
      "hasProject": true,
      "title": "我的第一个项目",
      "sceneCount": 8,
      "updatedAt": "2026-07-18T10:00:00Z",
      "isActive": true
    },
    {
      "name": "demo2",
      "path": "demo2",
      "hasProject": true,
      "title": "第二个项目",
      "sceneCount": 5,
      "updatedAt": "2026-07-17T15:00:00Z",
      "isActive": false
    }
  ],
  "activeProject": "default"
}
```

### 4.2 POST /api/project/switch（新）

切换活跃项目。

请求体：
```jsonc
{
  "project": "demo2"   // workspace 下的目录名
}
```

后端：
- 校验目录存在且含 `project.s2s.json`（否则 404）。
- 更新 server `currentProjectRoot`。
- 返回 `{ project: ReviewProjectView }`（新活跃项目的视图）。

### 4.3 DELETE /api/project（新）

删除当前活跃项目（删除目录下所有文件）。

请求体：
```jsonc
{
  "confirm": "项目名确认"   // 必须输入项目名确认
}
```

后端：
- 校验 `confirm` 等于当前项目目录名。
- 删除项目目录下所有文件（`project.s2s.json`、`script.md`、`assets/`、`cache/`、`logs/`）。
- 不删除 `workspace/.s2s/`（settings 保留）。
- 活跃项目设为 null。
- 返回 `{ ok: true }`。

### 4.4 POST /api/project/create（变更）

body 新增可选 `projectName?: string`（默认 `"default"`）。
- `projectDirectory` = `workspaceRoot/projectName`。
- 若目录已有项目且 `force=false` → 409。
- 创建后自动设为活跃项目。

### 4.5 现有路由

`GET /api/project`、`POST /api/project/plan`、`POST /api/project/search`、`PATCH /api/scenes/:sceneId` 等全部作用于 `currentProjectRoot`（运行时可变）。

### 4.6 Token 移除

- 所有路由不再校验 `X-S2S-Session`。
- `GET /api/project` 不再 token-gated。
- 前端 `ReviewApiClient` 不再发送 token header。
- `resolveSessionToken` / `saveSessionToken` 删除。
- URL `?token=` 参数忽略（向后兼容旧书签，不报错）。

## 5. 前端 UI 变化

### 5.1 ProjectListView（新）

无活跃项目或用户主动切换时显示：
- 项目卡片列表：项目名、标题、场景数、更新时间、活跃标记。
- 每张卡片：「打开」按钮（switch）、「删除」按钮（确认后 delete）。
- 顶部「新建项目」按钮 → 跳转 LandingView。

### 5.2 TopBar 变更

- 加「项目列表」按钮（返回 ProjectListView）。
- 显示当前项目名。
- 移除 token 相关 UI（ErrorView 的 token 输入框移除）。

### 5.3 App.tsx 变更

```ts
type AppView =
  | { kind: "project-list" }
  | { kind: "landing"; projectName: string }
  | { kind: "review" };
```

- 启动时先 `GET /api/projects`：
  - 有活跃项目 → review 视图。
  - 无活跃项目 → project-list 视图。
- 用户可随时切换视图。

### 5.4 review-api.ts 变更

- 移除 `token` 字段 + `getHeaders()` 中的 `X-S2S-Session`。
- 新增 `listProjects()`、`switchProject(name)`、`deleteProject(confirm)`。
- `createProject` 新增 `projectName` 参数。
- `resolveSessionToken` / `saveSessionToken` 删除。

### 5.5 types.ts 变更

新增 `ProjectListItem` / `ProjectsApiResponse` 接口。

## 6. CLI 变更

### 6.1 `s2s review` 命令

- `--token` 选项移除（忽略不报错，向后兼容）。
- 默认 projectRoot 仍为参数，但若不传则用 `workspaceRoot/default`。
- 启动时扫描 workspace 列出项目，终端输出项目列表。

### 6.2 `pnpm start`

```bash
pnpm build:all && node dist/cli/index.js review
```

- 不传 projectRoot → 默认 `./workspace/default`。
- 若 `workspace/default` 不存在 → 自动创建空目录。
- 自动开浏览器（`--open` 默认）。
- URL 无 `?token=`。

## 7. 架构边界（遵循 AGENTS.md）

- 项目扫描逻辑在 Infrastructure 层（文件系统操作）。
- Application 层新增 `listProjects` / `switchProject` use case（依赖 ProjectRepository + workspace path）。
- HTTP 路由层调 use case，不直接操作文件系统。
- 外部输入 `unknown` until Zod validated。
- React 只调本地 API。
- 写操作走 repository 原子写入。
- 删除项目操作需二次确认（项目名匹配）。

## 8. 兼容性

- 现有 `workspace/default` 项目继续可用。
- 旧 URL 带 `?token=` 不报错（前端忽略 token 参数）。
- `.env` 中的 token 配置忽略（不报错）。
- `--token` CLI 选项忽略（不报错）。
- 项目数据 schema 不变（不需要 migration）。

## 9. 测试

- `listProjects` use case 单测：mock workspace 扫描，返回项目列表。
- `switchProject` use case 单测：切换活跃项目 + 校验目录存在。
- `deleteProject` use case 单测：确认名匹配 + 文件删除 + 活跃项目清空。
- HTTP 路由测试：`GET /api/projects`、`POST /api/project/switch`、`DELETE /api/project`。
- 安全测试：无 token 请求成功通过（mutating + GET）。
- 前端：ProjectListView 渲染 + 切换 + 删除确认。
- 回归：现有创建/规划/搜索/审核流程不破。
- 回归：`GET /api/project` 无 token 仍正常返回。

## 10. 交付物清单

- Application：`listProjects` use case、`switchProject` use case、`deleteProject` use case。
- Infrastructure：workspace 扫描模块（`scan-workspace.ts`）。
- API：`GET /api/projects`、`POST /api/project/switch`、`DELETE /api/project` 路由；`createProject` 加 `projectName`。
- Security：移除 token 校验（session-token.ts、request-security.ts、review-server.ts、TOKEN_GATED_PATHS）。
- 前端：ProjectListView 组件、TopBar 项目切换、App.tsx 视图路由、review-api 去 token + 新方法、types 扩展。
- CLI：`s2s review` 去 `--token`、`pnpm start` 简化。
- 测试：上述各模块单元测试。
- 文档：README milestone 更新。
