# Contributing

Speech-to-Scene is developed one milestone or focused issue at a time. Read `AGENTS.md`, the phase plan, and the analysis document before making architectural changes.

## Setup

```bash
corepack enable
pnpm install
pnpm check
```

Use Node.js 24 LTS and the pnpm version declared in `package.json`.

## Changes

- Keep Domain independent from providers and I/O.
- Validate all external inputs.
- Add or update tests for behavior changes.
- Do not access real network services in unit tests.
- Do not add dependencies without a concrete need.
- Do not commit secrets, user projects, downloaded assets, caches, or raw provider responses.
- Include official licensing evidence when adding an asset source.

Use Conventional Commits such as `feat:`, `fix:`, `test:`, `docs:`, and `chore:`.
