# AI 素材生成（阶段 2）Spec

> 定位：在阶段 1 素材发现基础上，为每个场景增加「AI 生成图片」按钮，调用 StepFun 文生图模型生成候选图，作为搜索候选的补充。
> 本 spec 覆盖**阶段 2**：文生图按钮 + 预留视频生成接口。阶段 3（多项目 + 去 token）另见 spec。

## 1. 目标与非目标

**目标**
- 每个场景可独立点「生成图片」按钮，调用 StepFun 文生图 API 生成一张图片。
- 生成结果作为一种新的候选 `kind: "generated"`，持久化到 `scene.search.candidates`，与图库/链接候选混排在同一网格。
- 生成图片的 prompt 由场景的 `summary` + `visualKeywords` 自动组装，用户可在生成前编辑 prompt。
- 预留 `VideoGenerator` 接口（Application port），不实现具体 provider，仅定义契约以便未来扩展。
- Settings 增加 `stepImageModel` 字段，前端 SettingsPanel 增加对应配置。

**非目标（阶段 2 不做）**
- 不实现文生视频 provider（只定义接口 + fixture stub）。
- 不自动下载生成图片到本地（生成的图片 URL 是临时的，用户可手动保存或重新生成）。
- 不做批量生成（一键生成所有场景的图片）。
- 不做生成历史/版本管理。
- 不做图片后处理（放大、裁剪、风格迁移等）。

## 2. 核心流程

1. 用户在场景详情区点「生成图片」→ 弹出 prompt 编辑框（预填自动组装的 prompt）。
2. 用户确认 prompt → `POST /api/scenes/:sceneId/generate`（body: `{ prompt, aspectRatio? }`）。
3. 后端调 `generateSceneImage` use case → 调用 `ImageGenerator` port（StepFun 实现）。
4. 生成结果转为 `AssetCandidateGenerated`，追加到 `scene.search.candidates`，更新 `lastSearchedAt`。
5. 返回 fresh project view，前端刷新候选网格。

Prompt 组装规则（后端自动，用户可改）：
- 取场景 `summary` 作为主体描述。
- 取 `visualKeywords` 前 3 个作为视觉关键词。
- 拼接为：`{summary}，{keyword1}，{keyword2}，{keyword3}`。
- 加上比例约束（如 `9:16` 竖屏）。

## 3. 数据模型变化

**`AssetCandidate` 联合类型新增第三种 kind：`generated`**

```ts
AssetCandidateGeneratedSchema = z.strictObject({
  kind: z.literal("generated"),
  id: IdSchema,
  provider: AssetProviderSnapshotSchema,   // 生成器 provider 快照
  prompt: NonEmptyTrimmedStringSchema,      // 生成用的 prompt
  imageUrl: HttpsUrlSchema,                 // 生成图片 URL（临时）
  thumbnailUrl: HttpsUrlSchema,             // 缩略图 URL（同 imageUrl）
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  orientation: z.enum(["portrait", "landscape", "square"]),
  model: NonEmptyTrimmedStringSchema,       // 使用的模型名
  generatedAt: UtcDateTimeSchema,
  matchedQueryId: IdSchema,                 // 用场景首个 enabled query 的 id
  rank: PositiveIntegerSchema,
});
```

**去重规则**：generated 候选按 `[provider.id, model, prompt]` 去重（同一 prompt 同一模型不重复追加）。

**兼容性**：`AssetCandidateSchema` 改为 `discriminatedUnion("kind", [asset, link, generated])`。旧项目无 generated 候选，不影响读取。

## 4. Application 层

### 4.1 新 Port：`ImageGenerator`

```ts
// src/application/ports/image-generator.ts
export interface ImageGenerateInput {
  readonly prompt: string;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly model?: string;
}

export interface ImageGenerateResult {
  readonly imageUrl: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly model: string;
  readonly providerSnapshot: AssetProviderSnapshot;
}

export interface ImageGenerator {
  readonly providerId: string;
  readonly providerSnapshot: AssetProviderSnapshot;
  generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
}
```

### 4.2 新 Port：`VideoGenerator`（预留，不实现）

```ts
// src/application/ports/video-generator.ts
export interface VideoGenerateInput {
  readonly prompt: string;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly durationSeconds?: number;
  readonly model?: string;
}

export interface VideoGenerateResult {
  readonly videoUrl: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly model: string;
  readonly providerSnapshot: AssetProviderSnapshot;
}

export interface VideoGenerator {
  readonly providerId: string;
  readonly providerSnapshot: AssetProviderSnapshot;
  generate(input: VideoGenerateInput): Promise<VideoGenerateResult>;
}
```

### 4.3 新 Use Case：`generateSceneImage`

```ts
// src/application/generate-scene-image.ts
export interface GenerateSceneImageInput {
  readonly projectRoot: string;
  readonly sceneId: string;
  readonly prompt: string;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
}

export interface GenerateSceneImageDeps {
  readonly repository: ProjectRepository;
  readonly imageGenerator: ImageGenerator;
  readonly idGenerator: { generate(): string };
  readonly now: () => Date;
}

export async function generateSceneImage(
  input: GenerateSceneImageInput,
  deps: GenerateSceneImageDeps,
): Promise<SpeechToSceneProject>;
```

流程：
1. 加载项目 → deep clone。
2. 找到 scene → 调 `imageGenerator.generate({ prompt, aspectRatio })`。
3. 构造 `AssetCandidateGenerated`（rank = 当前 candidates 最大 rank + 1）。
4. 追加到 `scene.search.candidates`，更新 `lastSearchedAt`。
5. 重新验证 → 保存 → 返回。

