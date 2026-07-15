# M1 实施计划：Project Schema、Repository、`init` 与 `status`

> 目标执行者：Claude Code
> 后续审计者：Codex
> 基线提交：`be74654 chore: initialize phase-one project scaffold`
> 计划状态：可直接执行
> 里程碑边界：只实现 M1，不进入 M2

## 1. 目标与最终结果

M1 完成后，仓库必须拥有一套可执行、可验证、可安全持久化的 `project.s2s.json` V0.1 协议，并提供两个真实可用的命令：

```bash
s2s init <project-directory> --script <script-path>
s2s status <project-directory> [--json]
```

用户应能从一份 UTF-8 Markdown/TXT 文稿创建本地项目，随后读取项目的基础状态。整个过程不得调用 LLM、素材网站或其他网络服务。

M1 的交付物：

1. 严格的 Zod 4 持久化 Schema；
2. 从 Zod Schema 推导的 TypeScript 类型；
3. 跨字段、跨 Scene 的 Domain 不变量验证；
4. `ProjectRepository` Application Port；
5. JSON 文件 Repository；
6. 同目录临时文件、flush、原子发布与失败恢复；
7. 安全、跨平台的项目路径规则；
8. 事务式 `createProject` 用例；
9. 只读 `getProjectStatus` 用例；
10. `s2s init`、`s2s status` 和 `--json`；
11. 单元、契约、集成测试与固定 fixtures；
12. 完整的 `docs/PROJECT_SCHEMA.md`；
13. 原计划所需的自写示例脚本。

## 2. 开始前必须阅读

Claude 修改代码前必须完整阅读：

1. `AGENTS.md`
2. `CLAUDE.md`
3. 本文件
4. `docs/planning/Speech-to-Scene_Phase1_Demo_Execution_Plan.md` 第 4、6、11、12、13、14、15 节
5. `docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md` 第 3、4、5、8、9、11 节
6. `docs/PROJECT_SCHEMA.md`
7. `docs/ASSET_LICENSING.md`
8. 当前 `src/cli/index.ts`、测试和工程配置

M1 范围内出现冲突时，优先级为：

1. 本文件；
2. `AGENTS.md`；
3. `docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md`；
4. 原始执行计划。

不得默默选择另一套设计。若确实发现本文件内部无法同时满足的要求，应在最终报告中列出；能通过保守、局部解释解决的，不要停工等待。

## 3. 明确不做

M1 禁止实现：

- DeepSeek、Anthropic 或任何 LLM SDK；
- Prompt、文本分块算法或场景生成；
- Pexels、Openverse、Wikimedia 或任何素材搜索；
- 真实网络请求；
- Review Server、REST API、React、Vite 页面；
- 文件上传和本地素材导入流程；
- 自动下载第三方素材；
- `plan`、`search`、`review`、`validate` 命令；
- Schema migration 执行器；
- 数据库；
- YAML 素材目录加载器；
- 视频渲染、ASR、字幕、时间轴或 AI 生图；
- 为未来功能创建空洞的 service/controller；
- 提交或推送代码。

允许为未来字段定义并验证 Schema，但不得实现使用这些字段的 M2～M5 业务。实现结束后保留未提交工作树，交给 Codex 审计。

## 4. 已冻结的设计决策

Claude 不需要再次讨论下表，直接执行。

| 问题                                  | M1 决策                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `init` 时没有 Planner 结果            | 顶层固定写 `"generation": null`，`source.blocks` 和 `scenes` 均为空数组       |
| 有 Scene 但 generation 为 null        | 非法项目，Schema 拒绝                                                         |
| generation 非 null 但无 blocks/scenes | 非法项目，Schema 拒绝                                                         |
| Provider 是否用封闭枚举               | 不用；Provider ID 使用受约束、可扩展的普通字符串                              |
| DeepSeek 是否写进 Domain              | 不写；M1 只定义通用 generation metadata                                       |
| Scene 范围                            | `[start, end)` 半开区间，单位为 JavaScript UTF-16 code unit                   |
| LLM 字符偏移风险                      | 持久化 source blocks、block/quote anchor 和最终 range；M2 才实现生成/解析算法 |
| `review.status` 是否持久化            | 不持久化；只保存 discriminated review decision，由纯函数派生状态              |
| selected candidate 是否只存 ID        | 不是；必须保存选择时的完整、不可变审计快照                                    |
| 素材许可是否只存 attribution 文本     | 不是；必须有结构化 `AssetRights` 和 Provider 条款/证据快照                    |
| 内部路径格式                          | POSIX 相对路径；拒绝绝对路径、反斜杠、`.`、`..`、NUL 和 Windows 设备名        |
| 外部文稿                              | 一次读取，原始 bytes 复制到项目根的 `script.md` 或 `script.txt`               |
| Hash                                  | 对真正写入项目的原始 bytes 计算 SHA-256；不转换换行、不去 BOM                 |
| 文本长度                              | fatal UTF-8 解码后 JS `.length`，字段名 `textLengthUtf16`                     |
| 已存在目标                            | 一律拒绝，包括空目录；不覆盖、不合并、不复用                                  |
| 父目录                                | 必须已存在、是普通目录；M1 不递归创建缺失父目录                               |
| init 并发/no-clobber                  | 用独占 `mkdir` 预留最终目录；`project.s2s.json` 最后写入，作为完成标志        |
| init 失败清理                         | 仅在本进程持有匹配 sentinel 时删除本次独占创建的目录                          |
| init 进程崩溃                         | 可能遗留无项目 JSON 的目录；下次拒绝并提示人工检查，不自动删除                |
| JSON 格式                             | UTF-8、无 BOM、两空格、LF、文件末尾一个换行                                   |
| 未知 Schema 版本                      | 单独报错，绝不写回、修复、降级或迁移                                          |
| `status` 是否检查文稿 hash            | M1 不检查；只读取有效项目并返回基础派生状态                                   |
| M1 project status                     | generation null 为 `created`，非 null 为 `planned`；更细状态后续扩展          |
| 新依赖                                | 默认不增加；使用 Node.js 24、现有 Zod 和 Commander                            |

## 5. 建议文件结构

可按现有代码合理微调文件名，但职责边界不得改变。

