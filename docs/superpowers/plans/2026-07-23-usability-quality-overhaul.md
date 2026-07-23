# Speech-to-Scene Usability and Quality Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe, beginner-friendly material workspace with useful real-provider results and stronger StepFun planning and image generation.

**Architecture:** Preserve the Domain/Application/Infrastructure/HTTP/React boundaries. Fix safety and provider truth at the backend, keep deterministic quality ranking in the application layer, and make the React layer present the resulting workflow without duplicating business rules.

**Tech Stack:** TypeScript 6, Node.js 24, Zod 4, React 19, Vite 8, Vitest, Testing Library, Playwright CLI.

---

### Task 1: Project and settings safety

**Files:**

- Modify: `web/src/App.tsx`
- Modify: `web/src/components/LandingView.tsx`
- Modify: `web/src/api/review-api.ts`
- Modify: `src/review/router.ts`
- Modify: `src/application/delete-project.ts`
- Modify: `src/infrastructure/settings-store.ts`
- Test: `tests/unit/api-project-lifecycle.test.ts`
- Test: `tests/unit/delete-project.test.ts`
- Test: `tests/unit/settings-store.test.ts`
- Test: `tests/unit/web/app-actions.test.tsx`

- [ ] Add failing tests proving web creation sends a unique project name with
      `force: false`, named deletion targets that project, and settings files are
      private.
- [ ] Run the focused tests and confirm the intended failures.
- [ ] Implement safe naming, named deletion, official-host base URL validation,
      and private settings permissions.
- [ ] Run focused tests until green.
- [ ] Commit the safety slice.

### Task 2: Real provider truth and candidate quality

**Files:**

- Modify: `src/cli/provider-factory.ts`
- Modify: `src/application/search-scene-assets.ts`
- Modify: `src/application/search-project-assets.ts`
- Modify: `src/providers/openverse/openverse-asset-provider.ts`
- Test: `tests/unit/search-project-assets.test.ts`
- Create: `tests/unit/openverse-asset-provider.test.ts`
- Modify: `tests/unit/api-scene-search.test.ts`

- [ ] Add failing tests proving Fixture is never implicit when real search is
      available, restrictive Openverse licenses are mapped and filtered, results
      are quality-ranked, and real assets are capped at twelve per scene.
- [ ] Run focused tests and confirm the intended failures.
- [ ] Implement unified provider resolution, license mapping/policy filtering,
      deterministic scoring, provider diversity, and result limits.
- [ ] Run focused tests until green.
- [ ] Commit the material-quality slice.

### Task 3: StepFun prompt and image hardening

**Files:**

- Modify: `src/planner/stepfun-script-planner.ts`
- Modify: `src/application/generate-scene-image.ts`
- Modify: `src/providers/stepfun/stepfun-image-generator.ts`
- Modify: `src/infrastructure/fs-generated-image-downloader.ts`
- Modify: `src/review/router.ts`
- Test: `tests/unit/stepfun-planner.test.ts`
- Test: `tests/unit/generate-scene-image.test.ts`
- Test: `tests/unit/stepfun-image-generator.test.ts`
- Create: `tests/unit/fs-generated-image-downloader.test.ts`

- [ ] Add failing tests for block text isolation, provider-ready query guidance,
      professional bounded image prompts, 512-character validation, correct
      height-by-width sizes, and secure bounded image downloads.
- [ ] Run focused tests and confirm the intended failures.
- [ ] Implement the prompt compilers, StepFun size correction, response checks,
      and downloader controls.
- [ ] Run focused tests until green.
- [ ] Commit the StepFun slice.

### Task 4: Beginner-focused React workflow

**Files:**

- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`
- Modify: `web/src/components/LandingView.tsx`
- Modify: `web/src/components/ProjectListView.tsx`
- Modify: `web/src/components/SceneList.tsx`
- Modify: `web/src/components/SceneDetail.tsx`
- Modify: `web/src/components/CandidateGrid.tsx`
- Modify: `web/src/components/CandidateCard.tsx`
- Modify: `web/src/components/SettingsPanel.tsx`
- Modify: `web/src/styles.css`
- Test: `tests/unit/web/app-actions.test.tsx`
- Test: `tests/unit/web/scene-detail-actions.test.tsx`
- Test: `tests/unit/web/candidate-grid.test.tsx`
- Test: `tests/unit/web/project-list-view.test.tsx`
- Test: `tests/unit/web/topbar.test.tsx`

- [ ] Add failing component tests for real/link separation, collapsed AI details,
      clear next actions, project-safe create, scene reset on project switch, and
      mobile scene controls.
- [ ] Run focused tests and confirm the intended failures.
- [ ] Implement the two-column workspace, simplified content hierarchy,
      connection-oriented settings, complete project-list styling, and responsive
      navigation.
- [ ] Run focused tests until green.
- [ ] Commit the UI slice.

### Task 5: Documentation, visual verification, and release

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/development/AI_TASK_AND_AUDIT_PLAYBOOK.md`
- Modify: `docs/PRIVACY.md`
- Modify: `docs/governance/SECURITY.md`

- [ ] Update the source-of-truth documents to match current AI generation,
      multi-project, provider, security, and UI behavior.
- [ ] Run Prettier over the repository to repair the inherited 47-file format
      drift, then inspect the diff for semantic changes.
- [ ] Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm build:all`, and `pnpm test:dist-smoke`.
- [ ] Start a local review server and capture 1440x900 and 390x844 Playwright
      screenshots after waiting for the workspace to render.
- [ ] Run a secret scan and inspect `git diff --check` plus `git status`.
- [ ] Request an independent final code review and resolve all important issues.
- [ ] Merge the feature branch into `main` and push `origin/main`.
