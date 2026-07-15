# M1 开发执行计划

> 基于：`docs/milestones/M1_IMPLEMENTATION_PLAN.md`
> 预计时间：分阶段执行，每步验证后再进入下一步
> 当前状态：待开始

---

## 阶段概览

| 阶段       | 内容                     | 预计产出               | 验收标准              |
| ---------- | ------------------------ | ---------------------- | --------------------- |
| **Step 0** | 基线验证                 | 确认所有检查通过       | pnpm check ✅         |
| **Step 1** | Primitives & Path Safety | 基础 Schema + 路径校验 | 单元测试覆盖正反例    |
| **Step 2** | Domain Schemas           | 所有 Zod Schema        | 单对象验证 + fixtures |
| **Step 3** | Fixtures & 纯函数        | 测试数据 + 状态派生    | 状态真值表覆盖        |
| **Step 4** | 错误 & Ports             | 错误类型 + 接口定义    | 契约冻结              |
| **Step 5** | Repository & 原子写入    | JSON Repository        | 契约 + 故障注入测试   |
| **Step 6** | createProject 用例       | 完整初始化流程         | 集成测试覆盖正反例    |
| **Step 7** | getProjectStatus 用例    | 只读状态查询           | 集成测试              |
| **Step 8** | CLI 组合                 | init/status 命令       | CLI 集成测试          |
| **Step 9** | 文档 & 验收              | 文档更新 + DoD         | 全部检查通过          |

---

## Step 0：基线验证

**目标：** 确认当前工程状态符合 M1 起点

**任务：**

- [ ] 检查 Git 状态（应为 clean，只有基线提交）
- [ ] 运行 `pnpm format:check`
- [ ] 运行 `pnpm lint`
- [ ] 运行 `pnpm typecheck`
- [ ] 运行 `pnpm test`
- [ ] 运行 `pnpm build`
- [ ] 记录基线结果

**验证命令：**

```bash
git status --short
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

**完成标志：** 所有检查 PASS 或明确记录失败项

---

## Step 1：基础原语与路径安全

**目标：** 实现并测试所有基础 Schema 和路径校验

**文件结构：**

```
src/
├── shared/
│   ├── constants.ts       # PROJECT_FILE_NAME、CURRENT_SCHEMA_VERSION 等
│   └── errors.ts          # AppError 层级
├── domain/
│   └── schema-primitives.ts  # IdSchema、Sha256Schema、UtcDateTimeSchema 等
└── infrastructure/
    └── project-paths.ts   # ProjectRelativePathSchema + 路径校验逻辑