```text
src/
├── cli/
│   ├── index.ts
│   ├── create-program.ts
│   ├── command-context.ts
│   ├── error-reporter.ts
│   └── commands/
│       ├── init-command.ts
│       └── status-command.ts
├── domain/
│   ├── schema-primitives.ts
│   ├── asset-schema.ts
│   ├── scene-schema.ts
│   ├── project-schema.ts
│   ├── asset-source-schema.ts
│   ├── project-validation.ts
│   └── project-status.ts
├── application/
│   ├── create-project.ts
│   ├── get-project-status.ts
│   └── ports/
│       ├── clock.ts
│       ├── id-generator.ts
│       ├── project-repository.ts
│       └── project-scaffolder.ts
├── infrastructure/
│   ├── atomic-write.ts
│   ├── json-project-repository.ts
│   ├── project-paths.ts
│   ├── source-document.ts
│   └── system-adapters.ts
└── shared/
    ├── constants.ts
    └── errors.ts

tests/
├── helpers/
│   ├── project-builder.ts
│   ├── temp-project.ts
│   ├── fixed-clock.ts
│   ├── fixed-id-generator.ts
│   ├── fault-injecting-file-ops.ts
│   └── repository-contract.ts
├── fixtures/
│   ├── scripts/
│   └── projects/
├── unit/
├── contract/
└── integration/

examples/
└── token-cost/
    └── script.md
```

不要把 Schema、Repository、CLI 和错误处理塞进少数大文件。也不要仅为了匹配目录树创建无意义 wrapper。

## 6. Zod 与 Domain 总原则

- Zod Schema 是持久化协议唯一事实来源；
- TypeScript 类型全部用 `z.infer` 推导，禁止重复手写 interface；
- 所有持久化对象递归使用 `z.strictObject` 或等效 strict 策略；
- 禁止 `.passthrough()`；
- 外部输入类型始终为 `unknown`；
- 不使用 `z.coerce`、隐式 default 或改变持久化数据的 transform；
- 默认不接受 `undefined` 或 `null`，只有协议明确声明的字段例外；
- 时间保存字符串，不使用 `z.date()`；
- 数字必须 finite，整数还要 safe；
- `z.record` 明确 key/value Schema；
- 许可证据中禁止 `any`、无限制 `unknown`；
- 单对象约束放自身 Schema，跨对象关系放明确 validator；
- `.superRefine()` 必须给精确 issue path；
- Domain 不导入 `fs`、HTTP、SDK、Commander 或 React；
- Repository 写入的是 parse 后的值，不能用 `as SpeechToSceneProject` 绕过；
- Zod 导出的 JSON Schema 不包含所有 refinement，文档必须说明；
- M2 以后给模型使用独立 PlannerOutputSchema，不能发送完整 Project Schema。

## 7. 基础常量与 primitives

至少定义并测试：

```ts
PROJECT_FILE_NAME = "project.s2s.json";
CURRENT_SCHEMA_VERSION = "0.1";
SOURCE_ENCODING = "utf-8";
SOURCE_OFFSET_UNIT = "utf16_code_unit";
MAX_PROJECT_FILE_BYTES = 10 * 1024 * 1024;
MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
```

基础 Schema：

- `IdSchema`：小写字母或数字开头，只允许小写字母、数字、点、下划线、短横线，长度 1～128；
- `Sha256Schema`：64 位小写十六进制；
- `UtcDateTimeSchema`：有效 ISO 8601 UTC 时间，必须以 `Z` 结尾；
- `HttpsUrlSchema`：有效 `https:` URL；
- `ProjectRelativePathSchema`：见第 16 节；
- 有界非空文本：不能只用 `.min(1)` 让纯空格通过；
- 正整数、非负整数、有限正数应分别定义。

不要重复实现日期、ID、Hash、URL 和路径规则。

## 8. 顶层项目协议

```ts
type SpeechToSceneProject = {
  schemaVersion: "0.1";
  project: ProjectMeta;
  source: SourceDocument;
  generation: GenerationMeta | null;
  scenes: Scene[];
};
```

顶层不持久化 `status`。

项目级不变量：

- `generation === null` 时，`source.blocks` 和 `scenes` 都必须为空；
- `generation !== null` 时，`source.blocks` 和 `scenes` 都必须非空；
- `project.updatedAt >= project.createdAt`；
- source block ID 唯一，order 从 1 连续；
- Scene ID 唯一，order 从 1 连续；
- 数组顺序必须与 order 一致；
- blocks 和 scenes 各自按 range 排序且不重叠；
- 所有 range 位于 `[0, source.textLengthUtf16]`；
- Scene anchor 引用的 block 必须存在、按 block order 连续；
- Scene range 必须位于 anchor 首尾 block 覆盖范围内。

`schemaVersion` 在 V0.1 固定为 `"0.1"`，这是 `major.minor` 格式标识，不宣称严格 SemVer。M1 不实现 migration。

## 9. ProjectMeta

```ts
type ProjectMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  language: "zh-CN" | "en-US";
  aspectRatio: "9:16" | "16:9" | "1:1";
  style: "knowledge" | "story" | "commentary";
  assetUsePolicy: {
    intendedUse: "commercial_capable" | "noncommercial" | "editorial";
    willModify: boolean;
  };
};
```

规则：

- ID 创建后稳定，生产建议 `project-<crypto.randomUUID()>`，不引入 UUID 包；
- title trim 后 1～200 字符；
- UTC 时间；
- createdAt 不晚于 updatedAt；
- 默认 `assetUsePolicy = { intendedUse: "commercial_capable", willModify: true }`；
- Schema 不偷偷补默认，默认值由 Application 明确构造。

## 10. SourceDocument、SourceBlock 与 offset

```ts
type SourceRange = {
  start: number;
  end: number;
};

type SourceBlock = {
  id: string;
  order: number;
  kind: "heading" | "paragraph" | "list_item" | "blockquote" | "code_block" | "other";
  sourceRange: SourceRange;
};

type SourceDocument = {
  path: string;
  originalFileName: string;
  sha256: string;
  encoding: "utf-8";
  sizeBytes: number;
  textLengthUtf16: number;
  offsetUnit: "utf16_code_unit";
  blocks: SourceBlock[];
};
```

范围语义必须同时写进代码注释、Schema 文档和测试：

