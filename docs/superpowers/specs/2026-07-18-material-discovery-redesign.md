# 素材发现重设计（阶段 1）Spec

> 定位转变：从"审核 + 选候选 + 本地素材"工具，变成"LLM 切片给关键词 + 人工按需多源搜索 + 展示链接预览"的极简素材发现工具。
> 本 spec 只覆盖**阶段 1**（核心简化 + 多源搜索）。阶段 2（文生图/视频）、阶段 3（多项目 + 去 token）各自单独 spec。

## 1. 目标与非目标

**目标**

- LLM 按语义切片，为每场给出 `summary` + `visualKeywords` + `queries`（检索词建议）。LLM **只给建议，不自动搜索**，由人决定是否/对哪场搜索。
- 每场可独立点「搜索素材」按钮触发多源搜索，省 token、省配额。
- 多源搜索：有 API 的图库自动出缩略图；无 API 的国内平台生成"带关键词搜索链接"卡片，用户自己点开跳转，不爬内容。
- 去掉审核状态机（`selected`/`skipped`/`stock_asset` 限制）与本地素材上传，UI 简化为两栏。

**非目标（阶段 1 不做）**

- 文生图/文生视频按钮（阶段 2）
- 多项目列表 + 去 token（阶段 3）
- 爬取小红书/抖音/B站/YouTube 内容（合规不允许，只做跳转链接）
- 任何"保存决策/导出"流程

## 2. 核心流程

1. 上传/粘贴文稿 → `POST /api/project/create`（force 覆盖）建项目。
2. `POST /api/project/plan`（StepFun/DeepSeek）切片：产出 N 场，每场含 `summary`、`narrativeRole`、`visualPlan.{decision,rationale,preferredMedia,visualKeywords}`、`queries`。**不触发搜索**。
3. 前端展示场景列表，每张卡片：序号、`summary`、关键词标签、`narrativeRole`、**「搜索素材」按钮**（默认未搜）。
4. 用户点某场「搜索素材」→ `POST /api/scenes/:sceneId/search`（多源聚合）：
   - 图库（Pexels/Pixabay/Unsplash/Openverse）→ 缩略图 + 来源页链接
   - 跳转链接（小红书/抖音/B站/YouTube）→ 平台名 + 关键词 + 打开按钮（无图）
5. 结果展示在该场下方，**不强制选、不审核**，仅供浏览/点开。

一键流 `handleCreate` 从 `create→plan→search` 改为 **`create→plan`**（只切片出关键词），search 交给每场按钮按需触发。

## 3. 数据模型变化

**场景保留字段**：`id`、`order`、`sourceRange`、`text`、`summary`、`narrativeRole`、`visualPlan`、`search.queries`。

**移除**：

- `review` 字段整段（`selection`、`skip`、`kind:pending/selected/skipped`）
- `visualPlan.decision` 的 `stock_asset` 限制语义（decision 仍保留作 LLM 建议，但不再 gating 搜索）
- 本地素材相关字段（`localAsset`、`attachLocalAsset` 路径）

**搜索结果（`search.candidates`）扩展为两种 kind**：

- `kind: "asset"`（图库结果，现有结构）：`thumbnailUrl`、`sourcePageUrl`、`provider`、`rights` 等
- `kind: "link"`（跳转链接，新增）：`platform`（"xiaohongshu"/"douyin"/"bilibili"/"youtube"）、`searchUrl`、`keyword`、无图

> Zod schema 相应更新：`AssetCandidate` 联合类型（discriminated union by `kind`）。

## 4. API 变化

### 4.1 `searchScene` 去限制

`src/application/search-scene-assets.ts` 移除"scene decision 必须 `stock_asset`，否则 `ProjectConflictError`"的检查（第 85/122 行）。**任何场景都能搜/重搜**。需求 1 的 409 随之消失。

### 4.2 多源聚合

`searchScene` / `searchProjectAssets` 改为聚合多个 `SearchProvider`：

- 现有：`fixture`、`pexels`
- 新增图库：`pixabay`、`unsplash`、`openverse`（各自一个 infra provider adapter，实现 `SearchProvider` 接口）
- 候选 `provider` 字段用各自 `providerId`。

调用策略：并发调用所有已配置 key 的图库 provider，合并候选；`fixture` 仍作无 key 时的回退。

