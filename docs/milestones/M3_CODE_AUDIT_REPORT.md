# M3 Code Audit Report

> Audit date: 2026-07-14
> Scope: M3 implementation after `docs/milestones/M3_IMPLEMENTATION_PLAN.md`
> Auditor: Codex
> Status: changes requested before M4

## Summary

M3 added the expected high-level files: `searchProjectAssets`, an asset-provider port, file search cache, fixture provider, Pexels provider/client/types, `s2s search`, and tests. However, the current M3 implementation is not ready to build M4 on top of it.

The code does not pass TypeScript, Prettier, or ESLint. One test file is syntactically corrupted. The real `dist` CLI can run, but `init -> plan --provider fixture -> search --provider fixture` produces zero candidates because the fixture planner still creates a `speaker_only` scene with no queries. That means the M3 headline path does not prove the search milestone.

Validated locally:

- Build: pass, but only because tests are excluded
- Built CLI `--help`: pass
- Built CLI smoke `init -> plan fixture -> search fixture -> status`: command chain runs, but search returns `0` candidates
- Prettier: fail
- TypeScript typecheck: fail
- ESLint: fail
- Vitest: blocked by missing native optional dependency `@rolldown/binding-win32-x64-msvc`

## Blocking Findings

### P0: Repository has uncompilable tests and typecheck fails

File:

- `tests/unit/search-project-assets.test.ts`

The file contains an unterminated string and unrelated corrupted text starting around line 30. This breaks `tsc -p tsconfig.json`, Prettier, and ESLint.

Required fix:

- Replace the corrupted test file with valid tests using the current `SpeechToSceneProject` schema.
- Do not use old project shapes such as `assetUsePolicy.licensePreference`, `sourceConfig`, `generation.id`, or scene structures that do not exist in `project.s2s.json`.
- Re-run Prettier, typecheck, ESLint, and Vitest in a clean install.

### P0: M3 smoke path produces zero candidates

Files:

- `src/planner/fixture-script-planner.ts`
- `src/application/search-project-assets.ts`

Manual smoke test:

```bash
node dist/cli/index.js init ...
node dist/cli/index.js plan ... --provider fixture
node dist/cli/index.js search ... --provider fixture
```

The search command reports:

```text
候选素材数：0
缓存命中：0
缓存未命中：0
```

The fixture planner still creates one `speaker_only` scene with no queries, so M3's default documented flow cannot generate any asset candidates.

Required fix:

- Update fixture planning fixtures so at least one scene is `stock_asset` with enabled queries.
- Keep at least one non-stock scene as an overuse guard.
- Add an end-to-end dist CLI smoke test that verifies `project.s2s.json` contains candidates after fixture search.

### P0: Cache stores partial candidates but reads them as full candidates

Files:

- `src/infrastructure/file-search-cache.ts`
- `src/application/search-project-assets.ts`

`SearchCacheEntry.response` is typed as:

```ts
ReadonlyArray<{ id: string; rank: number }>;
```

But `searchProjectAssets` reads that response as `readonly AssetCandidate[]` and pushes it into `scene.search.candidates`. A cache hit can therefore write invalid candidate objects into `project.s2s.json`.

Required fix:

- Cache full normalized `AssetCandidate[]`, or cache raw provider responses separately and remap on read.
- Validate cached candidates with `AssetCandidateSchema` before using them.
- Treat invalid cache as a miss.
- Add a test where a cache hit is saved through the real repository and must pass schema validation.

### P0: Search use case mutates a project but does not own persistence

Files:

- `src/application/search-project-assets.ts`
- `src/cli/commands/search-command.ts`

`searchProjectAssets` mutates the loaded project object in place and the CLI later calls `repository.save`. This splits one transaction across interface and application layers. It also makes `dryRun` misleading: the in-memory project is still mutated even if it is not saved.

Required fix:

- Make `searchProjectAssets` accept a `ProjectRepository` and handle load, mutation, validation, and save internally, or return an immutable updated project plus result for the caller to save through a clearly named application boundary.
- Preserve byte-stability for `--dry-run`.
- Add tests for `dryRun` using real `project.s2s.json` bytes before/after.

### P0: Application layer depends on infrastructure and concrete providers

Files:

- `src/application/ports/search-cache.ts`
- `src/application/search-project-assets.ts`

The application port re-exports types and functions from `../../infrastructure/file-search-cache.js`. `search-project-assets.ts` imports `AssetProviderEnvConfig` from infrastructure and dynamically imports concrete providers.

This violates the repository's architecture rule that application services depend on interfaces, not concrete providers.

Required fix:

- Define `SearchCache` types in `src/application/ports/search-cache.ts`.
- Move `computeProviderCacheKey` policy either into application as pure code or behind the cache interface.
- Move `createAssetProvider` to CLI composition root or infrastructure.
- Application use case should receive an `AssetProvider` and `SearchCache`, not provider names/env.

### P1: Pexels photo `sourcePageUrl` points to an image file, not the Pexels page

File:

- `src/providers/pexels/pexels-asset-provider.ts`

Photo mapping sets:

```ts
sourcePageUrl: photo.src.medium;
```

This is a direct image URL, not the source page. M3 requires original page links for rights review and attribution. Pexels photo response includes `url`, which should be used as `sourcePageUrl`.

Required fix:

- Use `photo.url` as `sourcePageUrl`.
- Keep image URLs for thumbnail/preview fields only.
- Update tests to assert the Pexels page URL.

### P1: Pexels video `thumbnailUrl` uses a video file URL

File:

- `src/providers/pexels/pexels-asset-provider.ts`

Video mapping sets thumbnail to the first `video_files[].link`. Pexels video responses include `image`, which is the preview thumbnail. `thumbnailUrl` should be an image URL; video file URLs belong in `previewUrl` or provider-specific raw cache.

Required fix:

- Use `video.image` as `thumbnailUrl`.
- Use a suitable `video_files` link as `previewUrl`.
- Validate that both are HTTPS.

### P1: Pexels client lacks required timeout, 429 handling, and retry behavior

File:

- `src/providers/pexels/pexels-client.ts`

M3 required finite timeout, 429 classification, and bounded 5xx retry. The current default client makes a single `fetch` call without `AbortController`, retry, or typed status handling. 429 becomes a generic `Error`.

Required fix:

- Add timeout through `AbortController`.
- Create typed errors for 429, auth, 4xx, 5xx, and network failures.
- Retry only bounded 5xx/network errors with bounded backoff.
- Add tests with fake HTTP client behavior.

### P1: `s2s search` cache path is outside the project and not provider-scoped

File:

- `src/cli/commands/search-command.ts`

The cache directory is:

```ts
projectDirectory + ".s2s-cache";
```

M3 specified project-local cache under `cache/search/<provider>/...`. The current path is a sibling of the project directory and can be surprising to clean, package, or ignore.

Required fix:

- Use `<projectRoot>/cache/search/<provider>`.
- Reuse existing path safety rules.
- Add tests that inspect the actual cache location.

### P1: `s2s search` does not implement required CLI surface

File:

- `src/cli/commands/search-command.ts`

M3 planned:

```bash
s2s search <project-directory> [--provider fixture|pexels] [--scene <scene-id>] [--refresh] [--limit <n>] [--json]
```

Current CLI has:

```bash
--max-assets
--force
--dry-run
```

It lacks `--scene`, `--refresh`, `--limit`, and `--json`. `--force` is passed through but not used by the use case. `--dry-run` does not prevent in-memory mutation.

Required fix:

- Align CLI with the M3 plan or update the plan explicitly.
- Prefer the planned surface: `--scene`, `--refresh`, `--limit`, `--json`.
- Add CLI tests using the full `createProgram` path and real project files.

### P1: Search ignores visual decision and enabled query semantics

File:

- `src/application/search-project-assets.ts`