- `[start, end)`；
- `start` inclusive，`end` exclusive；
- 单位为 JavaScript UTF-16 code unit；
- 等价读取是 `rawText.slice(start, end)`；
- `start >= 0`、`end > start`、`end <= textLengthUtf16`。

init 规则：

- `source.path` 只能是 `script.md` 或 `script.txt`；
- originalFileName 只保存 basename，不保存绝对路径；
- sha256 针对项目内副本 bytes；
- sizeBytes 与副本一致；
- fatal UTF-8 解码；
- 使用 `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` 或经测试等价的实现，确保 BOM 作为 `U+FEFF` 参与 `textLengthUtf16`，而不是被解码器静默吞掉；
- 不剥离 BOM、不转换 CRLF、不做 Unicode normalization；
- init 时 blocks 为空；
- M1 不实现 block 分割算法。

测试必须覆盖 `"甲😀乙"`：JS length 为 4，Emoji range 为 `[1,3)`；还要覆盖组合字符、BOM 和 CRLF。

## 11. GenerationMeta

```ts
type GenerationMeta = {
  plannerProvider: string;
  apiProtocol?: "openai-compatible" | "anthropic" | "fixture";
  model?: string;
  promptVersion: string;
  plannerOutputSchemaVersion: string;
  sourceBlockVersion: string;
  generatedAt: string;
};
```

规则：

- plannerProvider 为可扩展 Provider ID，不能枚举成 DeepSeek/Anthropic；
- model 只是有界审计字符串；
- M1 init 固定写 null，不伪造 fixture generation；
- 不保存 Base URL、API Key、请求头、请求/响应全文或隐藏推理；
- `plannerOutputSchemaVersion` 与顶层 project schemaVersion 是两个概念。

## 12. Scene、Search 与 anchor

```ts
type Scene = {
  id: string;
  order: number;
  sourceAnchor: {
    strategy: "source-blocks-v1";
    sourceBlockIds: string[];
    startQuote: string;
    endQuote: string;
  };
  sourceRange: SourceRange;
  text: string;
  summary: string;
  narrativeRole: NarrativeRole;
  visualPlan: {
    decision: VisualDecision;
    rationale: string;
    preferredMedia: Array<"photo" | "video">;
    visualKeywords: string[];
  };
  search: SceneSearch;
  review: ReviewDecision;
};
```

NarrativeRole：

```text
hook, question, claim, explanation, example, comparison, process, data,
story, emotion, transition, conclusion, call_to_action
```

VisualDecision：

```text
speaker_only, stock_asset, title_card, structured_graphic,
screen_capture, user_asset, none
```

Anchor 规则：

- sourceBlockIds 至少一个、内部唯一；
- 引用必须存在且按 block order 连续；
- quote trim 后非空并有合理上限；
- Scene range 落在首尾 block 覆盖范围；
- M1 不实现 quote 解析；
- M2 I/O validator 负责验证 `scene.text === rawText.slice(start,end)`；
- gaps 可存在，M2 再判断遗漏是否仅为空白。

Search：

```ts
type SearchQuery = {
  id: string;
  language: "zh" | "en";
  query: string;
  purpose: string;
  enabled: boolean;
};

type SceneSearch = {
  queries: SearchQuery[];
  candidates: AssetCandidate[];
  lastSearchedAt?: string;
};
```

不变量：

- Scene 内 query ID、candidate ID 唯一；
- `[provider.id, mediaType, providerAssetId]` 在 Scene 内唯一；
- matchedQueryId 指向本 Scene query；
- stock_asset 至少有一个 enabled query；
- 非 stock_asset 不保存远程 query/candidate；
- candidate 存在时 lastSearchedAt 必须存在；
- 当前展示 candidates 建议上限 20；
- 原始 Provider 响应只允许进 cache，不进 project JSON；
- M1 不执行搜索。

## 13. AssetCandidate、Provider 与 AssetRights

Provider 不得固定为 `"pexels"`。

```ts
type AssetProviderSnapshot = {
  id: string;
  name: string;
  homepageUrl: string;
  termsUrl: string;
  policyRevision: string;
  termsCheckedAt: string;
};

type RightsEvidence = {
  capturedAt: string;
  referenceUrl: string;
  fields: Record<string, string | number | boolean | null>;
};

type AssetRights = {
  status:
    | "public_domain"
    | "open_license"
    | "platform_license"
    | "editorial_only"
    | "no_known_copyright"
    | "unknown";
  licenseCode?: string;
  licenseName?: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  attributionText?: string;
  commercialUse: "allowed" | "disallowed" | "unclear";
  derivatives: "allowed" | "disallowed" | "share_alike" | "unclear";
  restrictions: string[];
  rightsStatementUrl?: string;
  verifiedAt: string;
  evidence: RightsEvidence;
};

type AssetCandidate = {
  id: string;
  provider: AssetProviderSnapshot;
  providerAssetId: string;
  mediaType: "photo" | "video";
  thumbnailUrl: string;
  previewUrl?: string;
  sourcePageUrl: string;
  width: number;
  height: number;
  durationSeconds?: number;
  orientation: "portrait" | "landscape" | "square";
  creator: {
    name: string | null;
    profileUrl?: string;
  };
  rights: AssetRights;
  retrievedAt: string;
  matchedQueryId: string;
  rank: number;
};
```

规则：

- 远程 URL 均为 HTTPS；
- width/height/rank 为正安全整数；
- photo 不允许 duration，video 要求正有限 duration；
- orientation 与尺寸一致；
- width==height square，width>height landscape，width<height portrait；
- creator 缺失用 null，不伪造 `"Unknown"`；后续 Validator 可 warning；
- Provider `policyRevision` 是本项目映射规则版本，不虚构平台官方版本；
- rights evidence 必须最小、有界，不得保存完整 API 响应；
- attributionRequired=true 时必须有 attributionText；
- open_license 必须有足以识别的 code、name、URL；
- platform_license 必须有 Provider terms snapshot；
- public_domain 必须有 license/rights evidence；
- unknown/no_known_copyright 不得声称 commercialUse 或 derivatives 为 allowed；
- editorial_only 不得声称 commercialUse allowed；
- restrictions trim、去空、去重并限制数量/长度；
- 受限素材可以是结构合法 Candidate，默认过滤是 policy，不是 Schema 拒绝。

