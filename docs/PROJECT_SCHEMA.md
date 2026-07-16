# Project Schema

Status: the executable Zod schema is implemented and frozen through M4.

The persisted project filename is `project.s2s.json`. The schema must remain independent from the CLI, web UI, LLM SDKs, asset-provider SDKs, and filesystem implementation.

The schema is defined in:

- `src/domain/project-schema.ts` — top-level `SpeechToSceneProjectSchema`
- `src/domain/scene-schema.ts` — scene, search, review decision, and local asset schemas
- `src/domain/asset-schema.ts` — asset candidate, rights, and provider snapshot schemas
- `src/domain/schema-primitives.ts` — reusable primitive schemas (Id, URL, datetime, etc.)

## Review Decision

Each scene has a `review` field that is a discriminated union (`ReviewDecisionSchema`):

| kind                   | description                          | key fields                                                               |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `pending`              | Not yet reviewed                     | optional `note`                                                          |
| `skipped`              | User chose to skip                   | `decidedAt`, optional `note`                                             |
| `candidate_selected`   | User selected a candidate            | `selection` (immutable snapshot), optional `localAsset`, optional `note` |
| `local_asset_attached` | User attached a local asset directly | `localAsset`, optional `note`                                            |

### Review state transitions (M4)

- `pending` → `skipped` via `PUT /api/scenes/:sceneId/skip`
- `pending` → `candidate_selected` via `PUT /api/scenes/:sceneId/selection`
- `candidate_selected` → `candidate_selected` (with `localAsset`) via `POST /api/scenes/:sceneId/local-asset` when `provenance.kind === "selected_candidate"` and the candidateId matches the existing selection
- any → `local_asset_attached` via `POST /api/scenes/:sceneId/local-asset` when provenance is `user_owned` or `external`
- `search.candidates` are always preserved — never cleared by review mutations

## LocalAsset

When a user uploads a local image via `POST /api/scenes/:sceneId/local-asset`, a `LocalAsset` record is created:

| field              | type                | description                                                                                                    |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `relativePath`     | string              | Project-relative path, must match `assets/<scene-id>/<filename>`. Never an absolute path.                      |
| `originalFileName` | string              | Client-provided filename (sanitized via safeFileName). Used for display only, never for filesystem operations. |
| `mimeType`         | string              | Must start with `image/` or `video/`. M4 allows `image/png` and `image/jpeg` only.                             |
| `sizeBytes`        | positive integer    | File size in bytes.                                                                                            |
| `sha256`           | string (64 hex)     | SHA-256 hash of the file content.                                                                              |
| `importedAt`       | UTC datetime        | Timestamp of import (server time).                                                                             |
| `provenance`       | discriminated union | Origin of the asset (see below).                                                                               |

### relativePath constraints

- Must be project-relative, e.g. `assets/scene-001/abc123.png`.
- Must never contain an absolute filesystem path.
- The filename component is always server-generated (16-byte random hex + validated extension).
- The client-provided filename is only stored in `originalFileName` and never used for path construction.

### selected_candidate provenance matching

When `provenance.kind === "selected_candidate"`:

- `provenance.candidateId` must equal `scene.review.selection.candidate.id` (the current selection).
- The `attachLocalAsset` use case performs a pre-flight conflict check BEFORE writing any file to disk, so a mismatch returns `409 conflict` without creating an orphan file.
- On success, the `localAsset` is added to the existing `candidate_selected` review (the selection snapshot is preserved).

## Provenance

The `provenance` field on a `LocalAsset` is a discriminated union:

| kind                 | description                                | key fields                                                                 |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `selected_candidate` | Asset downloaded from a selected candidate | `candidateId` (must match current selection)                               |
| `user_owned`         | Asset provided by the user                 | optional `note`                                                            |
| `external`           | Asset imported from an external source     | `sourcePageUrl` (optional), `rights` (full `AssetRights`), optional `note` |

When no `provenance` is provided in the upload request, the default is `{"kind":"user_owned"}`.

## Schema as single source of truth

The Zod project schema is the single source of truth for persisted project data. Application use cases:

1. Load project via `repository.load()`.
2. Deep-clone before mutation.
3. Apply the mutation on the clone.
4. Update `project.updatedAt`.
5. Re-validate the full project with `SpeechToSceneProjectSchema`.
6. Save through `repository.save()`.

The HTTP layer never directly reads or writes `project.s2s.json`. It delegates to application use cases that follow this pattern.
