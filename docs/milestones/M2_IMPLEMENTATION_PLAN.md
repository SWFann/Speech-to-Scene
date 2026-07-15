# M2 Implementation Plan: Script Planner, Source Blocks, and `s2s plan`

> Target executor: Claude Code
> Follow-up auditor: Codex
> Current prerequisite: fix all blocking items in `docs/milestones/M1_CODE_AUDIT_REPORT.md`
> Milestone boundary: implement planning only; do not implement asset search, review server, web UI, or local asset attachment

## 1. Goal

M2 turns an initialized project into a planned project:

```bash
s2s init ./demo --script ./script.md
s2s plan ./demo --provider fixture
s2s status ./demo
```

After M2, `project.s2s.json` must contain:

- deterministic `source.blocks`;
- `generation` metadata;
- validated semantic `scenes`;
- visual decisions;
- search queries prepared for M3;
- no asset candidates from real providers.

The project must still be local-first. Tests must not call real network services.

## 2. Start Gate

Before implementing M2, Claude must complete M1 hardening:

- Repository load/create/save runs Zod parse plus `validateProjectRelations`.
- Persisted schemas do not mutate input through `.transform()` or `.trim()`.
- BOM behavior is fixed and tested.
- CLI uses AppError formatting for expected failures.
- Crash-residue sentinel behavior is explicit and tested.
- `UtcDateTimeSchema` rejects impossible dates.
- M1 status contract is either restored or explicitly documented.
- Full check suite passes in a clean install.

Do not continue M2 while these are failing. M2 writes planned scenes, so it depends on the repository validation boundary.

## 3. Non-goals

Do not implement:

- Pexels, Openverse, Wikimedia, Unsplash, or any asset search;
- downloading media;
- review server or React UI;
- local asset attachment;
- video rendering, ASR, timeline alignment, subtitles, or AI image generation;
- database or cloud account support;
- automatic prompt tuning;
- hidden chain-of-thought logging;
- committing or pushing.

DeepSeek support is allowed in M2, but it must be isolated behind a provider interface and disabled unless configured.

## 4. Architecture

Add planning as an application use case. Keep current layer boundaries:

```text
src/
├── application/
│   ├── plan-script.ts
│   └── ports/
│       └── script-planner.ts
├── planner/
│   ├── planner-output-schema.ts
│   ├── source-blocks.ts
│   ├── anchor-resolver.ts
│   ├── plan-script-prompt-v1.ts
│   ├── fixture-script-planner.ts
│   └── deepseek-script-planner.ts
├── infrastructure/
│   ├── env.ts
│   └── http-json-client.ts
└── cli/
    └── commands/
        └── plan-command.ts
```

Small naming changes are fine, but responsibilities must stay separate.

## 5. Planner Port

Define a provider-neutral interface:

```ts
export interface ScriptPlanner {
  readonly providerId: string;
  readonly capabilities: PlannerCapabilities;
  plan(input: PlanScriptInput): Promise<PlannerRawResult>;
}
```

Required types:

- `PlannerCapabilities`
  - `jsonMode: boolean`
  - `strictJsonSchema: boolean`
  - `toolCalling: boolean`
  - `usageMetrics: boolean`
- `PlanScriptInput`
  - `rawText: string`
  - `sourceBlocks: SourceBlockForPlanner[]`
  - `language`
  - `aspectRatio`
  - `style`
  - `assetUsePolicy`
  - `maxScenes`
  - `promptVersion`
- `PlannerRawResult`
  - `output: unknown`
  - `model?: string`
  - `apiProtocol: "fixture" | "openai-compatible" | "anthropic"`
  - `usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }`
  - `requestId?: string`

Do not expose API keys, full raw request bodies, hidden reasoning, or provider-specific SDK objects outside infrastructure.

## 6. Source Block Builder

Implement deterministic local source block extraction before calling any planner.

Rules:

- Input is the copied project source file bytes.
- Decode using the same fatal UTF-8/BOM policy fixed in M1.
- Offsets are JavaScript UTF-16 code units.
- Blocks are ordered from 1.
- IDs are deterministic: `block-0001`, `block-0002`, etc.
- Supported block kinds in M2:
  - Markdown heading
  - paragraph
  - list item
  - blockquote
  - fenced code block
  - other