## 14. ReviewDecision、Selected Snapshot 与 LocalAsset

不再持久化可冲突的 `review.status`、`selectedCandidateId`、顶层 `localAsset` 三套事实。使用一个 strict discriminated union：

```ts
type SelectedCandidateSnapshot = {
  selectedAt: string;
  candidate: AssetCandidate;
  rightsAcknowledgement?: {
    acknowledgedAt: string;
    warningCodes: string[];
  };
};

type LocalAsset = {
  relativePath: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  importedAt: string;
  provenance:
    | { kind: "selected_candidate"; candidateId: string }
    | { kind: "user_owned"; note?: string }
    | {
        kind: "external";
        sourcePageUrl?: string;
        rights: AssetRights;
        note?: string;
      };
};

type ReviewDecision =
  | { kind: "pending"; note?: string }
  | { kind: "skipped"; decidedAt: string; note?: string }
  | {
      kind: "candidate_selected";
      selection: SelectedCandidateSnapshot;
      localAsset?: LocalAsset;
      note?: string;
    }
  | {
      kind: "local_asset_attached";
      localAsset: LocalAsset;
      note?: string;
    };
```

规则：

- candidate_selected 保存完整深拷贝 snapshot；
- 保存后 snapshot 独立于当前 candidates，刷新/清理候选不能让选择失效；
- 选择操作当时 candidate 必须存在属于 M5 Application 规则，不要求旧 snapshot 永远仍在列表；
- candidate_selected 带 localAsset 时，provenance 必须为 selected_candidate 且 candidateId 匹配；
- local_asset_attached 的 provenance 只能是 user_owned 或 external；
- pending/skipped 没有 localAsset；
- rights warning acknowledgement 是可选审计事实，不是法律保证；
- relativePath 必须位于 `assets/<scene-id>/`；
- MIME 以 image/ 或 video/ 开头；
- sizeBytes 正整数、sha256 合法、importedAt UTC；
- M1 不检查 local asset 文件存在，也不实现导入。

Scene status 由纯函数派生，优先级：

1. decision 中存在 localAsset -> `local_attached`
2. candidate_selected -> `selected`
3. skipped -> `skipped`
4. candidates 非空 -> `candidates_ready`
5. 否则 -> `pending`

不持久化该结果。

## 15. 素材源注册表 Schema

在 Domain 定义并测试：

```ts
type AssetSourceCatalogEntry = {
  id: string;
  name: string;
  homepage: string;
  mediaTypes: Array<"image" | "video" | "audio" | "illustration" | "3d">;
  access: Array<"api" | "manual" | "iiif" | "bulk">;
  apiDocs?: string;
  apiKeyRequired: boolean;
  licenseModel: "single" | "per_item" | "mixed";
  commercialFilter: boolean;
  derivativeFilter: boolean;
  attributionMetadata: boolean;
  autoDownloadPolicy: "forbidden" | "review_required" | "allowed_by_terms";
  termsUrl: string;
  lastVerifiedAt: string;
  riskNotes: string[];
};
```

同时定义机器可读 `LicensePolicy`，可表达 allow/warn/reject。

M1 不读取 `catalog/*.yaml`、不引入 YAML 库、不填充全网目录。M1 只冻结契约并更新 `docs/ASSET_LICENSING.md`；完整目录属于 M6。

## 16. 持久化路径安全

`ProjectRelativePathSchema` 必须拒绝：

```text
""
"."
".."
"../secret"
"a/../../secret"
"/etc/passwd"
"C:\\secret"
"C:/secret"
"C:secret"
"\\Windows\\secret"
"\\\\server\\share\\file"
"//server/share/file"
"\\\\?\\C:\\file"
"\\\\.\\pipe\\name"
"assets\\file.jpg"
"a//b"
"./script.md"
任意 NUL
Windows 保留设备名（CON、NUL、AUX、PRN、COM1 等）
任一 segment 以点或空格结尾
```

允许：

```text
script.md
assets/scene-001/image.jpg
cache/search/scene-001.json
素材/场景-001/图片.jpg
```

要求：

- 纯校验同时用 POSIX/Windows 语义，不能只调用当前 OS 的 `path.isAbsolute()`；
- 不 percent-decode；
- 禁止 `candidate.startsWith(root)`；
- 词法 containment 使用 `path.relative()`；
- 已存在路径用 `realpath()` 检查物理边界；
- 不存在目标检查最近已存在父级的 realpath；
- `project.s2s.json` 本身为 symlink/junction 时拒绝；
- 项目内指向外部的 symlink、junction、链式链接、dangling link 拒绝；
- hard link 保存不能原地修改外部 inode；atomic rename 应替换目录项；
- TOCTOU 无法完全消除的剩余风险写入 SECURITY/代码注释，不虚称完全解决。

## 17. Domain validator 与错误信息

不要把所有跨字段验证塞进一个巨大 `.superRefine()`。

建议：

- 单对象规则放对应 Schema；
- Scene 关联放 `validateSceneRelations`；
- 项目 order/range/reference 放 `validateProjectRelations`；
- 对外统一入口 `parseProject(input: unknown)`；
- Repository 只能通过该入口返回可信项目。

问题至少具备：

```ts
type DomainIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
};
```

错误不得包含完整项目 JSON、完整文稿或用户绝对路径。

## 18. ProjectRepository Port

```ts
interface ProjectRepository {
  exists(projectRoot: string): Promise<boolean>;
  create(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
  load(projectRoot: string): Promise<SpeechToSceneProject>;
  save(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
}
```

合同：

- 文件名固定为 `project.s2s.json`，调用方不能提供任意 JSON 路径；
- exists 只检查固定文件；
- create 只创建不存在项目，绝不覆盖合法、损坏或未知版本文件；
- load：lstat/大小限制 -> JSON.parse unknown -> 版本分派 -> 完整 parse；
- save 要求现有项目可 load、版本受支持、新旧 project.id 一致；
- save 不隐式转 create；
- create/save 都在任何写 I/O 前重新 parse；
- Repository 不自行修改 updatedAt；
- Repository 不自动 migration、修复、降级或 strip 未知字段；
- Repository 不输出 CLI 文案；
- 同一 Repository 实例对同一 root 的 create/save 进程内串行；
- M1 不承诺跨进程 save lock，文档明确；
- 并发读只能看到完整旧版或新版。

