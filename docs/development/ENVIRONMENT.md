# Development Environment

This document records the canonical environment used for running tests, lint, typecheck, and build for the Speech-to-Scene project.

## Baseline Environment

All `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm format:check` commands are validated against this environment:

| Item           | Value                                    |
| -------------- | ---------------------------------------- |
| OS             | Ubuntu 20.04.5 LTS (Focal Fossa) on WSL2 |
| Kernel         | Linux 6.18.33.2-microsoft-standard-WSL2  |
| Node.js        | v24.18.0 (Node.js 24 LTS)                |
| pnpm           | 11.7.0                                   |
| Vitest         | v4.1.10                                  |
| Native binding | `@rolldown/binding-linux-x64-gnu`        |

**Test baseline date:** 2026-07-15

## Verification Results (2026-07-15, WSL/Ubuntu2)

| Check               | Result         |
| ------------------- | -------------- |
| `pnpm format:check` | PASS           |
| `pnpm lint`         | PASS           |
| `pnpm typecheck`    | PASS           |
| `pnpm test`         | PASS (332/332) |
| `pnpm build`        | PASS           |

## Platform Notes

### Recommended Environment

- **Use WSL/Linux (Ubuntu2 or similar) to run `pnpm install`, `pnpm test`, and `pnpm build`.**
- The project's native dependencies (e.g., `@rolldown/binding-*`) are platform-specific.
  WSL/Linux installs `binding-linux-x64-gnu`; Windows requires `binding-win32-x64-msvc`.

### Do Not Share `node_modules` Across Platforms

- **Never share `node_modules` between Windows and WSL.**
  Mixing native bindings from different platforms causes tool startup failures (e.g., Vitest).

### Switching Platforms

If you switch from one platform to another (e.g., Windows → WSL, or WSL → Windows):

1. Delete `node_modules` in the project root.
2. Run `pnpm install` on the new platform.
3. `pnpm-lock.yaml` is platform-agnostic and does **not** need to be deleted.

```bash
rm -rf node_modules
pnpm install
```

### Codex / Claude Audit Environment

- Codex's Windows sandbox cannot directly access the user's WSL distro (e.g., Ubuntu2).
- Therefore, `pnpm test` results from Claude running in WSL/Ubuntu2 are the authoritative baseline.
- All audit reports must state the execution environment:
  - Operating system and version
  - Node.js version
  - pnpm version
  - Test results (pass/fail, count)

## Quick Start (WSL/Ubuntu2)

```bash
corepack enable
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Environment variables should be configured starting from `.env.example`. Never commit API keys to Git.
