# M4-00 Audit Report

> Audit date: 2026-07-15
> Scope: M4-00 test reproducibility gate
> Auditor: Codex
> Status: changes requested; do not start M4-01 yet

## Summary

M4-00 is not accepted yet.

The source tree remains healthy when checked through the locally installed tools, but the actual M4-00 goal was to make `pnpm test` reproducible. That goal is still unmet in this workspace.

## Verification Results

| Check                             | Result             | Evidence                                                                                                        |
| --------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `pnpm --version` through Corepack | Pass               | Reports `11.7.0`.                                                                                               |
| `pnpm format:check`               | Fail before script | pnpm attempts dependency status/install flow and aborts because it wants to purge `node_modules` without a TTY. |
| `pnpm lint`                       | Fail before script | Same pnpm modules purge prompt issue.                                                                           |
| `pnpm typecheck`                  | Fail before script | Same pnpm modules purge prompt issue.                                                                           |
| `pnpm test`                       | Fail before script | Same pnpm modules purge prompt issue.                                                                           |
| Local Prettier binary             | Pass               | Source/docs formatting is clean.                                                                                |
| Local ESLint binary               | Pass               | No lint errors.                                                                                                 |
| Local TypeScript full typecheck   | Pass               | `tsc -p tsconfig.json` exits 0.                                                                                 |
| Local build typecheck             | Pass               | `tsc -p tsconfig.build.json` exits 0.                                                                           |
| Local Vitest binary               | Fail               | Missing `@rolldown/binding-win32-x64-msvc`.                                                                     |

## Root Problem

The workspace dependency installation is not reproducible for the current Windows Codex environment.

Current `node_modules/@rolldown` contains:

```text
binding-linux-x64-gnu
pluginutils
```

But Vitest/Rolldown needs:

```text
@rolldown/binding-win32-x64-msvc
```

Corepack/Pnpm now also detects the modules directory is incompatible and tries to run an install/status correction, but aborts in non-interactive mode:

```text
ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
Aborted removal of modules directory due to no TTY
```

## Decision

Do not start M4-01 yet. M4-00 must be completed first because the whole point of the next phased workflow is that every task pack can be verified with:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Required Follow-up

Claude should run a focused M4-00A task:

- fix the workspace dependency installation so `pnpm` commands can run non-interactively;
- ensure the correct Windows Rolldown optional dependency is installed by pnpm;
- avoid committing native binaries;
- avoid product code changes unless absolutely necessary;
- re-run all required checks.