读取错误必须区分：

- root 不存在/不是目录；
- project file 不存在；
- project file 是目录/symlink；
- 文件过大；
- JSON 语法错误；
- 顶层不是 object；
- 缺 schemaVersion；
- 未知 schemaVersion；
- 当前版本字段/不变量无效。

未知版本应优先于该未来版本的其他字段错误。

## 19. 原子 create/save

### 19.1 规范 JSON

写出：

- UTF-8 无 BOM；
- `JSON.stringify(project, null, 2) + "\n"`；
- LF；
- 连续保存同一值产生相同 bytes；
- stringify 后重新 JSON.parse + parseProject，防止 `undefined` 等序列化差异。

### 19.2 临时文件

临时文件与目标同目录：

```text
.project.s2s.json.<pid>.<uuid>.tmp
```

用 `wx` 独占创建，顺序：

```text
validate
serialize
exclusive open temp
write all bytes
FileHandle.sync()
close
read/validate temp
publish
best-effort directory fsync where supported
cleanup temp in finally
```

### 19.3 create 发布

create 需要 no-clobber。推荐用同文件系统 `link(temp, target)` 作为原子排他发布，再 unlink temp；或使用能由并发契约测试证明同等语义的标准库方案。

禁止“先 exists 再 rename”作为唯一保护，因为有竞态。

### 19.4 save 发布

save 使用同文件系统 rename 替换。禁止：

- 直接 writeFile 截断正式文件；
- temp 放系统临时目录；
- 先 unlink 正式文件再 rename；
- rename 失败退化为非原子 copy；
- 写完才验证。

Windows 若出现暂时 EPERM/EACCES/EBUSY，可做固定、少量、有界、可测试重试；不得重试 Schema/路径等永久错误。

如果标准库无法在三平台满足“旧文件不丢失”，可以增加一个职责单一、维护活跃的 atomic-write 依赖，但最终报告必须说明标准库不足、许可证、体积和替代方案。不能引入通用大型库。

### 19.5 故障语义

| 故障点           | 正式文件   | 临时文件/额外要求             |
| ---------------- | ---------- | ----------------------------- |
| 写前验证         | 旧文件不变 | 不创建 temp                   |
| temp open        | 旧文件不变 | 不调用 publish                |
| write            | 旧文件不变 | 关闭并清理                    |
| sync             | 旧文件不变 | 关闭并清理                    |
| close            | 旧文件不变 | 不 publish，尽力清理          |
| temp revalidate  | 旧文件不变 | 清理                          |
| link/rename      | 旧文件不变 | 清理，不删除旧文件            |
| cleanup 同时失败 | 旧文件不变 | 主错误不能被 cleanup 错误覆盖 |
| publish 成功     | 完整新文件 | 无本次 temp                   |

rename 后目录 fsync 失败属于“内容已提交、durability warning”，不能谎称旧文件仍在。

故障注入使用最小 file-ops adapter，不 monkey-patch 全局 fs，不靠 chmod 制造跨平台不稳定测试。

## 20. `createProject` Application 用例

建议输入：

```ts
type CreateProjectInput = {
  projectDirectory: string;
  scriptPath: string;
  title?: string;
  language: "zh-CN" | "en-US";
  aspectRatio: "9:16" | "16:9" | "1:1";
  style: "knowledge" | "story" | "commentary";
  intendedUse: "commercial_capable" | "noncommercial" | "editorial";
  willModify: boolean;
};
```

默认：

```text
language=zh-CN
aspectRatio=9:16
style=knowledge
intendedUse=commercial_capable
willModify=true
```

依赖注入：ProjectRepository、Clock、IdGenerator、ProjectScaffolder/最小 file ops。CLI handler 不做复制、hash 或 JSON 组装。

### 20.1 只读预检

第一次写磁盘前完成：

1. 参数/枚举验证；
2. script 路径存在；
3. script 为普通文件且非 symlink；
4. 扩展名 `.md`、`.markdown`、`.txt`（大小写不敏感）；
5. 一次读取原始 bytes；
6. 不超过 5 MiB；
7. fatal UTF-8 解码；
8. 内容非空且非纯空白；
9. 计算 sha256、size、textLengthUtf16；
10. target 不存在；
11. target parent 存在、为普通目录且非 symlink；
12. title 有效；未给时用 target basename；
13. 用单一 Clock `now` 和 project ID 构造 initial project；
14. initial project 通过统一 parse。

`.md/.markdown` 复制为 `script.md`，`.txt` 复制为 `script.txt`。

### 20.2 独占初始化流程

1. `mkdir(target, recursive:false)`，用原子目录创建获得所有权；
2. 在 target 创建随机 sentinel，内容包含本次 token，使用 wx；
3. 创建 `assets/`、`cache/search/`、`logs/`；
4. 将预检时读到的同一份 bytes 写入 script，不二次读取 source；
5. fsync/close script；
6. Repository create `project.s2s.json`，最后作为完成标志；
7. load 回读验证；
8. 删除 sentinel；
9. 返回成功。

initial project：

```json
{
  "schemaVersion": "0.1",
  "project": {
    "id": "project-...",
    "title": "demo",
    "createdAt": "2026-07-13T10:00:00.000Z",
    "updatedAt": "2026-07-13T10:00:00.000Z",
    "language": "zh-CN",
    "aspectRatio": "9:16",
    "style": "knowledge",
    "assetUsePolicy": {
      "intendedUse": "commercial_capable",
      "willModify": true
    }
  },
  "source": {
    "path": "script.md",
    "originalFileName": "input.md",
    "sha256": "...",
    "encoding": "utf-8",
    "sizeBytes": 321,
    "textLengthUtf16": 123,
    "offsetUnit": "utf16_code_unit",
    "blocks": []
  },
  "generation": null,
  "scenes": []
}
```

### 20.3 同步失败清理

- 仅当 target 是本次独占创建，且 sentinel token 仍匹配时才递归删除；
- 删除前 resolve 绝对路径并确认仍是预期 target；
- 不根据拼接不明字符串 rm；
- 不删除任何预先存在路径；
- cleanup 失败不覆盖主错误；
- project JSON 已提交后的后续 warning 不应删项目。

