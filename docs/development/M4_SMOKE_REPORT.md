# M4 Smoke Flow Report

> Created: 2026-07-16
> Environment: Linux 6.18, Node.js v24, pnpm 11.7.0
> Working directory: <project-root>

## Objective

Verify the full M4 local Review Server lifecycle end-to-end using the fixture provider.

## Steps and Output

### 1. Create temporary project directory

```bash
SMOKE_DIR=$(mktemp -d /tmp/s2s-m4-smoke-XXXXXX)
SCRIPT_DIR=$(mktemp -d /tmp/s2s-m4-script-XXXXXX)
# Write a minimal Markdown script to $SCRIPT_DIR/script.md
```

### 2. init

```bash
pnpm s2s init "$SMOKE_DIR" --script "$SCRIPT_DIR/script.md" --title "M4 Smoke Test"
```

Output:

```text
✓ 已创建项目：M4 Smoke Test
✓ 已复制文稿：script.md
✓ 已写入项目文件：project.s2s.json
状态：created（运行 `s2s plan` 开始规划）
```

### 3. plan fixture

```bash
pnpm s2s plan "$SMOKE_DIR" --provider fixture
```

Output:

```text
项目：M4 Smoke Test
状态：planned
场景数：1
提供商：fixture
提示词版本：plan-script-v1
项目路径：/tmp/s2s-m4-smoke-XXXXXX
```

### 4. search fixture

```bash
pnpm s2s search "$SMOKE_DIR" --provider fixture
```

Output:

```text
项目：project-1208df28-29b6-4b7c-9a65-1d30ed7c5ad9
状态：searched
场景数：1
候选素材数：1
缓存命中：0
缓存未命中：2
```

### 5. Start review server

```bash
pnpm s2s review "$SMOKE_DIR" --no-open --port 32108 --token "<redacted>"
```

Output:

```text
Review server started:
  Project: /tmp/s2s-m4-smoke-XXXXXX
  URL:     http://127.0.0.1:32108
  Token:   <redacted>
  Press Ctrl+C to stop
```

### 6. GET /api/health

```bash
curl -s http://127.0.0.1:32108/api/health
```

Output:

```json
{
  "ok": true,
  "projectRoot": "/tmp/s2s-m4-smoke-XXXXXX",
  "host": "127.0.0.1",
  "port": 32108,
  "version": "s2s-review-server/0.1"
}
```

### 7. GET /api/project (with session token)

```bash
curl -s -H "X-S2S-Session: <redacted>" http://127.0.0.1:32108/api/project
```

Summary output:

```text
ok: true
scene_id: scene-04f6e5e3-de80-4fd4-97a3-43dd76d2b5af
review_kind: pending
candidate_count: 1
candidates: ['fixture-q-scene-...-0-photo-1']
```

### 8. Mutating API: PUT /api/scenes/:sceneId/skip

```bash
curl -s -X PUT \
  -H "X-S2S-Session: <redacted>" \
  -H "Content-Type: application/json" \
  -H "Origin: http://127.0.0.1:32108" \
  -d '{"note":"Skipped in smoke test"}' \
  http://127.0.0.1:32108/api/scenes/scene-.../skip
```

Output:

```text
ok: True
review_kind: skipped
review_note: Skipped in smoke test
decidedAt: 2026-07-16T09:50:32.487Z
```

### 8b. Mutating API: POST /api/scenes/:sceneId/local-asset

Generated a minimal 67-byte PNG in a temp file and uploaded via multipart:

```bash
curl -s -X POST \
  -H "X-S2S-Session: <redacted>" \
  -H "Origin: http://127.0.0.1:32108" \
  -F "file=@/tmp/s2s-smoke-png-XXXXXX.png;type=image/png" \
  http://127.0.0.1:32108/api/scenes/scene-.../local-asset
```

Output:

```text
ok: True
review_kind: local_asset_attached
relativePath: assets/scene-04f6e5e3-.../af4e0a4ffb95d997b855adc186ad0911.png
mimeType: image/png
sha256: ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a
sizeBytes: 67
provenance: user_owned
```

### 9. Verify persistence via GET /api/project

```bash
curl -s -H "X-S2S-Session: <redacted>" http://127.0.0.1:32108/api/project
```

Confirmed:

- `review_kind` = `local_asset_attached`
- `localAsset.relativePath` = `assets/scene-.../af4e0a4f...png`
- `localAsset.sizeBytes` = 67
- File exists on disk at `<project>/assets/<scene-id>/af4e0a4f...png`

### 10. Graceful shutdown

Sent `SIGINT` to the review server process. After 2 seconds:

```bash
curl -s --connect-timeout 2 http://127.0.0.1:32108/api/health
# exit_code=7 (connection refused)
```

Server stopped cleanly.

### 11. Cleanup

All temporary directories and test PNG files were removed after the smoke flow. No artifacts entered the Git repository.

## Token handling

- The session token was provided via `--token` for deterministic testing.
- In normal usage, the server generates a random token and prints it to stdout.
- The token is never included in `GET /api/health` responses.
- In this report, the token is redacted as `<redacted>`.

## Port handling

- `--port 32108` was used to avoid conflicts with default port 3210.
- `--port 0` can be used for OS-assigned ports (used in automated tests).