```

**实现内容：**

### 1.1 基础常量 (`constants.ts`)

- `PROJECT_FILE_NAME = "project.s2s.json"`
- `CURRENT_SCHEMA_VERSION = "0.1"`
- `SOURCE_ENCODING = "utf-8"`
- `SOURCE_OFFSET_UNIT = "utf16_code_unit"`
- `MAX_PROJECT_FILE_BYTES = 10 * 1024 * 1024`
- `MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024`

### 1.2 基础 Schema (`schema-primitives.ts`)

- `IdSchema`：小写字母/数字开头，仅允许小写字母、数字、点、下划线、短横线，长度 1-128
- `Sha256Schema`：64 位小写十六进制
- `UtcDateTimeSchema`：ISO 8601 UTC，必须以 `Z` 结尾
- `HttpsUrlSchema`：有效 `https:` URL
- `PositiveIntegerSchema`、`NonNegativeIntegerSchema`、`FinitePositiveNumberSchema`
- `NonEmptyTrimmedStringSchema`：不能只用 `.min(1)` 让纯空格通过

### 1.3 路径安全 (`project-paths.ts`)

- `ProjectRelativePathSchema`：严格 POSIX 相对路径
- 拒绝所有 traversal、绝对路径、Windows 设备名、NUL、reserved names
- 跨平台测试（path.posix + path.win32）

**测试覆盖（`tests/unit/`）：**

- ✅ 合法/非法 ID
- ✅ Hash 大小写、长度、非 hex
- ✅ UTC Z、无时区、offset、非法日期
- ✅ HTTPS vs HTTP/file/javascript
- ✅ 所有第 16 节路径正反例（共 15+ 条）
- ✅ path.posix/path.win32 三平台兼容
- ✅ prefix trap：`/tmp/project-evil` 不能算 `/tmp/project` 内
- ✅ Unicode 路径允许
- ✅ Windows device/UNC/drive-relative 拒绝

**验收命令：**

```bash
pnpm test tests/unit/schema-primitives.test.ts
pnpm test tests/unit/project-paths.test.ts
```

---

## Step 2：Domain Schemas

**目标：** 实现完整的 Zod Schema（单对象 → 关系验证 → 统一入口）

**文件结构：**

```
src/domain/
├── schema-primitives.ts       # Step 1 已完成
├── asset-schema.ts            # AssetCandidate、AssetRights、Provider Snapshot
├── scene-schema.ts            # Scene、SourceBlock、SearchQuery
├── project-schema.ts          # ProjectMeta、SourceDocument、GenerationMeta、顶层
├── asset-source-schema.ts     # AssetSourceCatalogEntry（M1 冻结，M6 实现）
├── project-validation.ts      # validateProjectRelations、validateSceneRelations
└── project-status.ts          # 纯函数 deriveSceneStatus、deriveProjectStatus
```

### 2.1 基础实体 Schema

**SourceBlock** (`scene-schema.ts`)

```ts
SourceBlockSchema = z.object({
  id: IdSchema,
  order: PositiveIntegerSchema,
  kind: z.enum(["heading", "paragraph", "list_item", "blockquote", "code_block", "other"]),
  sourceRange: z
    .object({
      start: NonNegativeIntegerSchema,
      end: NonNegativeIntegerSchema,
    })
    .superRefine((range, ctx) => {
      // end > start, end <= textLengthUtf16 (M2 填充 textLength)
    }),
});
```

**ProjectMeta** (`project-schema.ts`)

```ts
ProjectMetaSchema = z
  .strictObject({
    id: IdSchema,
    title: z.string().trim().min(1).max(200),
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
    language: z.enum(["zh-CN", "en-US"]),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
    style: z.enum(["knowledge", "story", "commentary"]),
    assetUsePolicy: z.strictObject({
      intendedUse: z.enum(["commercial_capable", "noncommercial", "editorial"]),
      willModify: z.boolean(),
    }),
  })
  .superRefine((meta, ctx) => {
    // updatedAt >= createdAt
  });
```

**SourceDocument** (`project-schema.ts`)

```ts
SourceDocumentSchema = z.strictObject({
  path: ProjectRelativePathSchema, // 仅 "script.md" 或 "script.txt"
  originalFileName: z.string(), // basename only
  sha256: Sha256Schema,
  encoding: z.literal("utf-8"),
  sizeBytes: PositiveIntegerSchema,
  textLengthUtf16: NonNegativeIntegerSchema,
  offsetUnit: z.literal("utf16_code_unit"),
  blocks: z.array(SourceBlockSchema), // M1 init 为空
});
```

**GenerationMeta** (`project-schema.ts`)

- M1 init 固定写 `null`
- 非 null 时必须包含所有字段（plannerProvider、apiProtocol?、model?、promptVersion、plannerOutputSchemaVersion、sourceBlockVersion、generatedAt）

**Scene** (`scene-schema.ts`)

- sourceAnchor: strategy + sourceBlockIds + startQuote + endQuote
- sourceRange: [start, end) UTF-16
- text: z.string()（M2 validator 验证与 range 一致）
- summary: z.string()
- narrativeRole: 13 种枚举
- visualPlan: decision + rationale + preferredMedia + visualKeywords
- search: queries + candidates + lastSearchedAt?
- review: ReviewDecision union

**AssetCandidate & AssetRights** (`asset-schema.ts`)

- Provider Snapshot（id、name、homepageUrl、termsUrl、policyRevision、termsCheckedAt）
- RightsEvidence（capturedAt、referenceUrl、fields）
- AssetRights（status 6 种 + 所有权限字段 + evidence）
- AssetCandidate（所有字段 + 验证规则）

**ReviewDecision** (`scene-schema.ts`)

- discriminated union：pending / skipped / candidate_selected / local_asset_attached
- candidate_selected 包含完整 SelectedCandidateSnapshot
- local_asset_attached 包含 LocalAsset（provenance 验证）

**AssetSourceCatalogEntry** (`asset-source-schema.ts`)

- M1 只冻结 Schema，不读取 catalog/*.yaml

### 2.2 跨对象验证器

**validateSceneRelations** (`project-validation.ts`)

- Scene anchor block ID 存在且按 order 连续
- Scene range 位于 anchor 首尾 block 覆盖范围内
- Scene query/candidate ID 唯一
- candidate matchedQueryId 指向本 Scene query
- candidate [provider.id, mediaType, providerAssetId] 唯一
- stock_asset 至少有一个 enabled query

**validateProjectRelations** (`project-validation.ts`)

- generation null ↔ blocks/scenes 空互斥
- blocks order 1..N 连续且无重复 ID
- scenes order 1..N 连续且无重复 ID
- blocks/scenes 按 range 排序且不重叠
- 所有 range 在 [0, textLengthUtf16]

### 2.3 统一入口

```ts
export function parseProject(input: unknown): SpeechToSceneProject {
  const raw = ProjectSchema.parse(input);
  return validateProjectRelations(raw);
}
```

### 2.4 状态纯函数 (`project-status.ts`)

```ts
export function deriveSceneStatus(scene: Scene): SceneStatus {
  // 优先级：local_attached > selected > skipped > candidates_ready > pending
}

