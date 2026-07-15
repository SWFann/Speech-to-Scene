# M1 Code Audit Report

> Audit date: 2026-07-14
> Scope: M1 implementation after `docs/milestones/M1_IMPLEMENTATION_PLAN.md`
> Auditor: Codex
> Status: changes requested before M2

## Summary

M1 has the right broad shape: Schema, repository, project scaffolding, `init`, `status`, fixtures, and tests now exist. The implementation is close enough to continue, but M2 should not start until the issues below are fixed because several of them affect persisted protocol correctness or user-visible CLI behavior.

Validated locally:

- Prettier: pass
- TypeScript typecheck: pass
- ESLint: pass
- Build: pass
- Vitest: blocked by missing native optional dependency `@rolldown/binding-win32-x64-msvc` in local `node_modules`

## Blocking Findings

### P0: Repository does not run relation validation on load/save

Files:

- `src/infrastructure/json-project-repository.ts`
- `src/domain/project-validation.ts`

`JsonProjectRepository` parses with `SpeechToSceneProjectSchema.parse(...)`, but never calls `validateProjectRelations(...)`. This means invalid persisted projects can load successfully if they pass single-object Zod rules but violate cross-object rules, such as:

- non-consecutive block or scene order;
- overlapping or out-of-bound source ranges;
- scene anchors referencing missing blocks;
- scene ranges outside anchor coverage.

M1 required full schema plus relation validation as the repository boundary. M2 will depend on this boundary before writing planned scenes.

Required fix:

- Add a single `parseAndValidateProject(raw: unknown)` entry point.
- It must run schema parse, then `validateProjectRelations`.
- `load`, `create`, and `save` must all use it.
- Relation issues must be wrapped as `ProjectValidationError` with safe messages.

### P0: Primitive schemas mutate persisted data

Files:

- `src/domain/schema-primitives.ts`
- `src/infrastructure/project-paths.ts`

`NonEmptyTrimmedStringSchema`, `IdSchema`, and `ProjectRelativePathSchema` use `.trim()` or `.transform(...)`. M1 explicitly banned transforms that mutate persisted data. This currently means `"  title  "` is silently saved as `"title"` and `"a//b"` becomes `"a/b"`.

Required fix:

- Replace transform-based schemas with validation-only schemas.
- Reject leading/trailing whitespace instead of trimming.
- Reject duplicate path slashes instead of normalizing.
- Update tests that currently expect trimming or normalization.
- If CLI wants friendly title trimming, do it before constructing the persisted object, not inside the persisted schema.

### P1: UTF-8 BOM length is documented incorrectly and likely computed incorrectly

File:

- `src/infrastructure/source-document.ts`

The comment says BOM is preserved and contributes to `textLengthUtf16`, but the decoder uses `ignoreBOM: false`. In Web/Node `TextDecoder`, this normally means the BOM is consumed rather than emitted. M1 required source byte hash to preserve raw bytes and text length to be based on fatal UTF-8 decode where BOM behavior is explicit.

Required fix:

- Decide and document the exact behavior.
- For M1's stated behavior, use `ignoreBOM: true` and add a test with `tests/fixtures/scripts/utf8-bom.txt`.
- Verify `textLengthUtf16` includes U+FEFF when BOM exists.

### P1: CLI formats expected AppErrors as "Unexpected error"

Files:

- `src/cli/commands/init-command.ts`
- `src/cli/commands/status-command.ts`
- `src/cli/error-reporter.ts`

Both command handlers import and call `formatUnexpectedError(...)` for all errors. This discards the AppError formatting path and makes normal user errors appear as unexpected failures.

Required fix:

- Use `ctx.formatError(error)` when `error instanceof AppError`.
- Use `ctx.formatUnexpectedError(error)` only for non-AppError failures.
- Add CLI tests for missing script, unsupported extension, duplicate project, malformed project, unknown schema version, and `--json` error behavior.

### P1: Incomplete project sentinel detection only checks the new token

File:

- `src/application/create-project.ts`

`checkExistingProject(...)` calls `scaffolder.checkSentinel(projectRoot, sentinelToken)` before the new sentinel is written. Because the token is newly generated, this cannot detect a crashed previous init with a different sentinel token. The later `mkdir` fails, but it is wrapped as a generic `ProjectWriteError`, not a clear incomplete-project refusal.

Required fix:

- Add `scaffolder.hasAnySentinel(projectRoot)` or equivalent.
- If target exists without `project.s2s.json`, reject as `ProjectAlreadyExistsError` or a dedicated `IncompleteProjectError`.
- Do not delete directories that this process did not create.
- Add tests for crash residue: existing directory with sentinel and no project JSON.

### P1: Date validation accepts impossible calendar dates

File:

- `src/domain/schema-primitives.ts`

`UtcDateTimeSchema` only checks day `1..31`, so invalid dates such as `2026-02-31T00:00:00Z` can pass. Persisted protocol timestamps should not accept impossible dates.

Required fix:

- Validate by round-tripping through `Date.UTC(...)` and comparing components.
- Keep mandatory `Z` and reject offsets.
- Add leap-year tests.

### P1: Project status diverges from M1 contract

File:

- `src/domain/project-status.ts`

M1 defined project status as:

- `generation === null` -> `created`
- `generation !== null` -> `planned`

The implementation adds `producing` in M1 based on review progress. This is future-facing behavior and should be deferred unless the M1 contract is explicitly updated.

Required fix:

- Either remove `producing` from M1 status, or document and test the expanded status contract before M2.
- Prefer removing it now and adding richer review status in M5.

## Important Gaps

- `ProjectRelativePathSchema` lives in infrastructure but is a persisted Domain primitive. Either move it to domain or keep only runtime filesystem helpers in infrastructure.
- `LocalAssetSchema.relativePath` uses a custom regex instead of the shared project-relative path rules and does not reject all reserved Windows names or traversal forms through the same primitive.
- Repository path safety is mostly lexical. It does not canonicalize project root with `realpath` for symlink or junction escape checks.
- `ProjectNotFoundError` user hints still include the full user-provided path.
- There are no real repository contract tests for `JsonProjectRepository`.
- There are no atomic-write fault injection tests.
- CLI tests only assert the command name; they do not execute `init` or `status`.

## Recommended Fix Order

1. Add a single parse-plus-relation validation entry point.
2. Remove all persisted-schema transforms.
3. Fix BOM decode behavior and tests.
4. Fix AppError CLI formatting.
5. Add sentinel crash-residue detection.
6. Strengthen timestamp validation.
7. Align project status with M1.
8. Add repository, atomic write, and CLI integration tests.

## M2 Readiness Gate

M2 may start only when:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass in a clean dependency install;
- created and planned fixtures both pass repository load through the same validation entry point;
- an intentionally invalid relation fixture is rejected by repository load;
- CLI expected errors are not labeled as unexpected;
- BOM fixture has an explicit expected `textLengthUtf16`;
- `git status --short` is understood and all M1 files are intentionally staged or left for review.