进程崩溃可能留下没有 project JSON 的 incomplete target。下一次 init 必须拒绝，不自动删，并提示用户人工检查。

成功结构：

```text
demo/
├── script.md                 # 或 script.txt
├── project.s2s.json
├── assets/
├── cache/
│   └── search/
└── logs/
```

## 21. `getProjectStatus`

只依赖 ProjectRepository 和纯函数，不直接读写 JSON。

```ts
type ProjectStatus = "created" | "planned";

type ProjectStatusView = {
  schemaVersion: "0.1";
  project: {
    id: string;
    title: string;
    language: "zh-CN" | "en-US";
    aspectRatio: "9:16" | "16:9" | "1:1";
    style: "knowledge" | "story" | "commentary";
  };
  status: ProjectStatus;
  source: {
    path: string;
    textLengthUtf16: number;
  };
  scenes: {
    total: number;
    byStatus: Partial<Record<SceneStatus, number>>;
  };
  updatedAt: string;
};
```

规则：

```text
generation === null -> created
generation !== null -> planned
```

M1 不实现 searched/reviewing/assets_ready；Scene status 可以按第 14 节纯函数统计。status 不检查 hash、不更新 updatedAt、不修复文件、不创建目录。

## 22. CLI

### 22.1 架构

- `createProgram(dependencies)` 可测试；
- composition root 创建真实 adapters；
- command 只解析、调用 Application、格式化；
- Application 不依赖 Commander；
- 测试注入 stdout/stderr writer；
- command/library 不调用 `process.exit()`；
- 顶层只设置 `process.exitCode`；
- 普通失败不打印 stack；
- `--json` stdout 不被日志或 ANSI 污染。

### 22.2 init

```bash
s2s init <project-directory> \
  --script <path> \
  [--title <title>] \
  [--language zh-CN|en-US] \
  [--aspect-ratio 9:16|16:9|1:1] \
  [--style knowledge|story|commentary] \
  [--intended-use commercial_capable|noncommercial|editorial] \
  [--no-modify]
```

成功输出：

```text
✓ 已创建项目：demo
✓ 已复制文稿：script.md
✓ 已写入项目文件：project.s2s.json
状态：created（`s2s plan` 将在 M2 提供）
```

不输出正文、Key、环境变量、默认绝对路径或 stack。

### 22.3 status

```bash
s2s status <project-directory>
s2s status <project-directory> --json
```

人类输出：

```text
项目：demo
Schema：0.1
状态：created
文稿：script.md
场景：0
更新时间：2026-07-13T10:00:00.000Z
```

`--json`：

- stdout 只有一个 JSON document；
- 两空格、末尾换行；
- 不倾倒完整 Project；
- 不含正文、绝对路径和当前调用时间；
- 失败写 stderr，stdout 空。

### 22.4 退出码

| Code | M1 语义                                                 |
| ---: | ------------------------------------------------------- |
|    0 | 成功/help/version                                       |
|    1 | 已有目标、project 不存在、权限/磁盘/普通 I/O            |
|    2 | CLI 参数、枚举、source 不存在/类型/编码/扩展名/内容错误 |
|    3 | JSON、Schema、未知版本、持久化路径或 symlink 项目违规   |

M1 不产生网络 4 或用户中止 5。

失败输出：

```text
✗ <结论>
原因：<安全、可理解原因>
解决：<可执行建议>
```

## 23. 错误类型

只实现 M1 最小集合：

```text
AppError
├── InvalidArgumentError
├── SourceDocumentError
├── ProjectNotFoundError
├── ProjectAlreadyExistsError
├── ProjectValidationError
├── UnsupportedSchemaVersionError
├── ProjectFileTooLargeError
├── PathSafetyError
└── ProjectWriteError
```

字段：

- 稳定 code；
- 安全面向用户 message；
- 可选 cause；
- userHint；
- retryable；
- exit code 映射。

不要预先实现 Planner/Provider/RateLimit 错误。

## 24. Clock、ID 与可测试性

```ts
interface Clock {
  now(): Date;
}

interface IdGenerator {
  projectId(): string;
  temporaryId(): string;
}
```

生产使用 Date 与 crypto.randomUUID；测试固定。一次 init 只读一次业务时间，createdAt===updatedAt。不要让 fixture 依赖真实时间/UUID。

## 25. Fixtures

至少创建：

```text
tests/fixtures/scripts/
├── knowledge-explanation.md
├── plain-script.txt
├── unicode-zh-emoji.md
├── utf8-bom.txt
└── crlf-script.txt

tests/fixtures/projects/
├── created-project.json
├── planned-project.json
├── malformed-project.json
├── relation-invalid-project.json
└── unsupported-version-project.json

examples/token-cost/script.md
```

要求：

- 内容自写、无版权风险；
- 不含 API Key、真实响应、个人绝对路径、下载素材；
- 远程虚拟 URL 使用 `.invalid` 域名；
- 固定时间/ID；
- created fixture 的 hash/长度与脚本真实一致；
- planned fixture 覆盖 blocks、DeepSeek 字符串 Provider、photo/video、rights 状态、selected snapshot、local asset provenance；
- unsupported fixture 除版本外尽量合法，确保测的是 version dispatch；
- golden JSON 为 LF、两空格、末尾换行；
- builder 每次返回深拷贝。

无效 UTF-8 bytes 可由测试 helper 在 temp 中生成，不必提交二进制。

## 26. 测试原则

- 无真实网络；
- 只写系统临时目录；
- 不写仓库 `tmp/`；
- 每个测试独立并 finally/afterEach 清理；
- 不依赖执行顺序、本机用户名、盘符、locale；
- 不用 sleep；
- 不依赖 shell 重定向做核心断言；
- 测试行为和契约，不复制实现；
- symlink 权限不足时明确 skip 原因；
- Windows junction 必须尝试真实执行，不能全跳过；
- Windows 清理失败视为句柄泄漏信号；
- 不为通过测试削弱路径或原子要求。

## 27. Unit 测试矩阵

### 27.1 primitives/path

- 合法/非法 ID；
- hash 大小写、长度、非 hex；
- UTC Z、无时区、offset、非法日期；
- HTTPS vs HTTP/file/javascript；
- 所有第 16 节路径正反例；
- path.posix/path.win32 在三平台均跑；
- prefix trap：`/tmp/project-evil` 不能算 `/tmp/project` 内；
- Unicode 路径允许；
- Windows device/UNC/drive-relative 拒绝。