export function deriveProjectStatus(project: Project): ProjectStatus {
  // generation null -> "created"
  // generation non-null -> "planned"
}

export function getProjectStatusView(project: Project): ProjectStatusView {
  // 只返回 CLI 需要展示的字段
}
```

**测试覆盖：**

- ✅ generation null + blocks/scenes 空合法
- ✅ null + 非空 blocks/scenes 非法
- ✅ generation non-null + blocks/scenes 空非法
- ✅ strict unknown field 在每层拒绝
- ✅ updatedAt < createdAt
- ✅ assetUsePolicy 枚举
- ✅ order 1..N、跳号、重复、数组错序
- ✅ range 边界、相邻、空、负数、超界、重叠、乱序
- ✅ Emoji/组合字符/CRLF offset
- ✅ anchor block 不存在/重复/非连续
- ✅ Scene range 超出 anchor
- ✅ stock_asset 无 enabled query
- ✅ candidate 权限状态正反例
- ✅ review decision 分支

---

## Step 3：Fixtures & 测试助手

**目标：** 创建完整 fixtures 和测试 helper

### 3.1 Fixture 脚本 (`tests/fixtures/scripts/`)

**knowledge-explanation.md**

```markdown
# 深度学习简介

深度学习是机器学习的一个分支。

## 什么是神经网络

神经网络模仿人脑结构。
```

**plain-script.txt**

```txt
这是纯文本口播稿示例。
```

**unicode-zh-emoji.md**

```markdown
# 测试😀

甲😀乙丙
```

- 用于验证 UTF-16 length = 4，Emoji range [1,3)

**utf8-bom.txt**

- 带 BOM 的 UTF-8 文件，验证 BOM 参与 textLengthUtf16

**crlf-script.txt**

- CRLF 换行，验证不转换换行

### 3.2 Fixture 项目 (`tests/fixtures/projects/`)

**created-project.json**

- generation: null
- blocks: []
- scenes: []
- hash/length 与对应脚本真实一致

**planned-project.json**

- generation: non-null
- blocks: 至少 2 个（test Fixture 全覆盖）
- scenes: 至少 2 个（不同 decision、rights status）
- 覆盖：photo/video、selected snapshot、local asset provenance

**malformed-project.json**

- JSON 语法错误

**relation-invalid-project.json**

- blocks order 不连续

**unsupported-version-project.json**

- schemaVersion: "999.0"（其他字段合法）

### 3.3 测试助手 (`tests/helpers/`)

**project-builder.ts**

- 深拷贝 + 字段覆盖的 fixture builder

**temp-project.ts**

- 临时目录创建/清理（只写系统 tmpdir）

**fixed-clock.ts**

- 固定时间（如 "2026-07-13T10:00:00.000Z"）

**fixed-id-generator.ts**

- 固定 ID（如 "test-project-id"）

**fault-injecting-file-ops.ts**

- 最小 file-ops adapter，注入故障点

**repository-contract.ts**

- 可复用 Repository 契约测试套件

---

## Step 4：错误类型 & Application Ports

**目标：** 冻结错误体系和接口定义

### 4.1 错误类型 (`src/shared/errors.ts`)

```ts
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly exitCode: number;
  readonly cause?: Error;
  readonly userHint: string;
  readonly retryable: boolean;

  constructor(params: { code: string; message: string; exitCode: number; cause?: Error; userHint: string; retryable?: boolean });
}

