# Privacy

Speech-to-Scene is local-first. Project files, scripts, imported assets, caches, and logs remain on the user's machine unless the user explicitly invokes an external provider.

## Local Review Server (M4–M5)

The review server is a local loopback HTTP server that binds to `127.0.0.1` by default. It does not upload project files, scripts, or uploaded assets to any cloud service.

Since M5-03, the review server also serves the built React Review Board UI directly from `web/dist`. The UI is a static SPA — all HTML, JS, and CSS are served from the local filesystem over loopback. No UI assets are fetched from any external CDN or cloud service.

### What stays local

- `project.s2s.json` — the project file
- `script.md` — the source script
- `assets/<scene-id>/` — uploaded local assets (images, videos)
- `cache/search/` — search cache files
- `web/dist/` — built React Review Board UI (static files served by the review server)
- `.s2s/settings.json` — local provider settings; secret fields are never returned by the API

### What may be sent to third parties

- When using StepFun or DeepSeek planning, the selected LLM receives the source script and planning preferences under its own privacy policy and terms.
- Asset providers receive only generated search queries and search parameters.
- StepFun image generation receives the user-reviewed image prompt and aspect ratio.
- API keys, complete environment dumps, full scripts, absolute local paths, uploaded file contents, and hidden model reasoning must not appear in normal logs.
- The React Review Board loads provider candidate thumbnails over HTTPS. The `Referrer-Policy: no-referrer` header prevents the local page URL from being sent to those hosts.
- Generated images are validated and copied into the current project so temporary provider URLs are not required after generation.

### Error responses

- Error responses and logs do not include: API keys, absolute filesystem paths, stack traces, or raw provider API responses.
- The `GET /api/health` endpoint returns only local diagnostics needed by the UI.

### Local asset uploads

- Uploaded files are saved to `assets/<scene-id>/` within the project directory.
- File content is not transmitted to any external service.
- Only the file's relative path, SHA-256 hash, size, MIME type, and provenance are persisted in `project.s2s.json`.

### What should not be committed to Git

- `.env` files (only `.env.example` is tracked)
- `project.s2s.json` (user project data)
- `assets/` contents (uploaded media)
- `cache/` contents (search cache)
- `logs/`
- `dist/` (backend build output)
- `web/dist/` (frontend build output)
- `node_modules/`
- `coverage/`

The `.gitignore` file enforces these exclusions.