### 27.2 project lifecycle

- generation null + blocks/scenes 空合法；
- null + 非空 blocks/scenes 非法；
- generation 非 null + blocks/scenes 空非法；
- strict unknown field 在每层拒绝；
- updatedAt 早于 createdAt；
- assetUsePolicy 枚举；
- parse 不原地修改输入。

### 27.3 blocks/scenes

- order 1..N；
- 0、跳号、重复、数组错序；
- ID 重复；
- range 边界、相邻、空、负数、超界、重叠、乱序；
- Emoji/组合字符/CRLF offset；
- anchor block 不存在、重复、非连续；
- Scene range 超出 anchor；
- stock_asset 无 enabled query；
- query/candidate ID 重复；
- matchedQuery 不存在；
- provider/media/providerAsset 重复；
- candidate 有但无 lastSearchedAt。

### 27.4 candidate/rights

- 合法 photo/video；
- photo 带 duration；
- video 无/负 duration；
- orientation 冲突；
- 非 HTTPS；
- creator null 合法，不允许伪造规则；
- 每种 rights status 正反例；
- attribution required 无文本；
- open license 证据不足；
- unknown/no-known 声称 allowed；
- editorial 声称 commercial allowed；
- Provider 条款和证据缺失；
- evidence 字段类型/大小边界。

### 27.5 review/local

- pending/skipped；
- candidate selection 完整 snapshot；
- 当前候选删除后 snapshot 仍合法；
- snapshot 由 Application 深拷贝（未来操作 helper 可先测试 builder）；
- candidate-selected local provenance ID 匹配/不匹配；
- local branch 使用错误 provenance；
- local path 不在 `assets/<scene-id>/`；
- derived Scene status 真值表；
- 派生函数不修改输入。

## 28. Repository 契约测试

创建可复用 `repository-contract.ts`，覆盖：

- create -> load 语义相等；
- save -> load；
- create 不覆盖合法/损坏/未知项目；
- save 缺失项目失败；
- save 新旧 project ID 不同失败；
- invalid object 即使用类型断言也在写前拒绝；
- malformed JSON；
- 缺版本；
- unknown version 优先报专用错误；
- 当前版本 invalid；
- unknown field 不被 strip；
- file size limit 在 parse 前；
- project file 为目录/symlink；
- 中文/Emoji round-trip；
- JSON 格式和连续保存 bytes 稳定；
- Repository 不更新时间、不修改输入；
- 固定文件名，不能注入 `../../x.json`；
- 错误保留 cause，但不泄露全文；
- 同实例同 root 写串行。

## 29. 原子写入测试

故障注入：

| 注入点         | 断言                               |
| -------------- | ---------------------------------- |
| validation     | 无写 I/O                           |
| temp open      | 旧文件不变、不 publish             |
| write          | 旧文件不变、handle 关闭、temp 清理 |
| sync           | 同上                               |
| close          | 不 publish、主错误保留             |
| temp reparse   | 旧文件不变、temp 清理              |
| link create    | 既有 target 不变                   |
| rename save    | 旧 bytes 不变                      |
| cleanup 也失败 | 主错误不被覆盖                     |
| success        | 完整新 JSON、无 temp               |

真实文件系统：

- create/link no-clobber；
- replace existing；
- 两个并发 create 只有一个成功；
- 并发 save 最终只能是完整 A 或 B；
- read/write 并发只见完整旧/新；
- temp 同目录且唯一；
- 无关 `.tmp` 不被清理；
- hard link 外部文件不被原地修改；
- 三平台真实 rename replace；
- Windows 临时错误重试若实现则覆盖次数/耗尽。

## 30. 文件系统安全集成测试

真实创建：

- 项目内 file symlink 指向外部，拒绝；
- directory symlink 指向外部，拒绝；
- 链式/悬空 symlink，拒绝；
- `project.s2s.json` 自身 symlink，拒绝且外部不变；
- Windows junction 指向外部，拒绝；
- temp 预占为 symlink，wx 不跟随；
- parent 检查后换成链接的可控 TOCTOU hook，尽力覆盖；
- 包含中文、空格、`#` 的 temp project；
- 不同 drive/UNC 词法越界。

## 31. createProject 测试

- `.md` -> script.md；
- `.markdown` -> script.md；
- `.txt` -> script.txt；
- 扩展名大小写；
- bytes 完全相同；
- hash、size、UTF-16 length；
- 中文、Emoji、combining、CRLF、BOM；
- 默认值和所有 override；
- fixed Clock/ID；
- generation null、blocks/scenes 空；
- 目录树完整；
- target 已存在（空/文件/项目/incomplete）均拒绝、bytes/mtime 不变；
- parent 缺失/文件/symlink；
- source 缺失/目录/symlink/空白/非法 UTF-8/超大/错误扩展；
- source 只读一次；
- 任一步失败只清理本次 owned target；
- sentinel 不匹配时不得删除；
- project JSON create 失败无半成品；
- 崩溃残留不会被下一次自动删。

## 32. CLI 集成测试

- root/init/status `--help`；
- 真正参数解析，不只测 command name；
- init 成功退出 0、stdout/stderr；
- 缺参数/未知参数/枚举退出 2；
- source 错误退出 2；
- target 冲突退出 1；
- status 成功/JSON；
- JSON 可直接 parse，无 ANSI/日志；
- project 缺失退出 1；
- malformed/schema/version/symlink 退出 3；
- 普通错误无 stack、正文、Key、绝对路径；
- status 前后 bytes、mtime、目录内容不变；
- 连续 status 输出相同；
- 用源码入口和 `node dist/cli/index.js` 都做 smoke；
- command handler 没有 fs/业务状态规则。

## 33. 文档更新

`docs/PROJECT_SCHEMA.md` 从 draft 改为完整协议：

- 所有字段/枚举；
- required/optional/null；
- source block；
- UTF-16 `[start,end)`；
- generation lifecycle；
- review union；
- AssetRights/Provider/rights evidence；
- selected snapshot；
- local provenance；
- strict path；
- created/planned JSON 示例；
- 版本分派；
- M2/M5/M6 才执行的检查。

