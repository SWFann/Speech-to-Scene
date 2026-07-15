# M2 Code Audit Report

> Audit date: 2026-07-14
> Scope: M2 implementation after `docs/milestones/M2_IMPLEMENTATION_PLAN.md`
> Auditor: Codex
> Status: changes requested before M3

## Summary

M2 introduced the expected major pieces: `s2s plan`, `planProject`, a planner port, source block extraction, anchor resolution, fixture planner, DeepSeek adapter, and tests. The shape is close, but the milestone is not ready to build M3 on top of it.

There is one release-blocking runtime issue: the compiled CLI cannot start because one source file imports from `../../src/...`, which leaks source-relative paths into `dist`. There are also correctness issues in source ranges, max scene validation, DeepSeek configuration, and CLI tests.

Validated locally:

- TypeScript typecheck: pass
- ESLint: pass
- Build: pass
- Prettier: fail, 14 files need formatting
- Vitest: blocked by missing native optional dependency `@rolldown/binding-win32-x64-msvc`
- Manual built CLI smoke test: fail, compiled `dist/cli/index.js` cannot resolve `src/shared/errors.js`

## Blocking Findings

### P0: Compiled CLI cannot run

File:

- `src/infrastructure/json-project-repository.ts`

The file imports runtime code through `../../src/...`:

- `../../src/domain/project-schema.js`
- `../../src/shared/errors.js`
- `../../src/domain/project-validation.js`

This typechecks, but after `tsc -p tsconfig.build.json`, `dist/infrastructure/json-project-repository.js` still imports `src/shared/errors.js`. Running `node dist/cli/index.js` fails with `ERR_MODULE_NOT_FOUND`.

Required fix:

- Replace those imports with normal source-relative imports:
  - `../domain/project-schema.js`
  - `../shared/errors.js`
  - `../domain/project-validation.js`
- Add a smoke test or script check that runs `node dist/cli/index.js --help` after build.

### P0: Source block offsets are wrong for CRLF input

File:

- `src/planner/source-blocks.ts`

`buildSourceBlocks` splits text with `/\r?\n/`, then computes offsets with `line.length + 1`. For CRLF documents, the original newline is two UTF-16 code units (`\r\n`), but the code counts one. Every block after the first CRLF boundary can get incorrect `sourceRange`.

M2 depends on exact UTF-16 source ranges. Wrong block ranges will make anchor resolution and persisted scene ranges unreliable.

Required fix:

- Build blocks by scanning the original decoded string and preserving actual newline lengths.
- Tests must assert exact ranges for CRLF, not only block count/text.
- Include emoji plus CRLF in one test.

### P0: M2 tests do not prove the real CLI project file behavior

File:

- `tests/unit/cli-plan.test.ts`

The test writes and checks old-style `.s2s/project.json`, while the real repository uses root-level `project.s2s.json`. The dry-run test checks the wrong file, so it can pass even if `s2s plan --dry-run` mutates the real project file.

Required fix:

- Remove `.s2s/project.json` setup.
- Use `createTempProject` output directly.
- Assert `project.s2s.json` before and after each CLI command.
- Confirm `--dry-run` leaves `project.s2s.json` byte-for-byte unchanged.

### P1: `maxScenes` is passed to the planner but not enforced

File:

- `src/application/plan-script.ts`

`input.maxScenes` is included in `plannerInput`, but validation uses `PlannerOutputSchema.parse(...)`, whose hard-coded max is 100. A provider returning 50 scenes can pass even when CLI requested `--max-scenes 5`.

Required fix:

- Add `parsePlannerOutput(output, { maxScenes })` or a separate post-parse validator.
- Reject output where `scenes.length > input.maxScenes`.
- Add tests with fake planner output exceeding max.

### P1: Anchor resolver can mask reversed quote order

File:

- `src/planner/anchor-resolver.ts`

The resolver uses:

```ts
const rangeStart = Math.min(startGlobal.start, endGlobal.start);
const rangeEnd = Math.max(startGlobal.end, endGlobal.end);
```

If the model returns a `startQuote` that appears after `endQuote`, the resolver silently flips the range instead of rejecting the invalid anchor. This can hide model mistakes and make scene order validation weaker.

Required fix:

- Require `startGlobal.start <= endGlobal.end`.
- For same-block anchors, require the start quote occurrence to begin at or before the end quote occurrence.
- Add a reversed-quote test.

### P1: Source block builder violates intended layer direction

File:

- `src/planner/source-blocks.ts`