export class InvalidArgumentError extends AppError { ... }
export class SourceDocumentError extends AppError { ... }
export class ProjectNotFoundError extends AppError { ... }
export class ProjectAlreadyExistsError extends AppError { ... }
export class ProjectValidationError extends AppError { ... }
export class UnsupportedSchemaVersionError extends AppError { ... }
export class ProjectFileTooLargeError extends AppError { ... }
export class PathSafetyError extends AppError { ... }
export class ProjectWriteError extends AppError { ... }
```

**规则：**

- 稳定 code
- 安全面向用户 message
- 不含完整项目 JSON、完整文稿、用户绝对路径、stack

### 4.2 Application Ports (`src/application/ports/`)

**clock.ts**

```ts
export interface Clock {
  now(): Date;
}
```

**id-generator.ts**

```ts
export interface IdGenerator {
  projectId(): string;
  temporaryId(): string;
}
```

**project-repository.ts**

```ts
export interface ProjectRepository {
  exists(projectRoot: string): Promise<boolean>;
  create(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
  load(projectRoot: string): Promise<SpeechToSceneProject>;
  save(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
}
```

**project-scaffolder.ts**

```ts
export interface ProjectScaffolder {
  createDirectories(projectRoot: string): Promise<void>;
  writeScript(projectRoot: string, fileName: string, bytes: Uint8Array): Promise<void>;
}
```

---

## Step 5：Repository & 原子写入

**目标：** 实现 JSON Repository 和原子写入机制

**文件结构：**

```
src/infrastructure/
├── atomic-write.ts         # 原子写入核心逻辑
├── json-project-repository.ts  # JSON Repository 实现
├── project-paths.ts        # Step 1 已完成
├── source-document.ts      # 文稿读取与 hash 计算
└── system-adapters.ts      # Clock、IdGenerator 生产实现
```

### 5.1 原子写入 (`atomic-write.ts`)

**Temp 文件命名：** `.project.s2s.json.<pid>.<uuid>.tmp`

**写入流程：**

```
1. validate（parseProject）
2. serialize（JSON.stringify + re-parse 验证）
3. exclusive open temp（wx flags）
4. write all bytes
5. FileHandle.sync()
6. close
7. read/validate temp（parseProject）
8. publish（link/rename）
9. best-effort directory fsync
10. cleanup temp in finally
```

**Create no-clobber：**

- 使用 `link(temp, target)` 原子排他
- 禁止 "先 exists 再 rename"

**Save replace：**

- 使用 `rename(temp, target)` 替换
- 禁止直接 writeFile 截断
- Windows EPERM/EACCES/EBUSY 固定次数重试

**故障注入测试：**

- 每个注入点验证旧文件不变
- 并发 create/save 最终一致性

### 5.2 JSON Repository (`json-project-repository.ts`)

```ts
export class JsonProjectRepository implements ProjectRepository {
  async exists(projectRoot: string): Promise<boolean>;
  async create(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
  async load(projectRoot: string): Promise<SpeechToSceneProject>;
  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
}
```

**错误区分：**

- root 不存在/不是目录 → ProjectNotFoundError
- project file 不存在 → ProjectNotFoundError
- project file 是目录/symlink → PathSafetyError
- 文件过大 → ProjectFileTooLargeError
- JSON 语法错误 → ProjectValidationError
- 顶层不是 object → ProjectValidationError
- 缺 schemaVersion → ProjectValidationError
- 未知 schemaVersion → UnsupportedSchemaVersionError
- 当前版本字段无效 → ProjectValidationError

### 5.3 文稿适配器 (`source-document.ts`)

```ts
export async function readSourceDocument(
  filePath: string,
  maxBytes: number,
): Promise<SourceDocument>;
```

- 一次读取原始 bytes
- fatal UTF-8 解码（`new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`）
- 计算 sha256、size、textLengthUtf16
- 保留 BOM（作为 U+FEFF 参与 textLength）
- 不转换 CRLF、不做 Unicode normalization

### 5.4 系统适配器 (`system-adapters.ts`)

```ts
export const systemClock: Clock = { now: () => new Date() };
export const systemIdGenerator: IdGenerator = {
  projectId: () => `project-${crypto.randomUUID()}`,
  temporaryId: () => crypto.randomUUID(),
};
```

---

## Step 6：createProject 用例

**目标：** 实现完整的项目初始化流程

**文件结构：**

```
src/application/
├── create-project.ts        # createProject 用例
├── get-project-status.ts    # getProjectStatus 用例（Step 7）
└── ports/                   # Step 4 已完成
```

### 6.1 createProject 输入

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

**默认值：**

- language = "zh-CN"
- aspectRatio = "9:16"
- style = "knowledge"
- intendedUse = "commercial_capable"
- willModify = true

### 6.2 预检流程（只读，不写磁盘）

1. 参数/枚举验证
2. script 路径存在
3. script 为普通文件且非 symlink
4. 扩展名 `.md`/`.markdown`/`.txt`（大小写不敏感）
5. 一次读取原始 bytes
6. 不超过 5 MiB
7. fatal UTF-8 解码
8. 内容非空且非纯空白
9. 计算 sha256、size、textLengthUtf16
10. target 不存在
11. target parent 存在、为普通目录且非 symlink
12. title 有效；未给时用 target basename
13. 用单一 Clock `now` 和 project ID 构造 initial project
14. initial project 通过统一 parseProject

### 6.3 独占初始化流程

1. `mkdir(target, recursive: false)`（原子目录创建）
2. 在 target 创建随机 sentinel（wx，内容包含本次 token）
3. 创建 `assets/`、`cache/search/`、`logs/`
4. 将预检时读到的同一份 bytes 写入 script（不二次读取）
5. fsync/close script
6. Repository create `project.s2s.json`（最后作为完成标志）
7. load 回读验证
8. 删除 sentinel
9. 返回成功

### 6.4 失败清理

- 仅当 target 是本次独占创建且 sentinel token 匹配时才删除
- 删除前 resolve 绝对路径并确认仍是预期 target
- cleanup 失败不覆盖主错误
- project JSON 已提交后的后续 warning 不应删项目

**测试覆盖：**

- ✅ `.md` -> script.md
- ✅ `.markdown` -> script.md
- ✅ `.txt` -> script.txt
- ✅ 扩展名大小写
- ✅ bytes 完全相同
- ✅ hash/size/UTF-16 length 正确
- ✅ 中文、Emoji、combining、CRLF、BOM
- ✅ 默认值和所有 override
- ✅ fixed Clock/ID
- ✅ generation null、blocks/scenes 空
- ✅ 目录树完整
- ✅ target 已存在（空/文件/项目/incomplete）均拒绝
- ✅ parent 缺失/文件/symlink
- ✅ source 缺失/目录/symlink/空白/非法 UTF-8/超大/错误扩展
- ✅ source 只读一次
- ✅ 任一步失败只清理本次 owned target
- ✅ sentinel 不匹配时不得删除
- ✅ project JSON create 失败无半成品
- ✅ 崩溃残留不会被下一次自动删

---

## Step 7：getProjectStatus 用例

**目标：** 实现只读状态查询

### 7.1 getProjectStatus 实现

```ts
type GetProjectStatusInput = { projectRoot: string };

type ProjectStatus = "created" | "planned";

type ProjectStatusView = {
  schemaVersion: "0.1";
  project: { id: string; title: string; language: string; aspectRatio: string; style: string };
  status: ProjectStatus;
  source: { path: string; textLengthUtf16: number };
  scenes: { total: number; byStatus: Partial<Record<SceneStatus, number>> };
  updatedAt: string;
};
```

**规则：**

- generation null → "created"
- generation non-null → "planned"
- 不检查 hash
- 不更新 updatedAt
- 不修复文件
- 不创建目录

**测试覆盖：**

- ✅ created 项目（generation null）
- ✅ planned 项目（generation non-null）
- ✅ Scene status 统计正确
- ✅ 只读：前后 bytes/mtime/目录不变
- ✅ 连续 status 输出相同

---

## Step 8：CLI 组合

**目标：** 连接 Commander，完成 CLI 命令

**文件结构：**

```
src/cli/
├── index.ts                 # 现有，保留
├── create-program.ts        # 重构：接收 dependencies
├── command-context.ts       # CLI 上下文（stdout/stderr writer）
├── error-reporter.ts        # 错误格式化
└── commands/
    ├── init-command.ts      # s2s init
    └── status-command.ts    # s2s status
```

### 8.1 CLI 架构

```ts
// create-program.ts
export function createProgram(deps: ProgramDependencies): Command {
  const program = new Command().name("s2s").description("...").version("0.0.0");

  program
    .command("init <project-directory>")
    .requiredOption("--script <path>")
    .option("--title <title>")
    .option("--language <lang>", "zh-CN")
    .option("--aspect-ratio <ratio>", "9:16")
    .option("--style <style>", "knowledge")
    .option("--intended-use <use>", "commercial_capable")
    .option("--no-modify")
    .action(createInitCommand(deps));

  program.command("status <project-directory>").option("--json").action(createStatusCommand(deps));

  return program;
}
```

**规则：**

- createProgram(dependencies) 可测试
- Composition root 创建真实 adapters
- Command 只解析、调用 Application、格式化
- Application 不依赖 Commander
- 测试注入 stdout/stderr writer
- Command/library 不调用 process.exit()
- 顶层只设置 process.exitCode
- 普通失败不打印 stack
- `--json` stdout 不被日志或 ANSI 污染

### 8.2 init 命令输出

**成功：**

```text
✓ 已创建项目：demo
✓ 已复制文稿：script.md
✓ 已写入项目文件：project.s2s.json
状态：created（`s2s plan` 将在 M2 提供）
```

**失败：**

```text
✗ <结论>
原因：<安全、可理解原因>
解决：<可执行建议>
```

### 8.3 status 命令输出

**人类输出：**

```text
项目：demo
Schema：0.1
状态：created
文稿：script.md
场景：0
更新时间：2026-07-13T10:00:00.000Z
```

**--json：**

- stdout 只有一个 JSON document
- 两空格、末尾换行
- 不倾倒完整 Project
- 不含正文、绝对路径、当前调用时间
- 失败写 stderr，stdout 空

### 8.4 退出码

| Code | 语义                                                    |
| ---- | ------------------------------------------------------- |
| 0    | 成功/help/version                                       |
| 1    | 已有目标、project 不存在、权限/磁盘/普通 I/O            |
| 2    | CLI 参数、枚举、source 不存在/类型/编码/扩展名/内容错误 |
| 3    | JSON、Schema、未知版本、持久化路径或 symlink 项目违规   |

**测试覆盖：**

- ✅ root/init/status `--help`
- ✅ init 成功退出 0、stdout/stderr
- ✅ 缺参数/未知参数/枚举退出 2
- ✅ source 错误退出 2
- ✅ target 冲突退出 1
- ✅ status 成功/JSON
- ✅ JSON 可直接 parse，无 ANSI/日志
- ✅ project 缺失退出 1
- ✅ malformed/schema/version/symlink 退出 3
- ✅ 普通错误无 stack、正文、Key、绝对路径
- ✅ status 前后 bytes、mtime、目录内容不变
- ✅ 连续 status 输出相同
- ✅ 用源码入口和 dist 都做 smoke

---

## Step 9：文档 & 验收

**目标：** 更新文档，完成 DoD 检查

### 9.1 文档更新

**docs/PROJECT_SCHEMA.md**

- 从 draft 改为完整协议
- 所有字段/枚举
- required/optional/null
- source block 和 UTF-16 [start,end)
- generation lifecycle
- review union
- AssetRights/Provider/rights evidence
- selected snapshot
- local provenance
- strict path
- created/planned JSON 示例
- 版本分派
- M2/M5/M6 才执行的检查

**docs/ASSET_LICENSING.md**

- 补注册表字段与 M1/M6 边界

**README.md**

- 状态改为 M1
- Quick Start 使用真实 init/status
- 明确 plan/search/review 未实现
- 不夸大 Demo

**examples/token-cost/script.md**

- 创建示例脚本

### 9.2 DoD 检查清单

- [ ] strict Zod 是唯一持久化事实来源
- [ ] 类型由 Zod 推导
- [ ] init project 使用 generation null、空 blocks/scenes
- [ ] Provider 可扩展，没有写死 Anthropic/Pexels
- [ ] source blocks 与 UTF-16 半开区间冻结并测试
- [ ] AssetRights、Provider 条款和最小 evidence 完整
- [ ] selected candidate 保存不可变 snapshot
- [ ] review status 不持久化
- [ ] local provenance 可审计
- [ ] path 拒绝 POSIX/Windows traversal、设备与链接逃逸
- [ ] Repository create/load/save 契约完整
- [ ] 未知版本专门拒绝且不写回
- [ ] create/save 写前验证
- [ ] create no-clobber 有并发测试
- [ ] save 失败旧 bytes 不变
- [ ] temp/handle 失败清理
- [ ] init 不覆盖已有路径
- [ ] init 一次读取 source
- [ ] hash/bytes/UTF-16 长度正确
- [ ] init 失败只清理 owned target
- [ ] status 永远只读
- [ ] CLI 输出/JSON/退出码稳定
- [ ] unit/contract/integration 测试覆盖关键正反例
- [ ] POSIX symlink 与 Windows junction 有真实测试
- [ ] 三平台 CI 保持有效
- [ ] docs/PROJECT_SCHEMA 与实现一致
- [ ] README 不夸大
- [ ] format/lint/typecheck/test/build 全通过
- [ ] 编译产物 smoke 通过
- [ ] 无 M2+ 实现、无网络
- [ ] 无 commit、无 push，交 Codex 审计

### 9.3 最终验收

```bash
pnpm format:check    # PASS
pnpm lint           # PASS
pnpm typecheck      # PASS
pnpm test           # PASS（所有测试通过）
pnpm build          # PASS
node dist/cli/index.js --help
node dist/cli/index.js init --help
node dist/cli/index.js status --help

# 在系统临时目录运行
node dist/cli/index.js init <temp>/demo --script examples/token-cost/script.md
node dist/cli/index.js status <temp>/demo
node dist/cli/index.js status <temp>/demo --json

# Git 检查
git diff --check
git status --short
```

**人工确认：**

- 树正确
- script bytes/hash/length 正确
- JSON 通过统一 parse
- generation null，blocks/scenes 空
- status created
- 第二次 init 非零且所有 bytes/mtime 不变
- status 完全只读
- 无 temp/sentinel
- 无网络

---

## 执行原则

### ✅ 必须做到

1. **严格按顺序执行**：Step 0 → Step 9，每步验证后再进入下一步
2. **只实现 M1**：不接入 LLM、素材网站、Web UI、plan/search/review 命令
3. **遵循冻结决策**：第 4 节所有决策直接执行，不讨论
4. **充分测试**：覆盖正反例、边界条件、并发、故障注入
5. **文档同步**：代码与文档保持同步更新

### ❌ 禁止事项

1. 不接入 DeepSeek、Anthropic、Pexels 或任何网络服务
2. 不实现 plan/search/review/validate 命令
3. 不实现 Web UI 或 Server
4. 不把业务逻辑写进 Commander handler
5. 不削弱 no-clobber、原子写入、路径安全让测试通过
6. 不 commit、不 push，保留工作树给 Codex 审计
7. 不自动继续 M2

### 📝 完成汇报格式

完成后按 M1_IMPLEMENTATION_PLAN.md 第 38 节格式汇报：

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

- 没有则写"无"
- 偏离计划时逐条说明原因和影响

## 审计提示

- 最值得 Codex 检查的 3～5 个位置

## Git 状态

- 明确说明没有 commit、没有 push
```

---

## 下一步行动

**现在开始执行 Step 0：基线验证**

请确认你已准备好，我将：

1. 运行基线检查
2. 记录当前状态
3. 进入 Step 1 开始实现

是否继续？ 🚀