`docs/ASSET_LICENSING.md` 补注册表字段与 M1/M6 边界。

README：

- 状态改为 M1；
- Quick Start 使用真实 init/status；
- 明确 plan/search/review 未实现；
- 不夸大 Demo。

创建 `examples/token-cost/script.md`，解决原验收路径缺失。

## 34. 依赖规则

预期不新增依赖：

- SHA/UUID/UTF-8/fs 使用 Node 24；
- Schema 用 Zod；
- CLI 用 Commander；
- 测试用 Vitest。

禁止为 UUID、Hash、路径、复制、日期、Result、深拷贝加包。

只有 Windows CI 证明标准库 atomic replace 无法满足完整性时，才允许小型 atomic-write 依赖，并在报告说明原因、许可证、体积、替代方案。

## 35. 实施顺序

### Step 1：基线

```bash
git status --short
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Step 2：primitives/path + tests

先失败用例，再实现 ID、Hash、UTC、HTTPS、relative path。

### Step 3：source/asset/review/scene/project Schema

先单对象，再 relation validator，再统一 parseProject。

### Step 4：fixtures、状态纯函数

created/planned fixtures 全部走统一 parse 入口。

### Step 5：错误、Port、路径/fs adapters

冻结边界，不写 CLI。

### Step 6：Repository + atomic writer

先正常契约，再故障注入、并发和真实跨平台。

### Step 7：createProject

完成一次读取、独占 target、sentinel、script、project commit、清理。

### Step 8：getProjectStatus

保持纯读取。

### Step 9：CLI composition

最后连接 Commander，防止业务倒流进 command。

### Step 10：文档与完整验收

不自动继续 M2。

## 36. 自动与手动验收

必须全部通过：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node dist/cli/index.js --help
node dist/cli/index.js init --help
node dist/cli/index.js status --help
```

在系统临时目录运行：

```bash
node dist/cli/index.js init <temp>/demo \
  --script examples/token-cost/script.md

node dist/cli/index.js status <temp>/demo
node dist/cli/index.js status <temp>/demo --json
```

人工确认：

- 树正确；
- script bytes/hash/length 正确；
- JSON 通过统一 parse；
- generation null，blocks/scenes 空；
- status created；
- 第二次 init 非零且所有 bytes/mtime 不变；
- status 完全只读；
- 无 temp/sentinel；
- 无网络。

最后：

```bash
git diff --check
git status --short
```

确认无 `.env`、Key、node_modules、dist、coverage、临时项目、绝对路径、temp、下载素材、cache/log。

## 37. Definition of Done

- [ ] strict Zod 是唯一持久化事实来源；
- [ ] 类型由 Zod 推导；
- [ ] init project 使用 generation null、空 blocks/scenes；
- [ ] Provider 可扩展，没有写死 Anthropic/Pexels；
- [ ] source blocks 与 UTF-16 半开区间冻结并测试；
- [ ] AssetRights、Provider 条款和最小 evidence 完整；
- [ ] selected candidate 保存不可变 snapshot；
- [ ] review status 不持久化；
- [ ] local provenance 可审计；
- [ ] path 拒绝 POSIX/Windows traversal、设备与链接逃逸；
- [ ] Repository create/load/save 契约完整；
- [ ] 未知版本专门拒绝且不写回；
- [ ] create/save 写前验证；
- [ ] create no-clobber 有并发测试；
- [ ] save 失败旧 bytes 不变；
- [ ] temp/handle 失败清理；
- [ ] init 不覆盖已有路径；
- [ ] init 一次读取 source；
- [ ] hash/bytes/UTF-16 长度正确；
- [ ] init 失败只清理 owned target；
- [ ] status 永远只读；
- [ ] CLI 输出/JSON/退出码稳定；
- [ ] unit/contract/integration 测试覆盖关键正反例；
- [ ] POSIX symlink 与 Windows junction 有真实测试；
- [ ] 三平台 CI 保持有效；
- [ ] docs/PROJECT_SCHEMA 与实现一致；
- [ ] README 不夸大；
- [ ] format/lint/typecheck/test/build 全通过；
- [ ] 编译产物 smoke 通过；
- [ ] 无 M2+ 实现、无网络；
- [ ] 无 commit、无 push，交 Codex 审计。

## 38. Claude 最终汇报格式

```markdown
## M1 完成情况

一句话说明是否达到 Definition of Done。

## 实现内容

- Schema：
- Repository/atomic write：
- init/status：
- 文档：

## 关键设计决定

- ...

## 修改文件

- `path`：用途

## 测试结果

- `pnpm format:check`：PASS/FAIL
- `pnpm lint`：PASS/FAIL
- `pnpm typecheck`：PASS/FAIL
- `pnpm test`：PASS/FAIL（文件数、测试数）
- `pnpm build`：PASS/FAIL
- 编译产物 smoke：PASS/FAIL
- 三平台 CI：PASS/FAIL/尚未运行

## 未解决问题与偏差

- 没有则写“无”
- 偏离计划时逐条说明原因和影响

## 审计提示

- 最值得 Codex 检查的 3～5 个位置

## Git 状态

- 明确说明没有 commit、没有 push
```

不得只回复“已完成”，不得隐藏未运行的检查。

## 39. 可直接交给 Claude 的指令

```text
请完整阅读并严格执行：

1. AGENTS.md
2. CLAUDE.md
3. docs/milestones/M1_IMPLEMENTATION_PLAN.md
4. 该计划列出的其他必读文档

现在只实现 M1：严格 Project Schema、ProjectRepository、JSON Repository、
原子 create/save、路径安全、createProject/getProjectStatus、s2s init 和
s2s status。

docs/milestones/M1_IMPLEMENTATION_PLAN.md 是本次任务的最高优先级实现合同。
按其中的冻结决策、实施顺序、测试矩阵、验收命令和 Definition of Done 执行。

特别要求：

- 不接入 DeepSeek、Anthropic、Pexels 或任何网络服务；
- 不实现 plan/search/review/validate；
- 不实现 Web UI 或 Server；
- 不把业务逻辑写进 Commander handler；
- 不削弱 no-clobber、原子写入和路径安全来让测试通过；
- 不 commit、不 push，保留工作树给 Codex 审计；
- 完成后按计划第 38 节格式汇报；
- 不要自动继续 M2。
```
