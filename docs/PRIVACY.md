# Privacy

Speech-to-Scene is local-first. Project files, scripts, imported assets, caches, and logs remain on the user's machine unless the user explicitly invokes an external provider.

Using an LLM or asset-search provider sends the minimum required query data to that provider under its own privacy policy and terms. API keys, complete environment dumps, full scripts, absolute local paths, uploaded file contents, and hidden model reasoning must not appear in normal logs.

The review service will bind to loopback by default. M4 must add Host and Origin validation, a write-request token, restrictive CORS and CSP, request-size limits, path confinement, and SSRF/DNS-rebinding protections.