### 4.3 跳转链接生成

新增 `LinkSuggestionGenerator`（纯函数，infra/无网络）：输入场景的 `queries`/`visualKeywords`，输出 4 个平台的搜索 URL 候选（`kind:"link"`）：

- 小红书：`https://www.xiaohongshu.com/search_result?keyword=<enc>`
- 抖音：`https://www.douyin.com/search/<enc>`
- B站：`https://search.bilibili.com/all?keyword=<enc>`
- YouTube：`https://www.youtube.com/results?search_query=<enc>`

`searchScene` 在图库结果后追加这些 link 候选。关键词用场景首个 enabled `query.query`，fallback 到首个 `visualKeyword`。

### 4.4 路由

- `POST /api/scenes/:sceneId/search` body 加可选 `providers?: string[]`（指定用哪些图库；默认全部已配置）。`refresh` 仍支持（跳过缓存）。
- `POST /api/project/search` 同样去 `stock_asset` 限制 + 多源聚合。
- 移除 `PUT /api/scenes/:sceneId/selection`、`PUT /api/scenes/:sceneId/skip`、`POST /api/scenes/:sceneId/local-asset` 路由（审核/本地素材去掉）。

## 5. UI 变化

**保留**：LandingView（上传）、TopBar（齿轮/重新上传/fixture 横幅）、分步进度（create→plan）、SettingsPanel。

**移除**：

- 最右侧 Inspector + LocalAssetUpload 面板
- "选候选 / skip / 上传本地素材"操作按钮
- `review` 状态展示

**新增/调整**：

- 场景卡片加「搜索素材」按钮 + 搜索状态标签（未搜 / 搜索中 / 已搜 N 条）。
- 场景详情区改为"搜索结果网格"：图库缩略图（可点开 sourcePageUrl）+ 平台链接卡片（平台名/关键词/打开按钮）。
- 布局从三栏（列表/详情/审核）简化成两栏（列表/详情含结果）。

## 6. 架构边界（遵循 AGENTS.md）

- Domain（schema/ports）不碰文件/HTTP/具体 provider。
- `SearchProvider` 是 Application port；Pexels/Pixabay/Unsplash/Openverse 都是 infra provider adapter。
- `LinkSuggestionGenerator` 是纯函数（infra，无网络），易测。
- 每个 new 图库 provider 一个独立 adapter 文件。
- 外部输入仍 `unknown` until Zod validated。
- React 只调本地 API，不碰文件系统。

## 7. 配置（Settings 扩展）

`Settings` 增加图库 key 字段（沿用 settings.json 优先 > .env）：

- `pixabayApiKey?`、`unsplashApiKey?`、`openverseApiKey?`（Openverse 实际无需 key，保留字段以备政策变更）
- `SettingsPanel` UI 加这些 key 输入框
- `getSettings`/`toView` 同步加 `hasPixabayKey`/`hasUnsplashKey`/`hasOpenverseKey`

provider 工厂 `assetProviderEnvFromSettings` + `createSearchProvider` 扩展支持 `pixabay`/`unsplash`/`openverse`。

## 8. 兼容性 / 迁移

- 现有 `project.s2s.json` 的 `review`/`localAsset` 字段：读取时忽略（向后兼容），写入时不再产生。schema 用 `.passthrough()` 或显式 strip。
- `workspace/default` 现有项目可继续打开（旧字段忽略）。
- `fixture` provider 保留，无 key 时仍能演示流程（假图 + 跳转链接）。

## 9. 测试

- `LinkSuggestionGenerator` 单测：关键词 → 4 平台 URL（编码正确）。
- 新图库 provider adapter 单测：用 fake HTTP client，解析各自的响应格式 → `AssetCandidate[]`。
- `searchScene` 去限制：非 stock_asset 场景搜索不再抛 conflict。
- 聚合：多 provider 结果合并 + link 候选追加。
- 前端：场景卡片搜索按钮 + 结果网格渲染（图库缩略图 + link 卡片）。
- 回归：create→plan 流程正常；现有 fixture/pexels 路径不破。

## 10. 不在范围（后续 spec）

- 阶段 2：文生图/文生视频按钮（StepFun image model）+ 预留视频接口
- 阶段 3：项目列表页（扫描 workspace）+ 去 token（loopback 边界）