The use case searches every scene with queries. It does not skip non-`stock_asset` scenes, does not filter disabled queries, and hard-codes query language to `"zh"` instead of using the query's language.

Required fix:

- Skip non-stock scenes by default.
- Search only `query.enabled === true`.
- Preserve `query.language`.
- Add tests for all three behaviors.

### P1: Search does not set `lastSearchedAt` or update `project.updatedAt`

File:

- `src/application/search-project-assets.ts`

Candidates are assigned, but `scene.search.lastSearchedAt` is not set and `project.project.updatedAt` is not updated. M3 requires `lastSearchedAt` when candidates exist.

Required fix:

- Set `lastSearchedAt` when a scene receives candidates.
- Update `project.updatedAt` on save.
- Add repository-backed tests.

## Important Gaps

- Provider-returned candidates are not parsed through `AssetCandidateSchema` before being saved.
- Candidate dedupe key omits `mediaType`, so a photo and video with the same provider asset ID can collide.
- Fixture candidate `retrievedAt` uses wall-clock time instead of injected clock, so fixture output is not deterministic.
- Pexels rights mapping overclaims `commercialUse` and `derivatives` without tying evidence to a current verified source in `catalog/sources.yaml`.
- Pexels policy revision says `2025-06`, while current project audit date is 2026-07-14; this needs deliberate verification or a conservative status.
- `PexelsApiError` is defined but never thrown by the client/provider.
- No JSON output for `s2s search`.
- No partial failure summary is returned to the CLI.
- Cache key omits provider policy revision and mapper version.
- Cache write does not fsync file or directory.
- `SearchCommandOptions.maxAssets` is typed as number, but Commander provides option values as strings unless parsed.

## Check Results

Commands run:

```bash
D:\Node\node.exe node_modules\prettier\bin\prettier.cjs --check ...
D:\Node\node.exe node_modules\typescript\bin\tsc -p tsconfig.json
D:\Node\node.exe node_modules\eslint\bin\eslint.js .
D:\Node\node.exe node_modules\typescript\bin\tsc -p tsconfig.build.json
D:\Node\node.exe node_modules\vitest\vitest.mjs run
D:\Node\node.exe dist\cli\index.js --help
```

Results:

- Prettier failed.
- TypeScript failed because `tests/unit/search-project-assets.test.ts` is syntactically corrupted.
- ESLint failed with 30 errors.
- Build passed because tests are excluded.
- Vitest did not start because local `node_modules` is missing `@rolldown/binding-win32-x64-msvc`.
- Built CLI help passed.

Manual smoke:

```bash
node dist/cli/index.js init <tmp> --script <script>
node dist/cli/index.js plan <tmp> --provider fixture --json
node dist/cli/index.js search <tmp> --provider fixture
node dist/cli/index.js status <tmp> --json
```

Result:

- Commands ran.
- Search produced `0` candidates and `0` cache misses because the fixture plan had no stock queries.

## Recommended Fix Order

1. Replace corrupted `tests/unit/search-project-assets.test.ts`.
2. Fix Prettier, TypeScript, and ESLint failures.
3. Refactor application/cache/provider boundaries.
4. Fix cache to store and validate full candidates.
5. Update fixture planner or fixture project so fixture search actually produces candidates.
6. Align `s2s search` CLI with M3 plan.
7. Fix Pexels URL mapping and HTTP error handling.
8. Add repository-backed integration tests for search save/dry-run/cache-hit.
9. Add a dist CLI smoke test for `init -> plan -> search -> status`.
10. Run the full suite in a clean dependency install.

## M4 Readiness Gate

M4 may start only when:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass;
- fixture search writes at least one valid `AssetCandidate` into `project.s2s.json`;
- cache hits cannot write partial candidates;
- `s2s search --dry-run` is byte-stable;
- Pexels mapping uses source page URLs and structured rights evidence;
- no tests use old project shapes or `.s2s/project.json`;
- built CLI smoke passes from `dist`.
