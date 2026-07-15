# M3 Re-audit Report

> Audit date: 2026-07-14
> Scope: Claude's claimed M3 P0/P1 fixes after `M3_CODE_AUDIT_REPORT.md`
> Auditor: Codex
> Status: changes requested before M4

## Summary

Claude's update significantly improves M3: lint and full TypeScript typecheck are now clean, the build succeeds, and a real `dist` smoke flow can produce a fixture asset candidate.

However, M3 is not yet clean enough to start M4. The current repository still fails format checking, Vitest cannot be reproduced in this Codex environment because the Rolldown native optional dependency is missing, and the built CLI has a user-visible help failure in `s2s search --help`. The smoke flow also reveals a status-model inconsistency: `search` reports `searched`, but `s2s status` still reports project status as `planned`.

## Verification Results

Commands run from:

```text
F:\工作盘\实习经历汇总\星星之火-创业\口播\Demo
```

| Check                                                           | Result       | Notes                                                                                   |
| --------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `eslint .` through local `node_modules`                         | Pass         | No ESLint errors.                                                                       |
| `tsc -p tsconfig.json` through local `node_modules`             | Pass         | Full typecheck now passes.                                                              |
| `tsc -p tsconfig.build.json` through local `node_modules`       | Pass         | Build check passes.                                                                     |
| `prettier --check ...` through local `node_modules`             | Fail         | 27 TypeScript files are not formatted.                                                  |
| `vitest run` through local `node_modules`                       | Blocked      | Startup error: missing `@rolldown/binding-win32-x64-msvc`.                              |
| `corepack pnpm ...`                                             | Blocked      | Sandbox cannot write Corepack cache under `C:\Users\10481\AppData\Local\node\corepack`. |
| `dist` smoke `init -> plan fixture -> search fixture -> status` | Partial pass | Search writes 1 candidate, but status command still reports `planned`.                  |

## Remaining Blocking Findings

### P0: Format check still fails

`format:check` equivalent reports 27 unformatted files, including:

- `src/application/search-project-assets.ts`
- `src/cli/commands/search-command.ts`
- `src/infrastructure/file-search-cache.ts`
- `src/providers/fixture/fixture-asset-provider.ts`
- `src/providers/pexels/pexels-asset-provider.ts`
- `src/providers/pexels/pexels-client.ts`
- multiple unit test files

Required fix:

- Run the project formatter.
- Re-run `pnpm format:check`.
- Do not claim all checks pass unless `format:check` is clean too.

### P0: `s2s search --help` exits as a fatal error

Observed behavior:

```text
s2s search --help
```

prints the help text, then exits through the root `runCli().catch(...)` path with:

```text
Fatal error: Error: Command failed with exit code CommanderError: (outputHelp)
```

Cause:

- `createSearchCommand()` calls `.exitOverride(...)` unconditionally on the production command.
- This is useful for tests but incorrect for the real CLI because Commander help output becomes an exception.

Required fix:

- Do not install `exitOverride()` in the production command.
- If tests need it, apply it to the test-created program only.
- Verify:
  - `s2s --help`
  - `s2s search --help`
  - `s2s plan --help`
  - `s2s status --help`

### P0: M4 is not implemented

The current source tree has no review command/server/API. `s2s review --help` falls back to the root help; `src/cli/index.ts` only registers:

- `init`
- `plan`
- `search`
- `status`

This is fine if Claude only intended to finish M3, but the final todo list included "Implement M4". That has not happened.

Required fix:

- Finish M3 first.
- Then implement M4 according to `docs/milestones/M4_IMPLEMENTATION_PLAN.md`.

### P1: Project status terminology is inconsistent after search

Smoke result:

- `s2s search --json` reports:
  - `status: "searched"`
  - `totalCandidates: 1`
- immediate `s2s status --json` reports:
  - `status: "planned"`
  - `scenes.byStatus.pending: 1`

