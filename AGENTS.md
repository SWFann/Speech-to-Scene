# Speech-to-Scene Repository Instructions

## Product scope

Speech-to-Scene is a local-first tool that turns a spoken-video script into
semantic scenes, useful material candidates, and optional AI-generated images:

```text
script -> semantic scenes -> ranked real assets / platform search links
       -> local Review Board -> local generated or user-provided media
```

Rendering, ASR, timeline alignment, cloud accounts, databases, and mobile apps
remain out of scope. AI image generation and the React Review Board are current
product capabilities, not future placeholders.

## Sources of truth

Read before architectural changes:

1. `docs/development/AI_TASK_AND_AUDIT_PLAYBOOK.md`
2. `docs/PROJECT_SCHEMA.md`
3. `docs/VISUAL_GRAMMAR.md`
4. `docs/ASSET_LICENSING.md`
5. `docs/governance/SECURITY.md`

The Zod project schema is the source of truth for persisted project data.

## Architecture boundaries

- Domain must not import filesystem, HTTP, React, model SDKs, or provider code.
- Application services depend on ports; composition roots bind providers.
- Every external input remains `unknown` until schema validation.
- React calls local APIs and never accesses the filesystem directly.
- Project writes use the repository and atomic-write implementation.
- Unit tests never call real external services.
- Search links are suggestions, not usable material candidates.
- Fixture providers are explicit test/demo tools and must not be production defaults.

## Security and licensing

- Never commit or print API keys, `.env`, local settings, user projects, media, caches, or logs.
- Provider base URLs carrying credentials must remain restricted to official HTTPS endpoints.
- Generated-image downloads must reject local/private network targets and validate size, MIME, and magic bytes.
- Treat code licensing and each third-party asset license as separate concerns.
- Never claim that AI output is automatically copyright-free.

## Required checks

Before completing an implementation task, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build:all
pnpm test:dist-smoke
```

Report any check that could not run. Do not claim success without evidence.
