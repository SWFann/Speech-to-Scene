# Speech-to-Scene Repository Instructions

## Scope

Only implement Phase 1:

```text
script -> semantic scenes -> asset candidates -> local review board
       -> manual download and local asset attachment
```

Do not implement rendering, ASR, timeline alignment, live recording, AI media generation, cloud accounts, databases, or mobile apps.

## Sources of truth

Read before architectural changes:

1. `Speech-to-Scene_Phase1_Demo_Execution_Plan.md`
2. `PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md`
3. `docs/PROJECT_SCHEMA.md`
4. `docs/VISUAL_GRAMMAR.md`
5. `docs/ASSET_LICENSING.md`

The Zod project schema will be the single source of truth for persisted project data.

## Architecture boundaries

- Domain must not import filesystem, HTTP, React, model SDKs, or asset-provider code.
- Application services depend on interfaces, not concrete providers.
- DeepSeek, Anthropic, Pexels, and future sources are infrastructure providers.
- Every external input is `unknown` until validated.
- CLI commands delegate to application services.
- React calls local APIs and never accesses the filesystem directly.
- Every project write goes through the repository and atomic-write implementation.
- Unit tests never call real external services.

## Required checks

Before completing an implementation task, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Report any check that could not run. Do not claim success without evidence.

## Repository hygiene

- Implement one milestone or issue at a time.
- Do not silently broaden scope.
- Add tests for behavior changes.
- Preserve unrelated user changes.
- Never commit secrets, downloaded media, caches, logs, or user projects.
- Treat code licensing and third-party asset licensing as separate concerns.
