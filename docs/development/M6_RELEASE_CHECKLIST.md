# M6 Release Checklist

This checklist captures the Phase 1 Demo release gate for Speech-to-Scene.

## Completed capabilities

- Markdown/TXT project initialization with persisted `project.s2s.json`.
- Fixture planner for deterministic local and CI runs.
- DeepSeek planner boundary.
- StepFun planner boundary using OpenAI-compatible `step-3.7-flash`.
- Fixture and Pexels asset search providers.
- Local Review Server with token-gated project API.
- React Review Board served by `s2s review` from `web/dist`.
- Scene update, query update, search, decision, skip, and local upload APIs.
- PNG/JPEG local upload with MIME, extension, and magic-byte allowlist.
- `s2s validate` release-readiness checks.
- Enhanced `s2s status` with review progress and validation summary.

## Non-goals

Phase 1 does not include:

- video rendering;
- ASR;
- timeline alignment;
- live recording;
- AI image/video generation;
- automatic third-party media downloads;
- cloud accounts;
- databases;
- mobile apps.

## Local smoke flow

Use fixture providers for deterministic smoke:

```bash
tmpdir=$(mktemp -d)
cat > "$tmpdir/script.md" <<'EOF'
# Demo

我们用一个本地优先的工具，把口播稿拆成可审核的视觉场景。
EOF

pnpm s2s init "$tmpdir/demo" --script "$tmpdir/script.md"
pnpm s2s plan "$tmpdir/demo" --provider fixture
pnpm s2s search "$tmpdir/demo" --provider fixture
pnpm s2s status "$tmpdir/demo"
pnpm s2s validate "$tmpdir/demo"
pnpm build:all
pnpm test:dist-smoke
rm -rf "$tmpdir"
```

Optional live StepFun smoke may be run only when `STEP_API_KEY` exists in a local ignored `.env` file or protected shell environment. Do not print `.env` or raw provider responses.

## Required checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm web:build
pnpm build:all
pnpm test:dist-smoke
pnpm s2s --help
pnpm s2s plan --help
pnpm s2s status --help
pnpm s2s validate --help
```

## Secret scan

Before commit and push:

```bash
git status --short
git ls-files --others --exclude-standard
rg "STEP_API_KEY|STEP_BASE_URL|STEP_MODEL|step-3.7-flash|api.stepfun" .
```

Also scan locally for the real StepFun key without printing it in reports. The expected result is no tracked-file match.

## Safety checks

- `.env` and `.env.*` are ignored by Git.
- `.env.example` contains only placeholders and non-secret defaults.
- No session token, API key, uploaded asset, cache file, smoke temp project, or log file is committed.
- Error messages do not expose stack traces, absolute paths, Authorization headers, or raw provider responses.

## Release note template

```text
Phase 1 Demo ready:
- local-first script-to-scene planning
- review board and local review API
- fixture/deepseek/stepfun planner boundaries
- fixture/pexels asset search boundaries
- local upload and validation/status release checks
```