The persisted project does contain a candidate and `lastSearchedAt`, but the status derivation ignores candidate readiness for pending scenes.

Required fix:

- Decide the source-of-truth status model before M4:
  - either keep project-level status as only `created | planned` and change search output wording;
  - or extend project status to represent searched/candidates-ready state.
- Per-scene status should treat `pending review + candidates.length > 0` as `candidates_ready`, as the comment in `project-status.ts` already says.

### P1: Some source files contain mojibake in comments/messages

Examples observed:

- `src/cli/commands/search-command.ts` human output strings are mojibake and have broken interpolation text such as `椤圭洰锛?{result.projectId}`.
- `src/application/search-project-assets.ts` contains mojibake user-facing Chinese error messages.
- `src/domain/project-status.ts` has mojibake in comments.
- `src/providers/pexels/pexels-client.ts` has mojibake in comments.

Required fix:

- Replace mojibake with valid UTF-8 Chinese or plain English.
- Add a CLI smoke assertion for human output if keeping localized CLI messages.

## Positive Findings

- Application search no longer imports concrete asset providers.
- Search cache types now live in the application port and include full normalized candidate response objects.
- `computeCacheKey()` includes `queryId`, reducing query collision risk.
- Fixture smoke search now produces at least one candidate.
- Pexels photo `sourcePageUrl` and video thumbnail mapping appear corrected in source.
- `s2s search` exposes `--scene`, `--refresh`, `--limit`, `--json`, and `--dry-run`.

## Next Gate Before M4

M4 may start only after:

1. `pnpm format:check` passes.
2. `pnpm lint` passes.
3. `pnpm typecheck` passes.
4. `pnpm test` passes in the same environment used for delivery, or the missing native dependency is fixed and tests are reproducible for Codex.
5. `pnpm build` passes.
6. `dist` smoke confirms:
   - `init -> plan --provider fixture -> search --provider fixture -> status`;
   - search writes valid candidates;
   - status output is semantically consistent;
   - all command `--help` paths exit cleanly.

## Claude Follow-up Prompt

```text
Please continue from the current Speech-to-Scene repository state.

Do not start M4 yet. First fix the remaining M3 re-audit issues in:

docs/milestones/M3_REAUDIT_REPORT.md

Required fixes:

1. Run the formatter and make pnpm format:check pass.
2. Fix s2s search --help so it prints help and exits cleanly without Fatal error.
   - Do not use command.exitOverride() in the production CLI command.
   - If tests need exitOverride(), apply it only in test-created programs.
3. Resolve the status inconsistency after search:
   - s2s search --json currently reports searched and writes candidates;
   - s2s status --json still reports planned/pending.
   - Decide and implement a consistent status model before M4.
   - At minimum, pending scenes with candidates should derive candidates_ready if that is the intended model.
4. Clean mojibake Chinese/comment strings in touched source files, especially:
   - src/cli/commands/search-command.ts
   - src/application/search-project-assets.ts
   - src/domain/project-status.ts
   - src/providers/pexels/pexels-client.ts
5. Make tests reproducible:
   - Ensure pnpm test runs in a clean install.
   - If the Rolldown native optional dependency is missing, refresh the install/lockfile correctly; do not vendor generated native binaries manually.
6. Re-run and report exact results:
   - pnpm format:check
   - pnpm lint
   - pnpm typecheck
   - pnpm test
   - pnpm build
7. Run a dist smoke test:
   - s2s --help
   - s2s search --help
   - s2s init <tmp-project> --script <tmp-script>
   - s2s plan <tmp-project> --provider fixture --json
   - s2s search <tmp-project> --provider fixture --json
   - s2s status <tmp-project> --json
   Confirm candidates are written and status output is consistent.

Only after this M3 gate is clean should you implement M4 from:

docs/milestones/M4_IMPLEMENTATION_PLAN.md

Do not commit. Leave changes in the working tree for Codex audit.
```
