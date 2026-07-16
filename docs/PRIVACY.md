# Privacy

Speech-to-Scene is local-first. Project files, scripts, imported assets, caches, and logs remain on the user's machine unless the user explicitly invokes an external provider.

## Local Review Server (M4)

The review server is a local loopback HTTP server that binds to `127.0.0.1` by default. It does not upload project files, scripts, or uploaded assets to any cloud service.

### What stays local

- `project.s2s.json` — the project file
- `script.md` — the source script
- `assets/<scene-id>/` — uploaded local assets (images, videos)
- `cache/search/` — search cache files
- Session token — generated at server startup, printed to terminal, never sent over the network to third parties

### What may be sent to third parties

- When using `s2s plan` with DeepSeek (or `POST /api/scenes/:sceneId/search` with `provider: "pexels"`), the LLM or asset-search provider receives the minimum required query data under its own privacy policy and terms.
- API keys, complete environment dumps, full scripts, absolute local paths, uploaded file contents, and hidden model reasoning must not appear in normal logs.

### Error responses

- Error responses and logs do not include: API keys, session tokens, absolute filesystem paths, stack traces, or raw provider API responses.
- The `GET /api/health` endpoint returns the project root path (for local CLI use), but does not include the session token.

### Local asset uploads

- Uploaded files are saved to `assets/<scene-id>/` within the project directory.
- File content is not transmitted to any external service.
- Only the file's relative path, SHA-256 hash, size, MIME type, and provenance are persisted in `project.s2s.json`.

### What should not be committed to Git

- Session tokens
- `.env` files (only `.env.example` is tracked)
- `project.s2s.json` (user project data)
- `assets/` contents (uploaded media)
- `cache/` contents (search cache)
- `logs/`
- `dist/` (build output)
- `node_modules/`
- `coverage/`

The `.gitignore` file enforces these exclusions.