### 4.4 Prompt 自动组装

```ts
// src/application/generate-scene-image.ts
export function buildGenerationPrompt(scene: Scene): string {
  const parts = [scene.summary];
  const keywords = scene.visualPlan.visualKeywords.slice(0, 3);
  parts.push(...keywords);
  return parts.join("，");
}
```

## 5. Infrastructure 层

### 5.1 StepFun Image Generator

```ts
// src/providers/stepfun/stepfun-image-generator.ts
export class StepFunImageGenerator implements ImageGenerator {
  readonly providerId = "stepfun-image";
  readonly providerSnapshot: AssetProviderSnapshot = { ... };
  // 调用 StepFun 文生图 API（OpenAI-compatible /images/generations 或 StepFun 专用端点）
  async generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
}
```

StepFun 文生图 API：
- 端点：`POST {baseUrl}/images/generations`（OpenAI-compatible 格式）
- Body：`{ model, prompt, n: 1, size: "1024x1024" | "1024x1792" | "1792x1024" }`
- 响应：`{ data: [{ url }] }`
- 比例映射：`9:16 → 1024x1792`，`16:9 → 1792x1024`，`1:1 → 1024x1024`

### 5.2 Fixture Image Generator（测试用）

```ts
// src/providers/fixture/fixture-image-generator.ts
export class FixtureImageGenerator implements ImageGenerator {
  readonly providerId = "fixture-image";
  // 返回固定的 placeholder 图片 URL + 固定尺寸
  async generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
}
```

返回 `https://placehold.co/1024x1792` 等 placeholder URL，不调网络。

## 6. API 变化

### 6.1 POST /api/scenes/:sceneId/generate

请求体（Zod 严格校验）：

```jsonc
{
  "prompt": "生成图片的提示词",    // 必填，非空
  "aspectRatio": "9:16"           // 可选，默认取项目 aspectRatio
}
```

后端：调 `generateSceneImage` use case。返回 `{ project }`。

### 6.2 路由注册

`router.ts` 新增 generate 路由。`ReviewServerDependencies` 新增 `generateSceneImage?` 可选依赖。

## 7. Settings 扩展

`Settings` / `SettingsView` / `SaveSettingsBodySchema` 新增：
- `stepImageModel?: string`（默认 `"step-image-edit-2"`）

`createImageGenerator` 工厂函数：
- `fixture` → FixtureImageGenerator（无 key）
- `stepfun` → StepFunImageGenerator（需 stepApiKey）

读取顺序同 planner：settings.json 优先 > .env fallback。

## 8. 前端 UI 变化

### 8.1 SceneDetail

在「搜索素材」按钮旁加「生成图片」按钮：
- 点击后弹出 prompt 编辑框（预填 `buildGenerationPrompt` 结果）。
- 确认后调 `POST /api/scenes/:sceneId/generate`。
- 生成中显示 loading 态。

### 8.2 CandidateCard

新增 `generated` kind 卡片渲染：
- 显示生成图片缩略图。
- 显示 prompt（截断）+ model 名。
- 「重新生成」按钮（用相同 prompt 再生成一张）。

### 8.3 review-api.ts

新增方法：
```ts
async generateSceneImage(sceneId: string, input: {
  prompt: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
}): Promise<ReviewProjectView>;
```

### 8.4 types.ts

新增 `ReviewAssetCandidateGeneratedView` 接口，更新 `ReviewAssetCandidateView` 联合类型。

## 9. 架构边界（遵循 AGENTS.md）

- `ImageGenerator` / `VideoGenerator` 是 Application port；StepFun / Fixture 是 infra provider。
- Domain schema（asset-schema.ts）只加 `generated` kind，不导入 HTTP/SDK。
- 外部输入 `unknown` until Zod validated。
- React 只调本地 API。
- 写操作走 repository 原子写入。
- 单元测试不调真实 StepFun API（用 fixture 或 fake client）。

## 10. 测试

- `AssetCandidateSchema` 新增 generated kind 验证（正例 + 反例）。
- `generateSceneImage` use case 单测：mock ImageGenerator，断言候选追加 + rank 递增 + lastSearchedAt 更新。
- StepFun image generator 单测：fake HTTP client，解析 `/images/generations` 响应 → ImageGenerateResult。
- Fixture image generator 单测：返回 placeholder URL。
- HTTP 路由测试：`POST /api/scenes/:sceneId/generate` 端点（fixture provider）。
- 前端：SceneDetail 生成按钮 + prompt 编辑框 + generated 候选卡片渲染。
- 回归：现有搜索/创建/规划流程不破。

## 11. 交付物清单

- Domain：`AssetCandidateGeneratedSchema` + 联合类型扩展。
- Application：`ImageGenerator` port、`VideoGenerator` port（预留）、`generateSceneImage` use case、`buildGenerationPrompt` 纯函数。
- Infrastructure：StepFun image generator、Fixture image generator、`createImageGenerator` 工厂。
- API：`POST /api/scenes/:sceneId/generate` 路由、`ReviewServerDependencies.generateSceneImage`。
- Settings：`stepImageModel` 字段 + SettingsPanel UI。
- 前端：SceneDetail 生成按钮 + prompt 弹框、CandidateCard generated 渲染、review-api `generateSceneImage` 方法、types 扩展。
- 测试：上述各模块单元测试。
- 文档：README milestone 更新。
