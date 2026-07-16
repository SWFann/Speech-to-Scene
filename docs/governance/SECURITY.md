# Security Policy

## Reporting vulnerabilities

Please report suspected vulnerabilities privately through GitHub's security advisory feature rather than a public issue.

Never include API keys, private scripts, local paths, downloaded user assets, or other sensitive data in a report. Include the affected version, impact, and minimal reproduction steps.

Only the latest development version is supported before the first public release.

## Local Server Security Model (M4–M5)

### Loopback binding

The review server binds to `127.0.0.1` by default. Non-loopback hosts are rejected at startup unless the user explicitly passes `--host <host>`.

### Host validation

All incoming requests are validated against the configured `Host` header before route matching. This prevents DNS rebinding attacks where a malicious website resolves to `127.0.0.1` and sends requests to the local server.

### Origin validation

Mutating requests (POST, PUT, PATCH) must include an `Origin` header that matches the local server origin (`http://127.0.0.1:<port>`). Requests without an `Origin` header from non-browser clients (e.g., `curl`) are also accepted. This prevents CSRF attacks from browser-based origins.

### Session token

- A random session token is generated at server startup and printed to the terminal.
- All mutating routes require the `X-S2S-Session: <token>` header.
- `GET /api/project` is token-gated (requires the token even though it is a GET).
- `GET /api/health` does not require a token. It may return local diagnostics such as `projectRoot`, `host`, `port`, and `version`, but it never returns the session token, full project document, source script content, candidates, or uploaded file contents.
- The token is never included in error responses or the `/api/health` payload.

### Security headers

API responses include:

- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cache-Control: no-store`

Static file responses (M5-03) include a different CSP that allows the React SPA to function:

- `Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer` (prevents leaking `?token=` in the URL to third-party thumbnail hosts)
- `Cache-Control: no-store` for HTML files; `public, max-age=31536000, immutable` for hashed assets

For `405 Method Not Allowed` responses, an `Allow` header is included.

### Request limits

- JSON body size limit: 1 MiB (1048576 bytes)
- Multipart upload size limit: 10 MiB (10485760 bytes), enforced by `src/review/multipart-upload.ts`
- Request timeout: 30 seconds
- Headers timeout: 15 seconds
- Keep-alive timeout: 5 seconds

### Local upload allowlist (M4)

The `POST /api/scenes/:sceneId/local-asset` endpoint enforces a three-layer allowlist:

1. **Magic bytes**: The file content is inspected for PNG (`89 50 4E 47`) or JPEG (`FF D8 FF`) signatures.
2. **Content-Type**: The multipart part's `Content-Type` must match the magic byte detection (`image/png` or `image/jpeg`).
3. **Filename extension**: The original filename's extension must be `.png`, `.jpg`, or `.jpeg`, and must agree with the magic byte detection.

Unsupported types:

- **SVG is not allowed** (no magic byte validation for SVG; could contain scripts).
- **WebP, MP4, WebM, MOV** are not allowed in M4 (magic byte validation not yet implemented).
- Unknown multipart fields are rejected (only `file`, `provenance`, and `note` are accepted).

### Path traversal protection

**Upload path traversal (M4):**

- Filenames are server-generated (16-byte random hex + validated extension).
- Client-provided filenames are stored in `originalFileName` for display only.
- The `assets/<scene-id>/` directory is resolved server-side.
- Symlink escapes are rejected by the asset writer.
- The `relativePath` in the persisted project is always project-relative, never absolute.

**Static serving path traversal (M5-03):**

- Raw URL path must not contain `..` (catches literal traversal).
- Decoded URL path must not contain `..` (catches `%2e%2e` encoded traversal).
- Decoded URL path must not contain NUL or control characters.
- Resolved path must remain within the static root (`path.resolve` boundary check).
- Symlink escapes are rejected via `fs.realpath` (defense-in-depth).
- If any check fails, the request is rejected with `400 invalid_request`.

### Static file serving (M5-03)

Since M5-03, the review server serves the built React Review Board from `web/dist` directly, without requiring a separate Vite dev server.

**API priority:**

- `/api/*` paths are NEVER handled by static serving.
- API route matching runs first; only unmatched non-API paths fall through to static serving.
- API 404/405/400 responses are unchanged.

**SPA fallback:**

- Non-API GET paths without a file extension fall back to `index.html` (client-side routing).
- Paths with a file extension that don't exist return 404 (not index.html).
- Only GET and HEAD methods are handled by static serving.

**Missing build:**

- If `web/dist/index.html` does not exist, `GET /` returns a 503 HTML page telling the user to run `pnpm web:build`.
- The error page never includes absolute paths or sensitive information.
- API endpoints remain fully functional.

**MIME types:**

- File extensions are mapped to Content-Type values via a fixed allowlist.
- Unknown extensions default to `application/octet-stream`.
- `X-Content-Type-Options: nosniff` is always set.

### Error handling

- Stack traces are never returned to clients.
- Absolute filesystem paths are never included in error responses.
- Raw provider API responses are never stored or returned.
- The `X-S2S-Session` token is never included in error messages.

## API key handling

Planner and asset-provider API keys are local runtime secrets.

- Store real keys only in ignored `.env` files or shell environment variables.
- `.env.example` may document variable names and default non-secret base URLs/models, but must never contain real keys.
- Do not commit `.env`, cache directories, logs, smoke temporary projects, uploaded assets, screenshots that reveal tokens, or terminal transcripts containing secrets.
- Error handling must not include API keys, Authorization headers, raw request bodies, full provider responses, or stack traces in user-facing output.
- CI and deterministic smoke flows should use `fixture` providers unless a protected secret store is explicitly configured.