The planner layer imports `decodeSourceText` from infrastructure. The source block builder is pure logic and should not depend on infrastructure. This is a small dependency inversion violation that will become awkward as M3/M4 add more providers and infrastructure.

Required fix:

- Move shared UTF-8 decode policy into a domain/shared utility, or pass decoded text into `buildSourceBlocks`.
- Keep file I/O and crypto in infrastructure only.

### P1: DeepSeek model is hard-coded as a default

Files:

- `src/planner/deepseek-script-planner.ts`
- `src/cli/commands/plan-command.ts`

M2 plan says DeepSeek model must come from environment/config. The implementation defaults to `"deepseek-chat"` if no model is provided. `.env.example` leaves `DEEPSEEK_MODEL=` empty, so users can accidentally run with a hidden default.

Required fix:

- Require `DEEPSEEK_MODEL` when provider is `deepseek`.
- Throw `InvalidArgumentError` from CLI for missing model.
- Keep model recording in `generation.model`, but never hard-code the default in the provider.

### P1: Expected CLI input errors are plain `Error`

File:

- `src/cli/commands/plan-command.ts`

Unknown provider, missing DeepSeek API key, and invalid `--max-scenes` throw plain `Error`, so they are formatted as unexpected errors and exit with generic code `1`.

Required fix:

- Throw `InvalidArgumentError` for user input/env configuration failures.
- Add tests asserting exitCode `2` and no "Unexpected error" text.

### P1: `planProject` does not update `project.updatedAt`

File:

- `src/application/plan-script.ts`

Planning changes the project file but preserves the previous `project.updatedAt`. `status` then reports stale update time.

Required fix:

- Set `project.updatedAt = generation.generatedAt` when saving planned project.
- Add a test that `updatedAt` changes after planning.

## Important Gaps

- `FixtureScriptPlanner` always generates one `speaker_only` scene from the first block. M2 asked for at least three fixture script categories and mixed visual decisions/search queries.
- `PlannerOutputSchema` does not validate query count/length beyond basic text length, nor does it discourage queries on non-stock scenes.
- `planProject` catches any repository load failure and turns it into `ProjectNotFoundError`, masking invalid schema/unsupported-version errors.
- `ProjectNotFoundError.userHint` still includes the full user-provided path.
- `JsonProjectRepository.save` validates the project, but stringifies the original `project` instead of the parsed `validated` value.
- No built-CLI smoke test exists.
- No real repository integration test proves invalid planned projects are rejected at the filesystem repository boundary.
- `s2s init` success text still says "`s2s plan` 将在 M2 提供", which is stale now that `plan` exists.

## Check Results

Commands run:

```bash
D:\Node\node.exe node_modules\prettier\bin\prettier.cjs --check ...
D:\Node\node.exe node_modules\typescript\bin\tsc -p tsconfig.json
D:\Node\node.exe node_modules\eslint\bin\eslint.js .
D:\Node\node.exe node_modules\typescript\bin\tsc -p tsconfig.build.json
D:\Node\node.exe node_modules\vitest\vitest.mjs run
```

Results:

- Prettier failed on 14 M2 files.
- Typecheck passed.
- ESLint passed.
- Build passed.
- Vitest did not start because local `node_modules` is missing `@rolldown/binding-win32-x64-msvc`.

Manual smoke test:

```bash
node dist/cli/index.js init ...
```

Result:

- Failed with `ERR_MODULE_NOT_FOUND` because `dist/infrastructure/json-project-repository.js` imports `src/shared/errors.js`.

## Recommended Fix Order

1. Fix all `../../src/...` imports inside `src`.
2. Add built CLI smoke test.
3. Fix CRLF source range calculation.
4. Fix CLI plan tests to use `project.s2s.json`.
5. Enforce `maxScenes`.
6. Reject reversed quote anchors.
7. Require `DEEPSEEK_MODEL` for DeepSeek.
8. Convert CLI user/config failures to `InvalidArgumentError`.
9. Update `project.updatedAt` during planning.
10. Format M2 files and run the full suite in a clean dependency install.

## M3 Readiness Gate

M3 may start only when:

- `node dist/cli/index.js --help` works after build;
- `s2s init -> s2s plan --provider fixture -> s2s status --json` works against `project.s2s.json`;
- CRLF/emoji source block ranges are exact;
- CLI `--dry-run` is proven byte-stable;
- DeepSeek cannot run without both API key and model;
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass in a clean Windows install.