- Preserve source ranges as `[start, end)`.
- Do not drop text from range accounting.
- Blank-only gaps may exist between blocks.

Tests must cover:

- Chinese text;
- emoji;
- CRLF;
- UTF-8 BOM;
- headings;
- paragraphs;
- lists;
- blockquotes;
- fenced code blocks;
- trailing newline;
- empty or whitespace-only source rejection from M1.

## 7. Planner Output Schema

Do not send or ask the model to fill the full `SpeechToSceneProjectSchema`.

Create a dedicated `PlannerOutputSchema`:

```ts
type PlannerOutput = {
  scenes: Array<{
    sourceAnchor: {
      strategy: "source-blocks-v1";
      sourceBlockIds: string[];
      startQuote: string;
      endQuote: string;
    };
    summary: string;
    narrativeRole: NarrativeRole;
    visualPlan: {
      decision: VisualDecision;
      rationale: string;
      preferredMedia: Array<"photo" | "video">;
      visualKeywords: string[];
    };
    queries: Array<{
      language: "zh" | "en";
      query: string;
      purpose: string;
      enabled: boolean;
    }>;
  }>;
};
```

Validation rules:

- `scenes.length` between 1 and configurable `maxScenes`.
- Scene anchors must reference existing blocks.
- Anchor block IDs must be unique and consecutive.
- Scene order follows source order.
- Anchors cannot overlap after resolution.
- `stock_asset` requires at least one enabled query.
- `speaker_only`, `title_card`, `structured_graphic`, `screen_capture`, `user_asset`, and `none` should not require external candidates in M2.
- Query text must be concrete, bounded in length, and non-empty.
- No scene may add facts not present in source.

The last rule cannot be perfectly machine-checked; enforce it through prompt wording and fixture review.

## 8. Anchor Resolver

M2 must not trust model-provided character offsets.

For each planned scene:

1. Find the referenced source blocks.
2. Confirm block IDs exist and are consecutive by order.
3. Search for `startQuote` inside the first block text.
4. Search for `endQuote` inside the last block text.
5. Resolve exact `[start, end)` offsets in the full source text.
6. Compute `scene.text = rawText.slice(start, end)`.
7. Reject ambiguous quotes unless a deterministic rule is documented and tested.
8. Reject empty or whitespace-only resolved scene text.
9. Reject overlap with the previous resolved scene.

Failure must not write partial scenes.

## 9. `planProject` Use Case

Create `planProject(input, repository, planner, clock, idGenerator)`:

Input:

- `projectRoot`
- `provider`
- `force`
- `maxScenes`
- optional `dryRun`

Flow:

1. Load project through repository.
2. Read copied source file from `project.source.path`.
3. Verify source file hash matches `project.source.sha256`.
4. Build source blocks.
5. Reject planning if project already has scenes or non-null generation.
6. If `--force`, allow replacement only when no review decisions or local assets exist.
7. Call selected planner.
8. Parse with `PlannerOutputSchema`.
9. Resolve anchors locally.
10. Convert to persisted `Scene[]`.
11. Build `generation` metadata.
12. Save whole project atomically through repository.

M2 must never write invalid planner output into the project.

## 10. Fixture Planner

Implement `FixtureScriptPlanner` first.

Requirements:

- Deterministic output for known fixture scripts.
- No network.
- Output still goes through the same parser, anchor resolver, relation validator, and repository save path as DeepSeek.
- Include at least three fixture scripts:
  - knowledge explanation;
  - personal story;
  - opinion/commentary.

Fixture expectations:

- Not every scene is `stock_asset`.
- At least one scene is `speaker_only` or `none`.
- At least one scene has two enabled queries.
- Chinese and English query examples exist.

## 11. DeepSeek Planner

Add DeepSeek as an OpenAI-compatible infrastructure provider.

Environment variables:

```dotenv
S2S_PLANNER_PROVIDER=fixture
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=
```

Rules:

- Do not hard-code model names in Domain.
- Do not log API keys.
- Base URL must be configurable.
- Timeout must be finite.
- Non-2xx responses become `PlannerError`.
- Invalid JSON becomes `PlannerOutputError`.
- Valid JSON that fails Zod or relation validation becomes `PlannerValidationError`.
- Unit tests use fake HTTP clients only.
- A manual smoke test may be documented but must not run in CI.

Output strategy:

1. Prefer strict JSON schema if provider capabilities say it is available.
2. Otherwise use JSON mode.
3. Plain text JSON extraction is allowed only as an explicit fallback with tests.

## 12. Prompt v1

Create `plan-script-v1`.

Prompt must instruct:

- Segment by semantic beats, not every sentence.
- Do not overuse stock assets.
- Preserve personal/emotional segments as speaker-only when appropriate.
- Convert abstract ideas into concrete searchable visuals.
- Do not create generic "success/future/technology" imagery.
- Use block IDs and short quotes, not character offsets.
- Keep scene order identical to source order.
- Do not add facts or change the speaker's viewpoint.
- Generate practical Chinese and English search queries only when a stock asset is useful.

Update `generation.promptVersion` whenever prompt semantics change.

## 13. CLI

Add:

```bash
s2s plan <project-directory> [--provider fixture|deepseek] [--force] [--max-scenes <n>] [--dry-run] [--json]
```

Behavior:

- Default provider comes from `S2S_PLANNER_PROVIDER`, falling back to `fixture`.
- `--provider deepseek` requires `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL`.
- `--dry-run` validates and prints the plan summary without saving.
- `--json` prints machine-readable output only.
- Human output includes:
  - generated scene count;
  - count of scenes needing stock assets;
  - provider;
  - prompt version;
  - project status.

Exit codes:

- `0`: success
- `1`: I/O or provider runtime failure
- `2`: invalid user input or missing env
- `3`: schema, relation, or planner output validation failure

## 14. Tests

Required test groups:

- Source block builder unit tests.
- Anchor resolver unit tests.
- Planner output schema tests.
- `planProject` use-case tests with fixture planner.
- Repository integration tests confirming invalid planned projects cannot save.
- CLI integration tests for `s2s plan`.
- DeepSeek provider tests using a fake HTTP client.

Must cover failures:

- unknown block ID;
- non-consecutive blocks;
- ambiguous start quote;
- missing end quote;
- overlapping resolved ranges;
- `stock_asset` without enabled query;
- provider returns malformed JSON;
- provider returns extra fields;
- provider returns too many scenes;
- source hash mismatch;
- planning an already planned project without `--force`;
- `--force` rejected when review/local asset data exists;
- missing DeepSeek env variables.

## 15. Documentation Updates

Update:

- `README.md`: add `s2s plan` once implemented.
- `docs/PROJECT_SCHEMA.md`: document source blocks, generation metadata, and scene status after planning.
- `docs/VISUAL_GRAMMAR.md`: reference prompt decisions and when to use speaker-only.
- `.env.example`: add DeepSeek planner variables.
- `docs/milestones/M2_IMPLEMENTATION_PLAN.md`: mark completed tasks only when verified.

Do not remove M1 audit notes until the fixes are complete.

## 16. Definition of Done

M2 is complete only when:

- M1 audit blocking findings are fixed.
- `s2s init` still works.
- `s2s plan --provider fixture` writes a valid planned project.
- `s2s status --json` reports planned status and correct scene totals.
- DeepSeek provider exists behind an interface and is testable without network.
- No test makes a real network call.
- Invalid planner output never reaches `project.s2s.json`.
- Full local checks pass:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 17. Suggested Claude Prompt

```text
请先阅读：
1. AGENTS.md
2. CLAUDE.md
3. docs/milestones/M1_CODE_AUDIT_REPORT.md
4. docs/milestones/M2_IMPLEMENTATION_PLAN.md
5. docs/PROJECT_SCHEMA.md
6. docs/VISUAL_GRAMMAR.md
7. docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md 第 3、4、12 节

任务：
先修复 M1_CODE_AUDIT_REPORT.md 中所有 Blocking Findings，并补齐对应测试。
确认 M1 全量检查通过后，再实现 M2：ScriptPlanner port、source block builder、anchor resolver、fixture planner、DeepSeek planner adapter、planProject use case 和 s2s plan CLI。

边界：
不得实现素材搜索、Review UI、上传、本地素材关联、视频渲染、ASR 或数据库。
不得真实调用网络测试。DeepSeek 只能通过可注入 HTTP client 测试。
不得将无效 planner output 写入项目文件。
完成后保留未提交工作树，交给 Codex 审计。
```
