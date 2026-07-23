# Speech-to-Scene Usability and Quality Overhaul

## Goal

Turn the current mixed review/search interface into a beginner-friendly material
workspace that produces a small set of useful, traceable candidates for each
spoken scene.

## Product Principle

The primary workflow is:

```text
paste a script -> AI creates scenes -> real providers find usable media
-> user opens/downloads a candidate or generates an image -> move to next scene
```

The interface must explain the next action without exposing internal enum values,
block IDs, provider implementation details, or test data as production results.

## Audit Findings

The July 23 audit found four release-blocking problems:

1. Creating a project from the web used `force: true` and no project name, so it
   could delete and recreate the `default` project.
2. Fixture candidates were included in production searches and single-scene
   searches defaulted to Fixture.
3. Openverse results were marked commercially reusable and modifiable regardless
   of their actual Creative Commons license.
4. Workspace API keys were stored with broad file permissions, arbitrary
   StepFun base URLs could receive a saved key, and generated-image downloads
   lacked URL, size, type, and timeout controls.

The desktop layout also reserved a nonexistent third column, mobile navigation
hid the scene list and secondary controls, and real assets were mixed with
fourteen external search links.

## Scope

### Data and Security

- Generate a safe unique project directory name in the web create flow.
- Never overwrite an existing project unless a separate destructive flow
  explicitly requests it.
- Delete the named project, not implicitly the active project.
- Save workspace settings with directory mode `0700` and file mode `0600`.
- Accept StepFun and DeepSeek base URLs only on their official HTTPS hosts.
- Restrict generated-image downloads to HTTPS, reject private/local hosts,
  enforce timeout and byte limits, validate image MIME and magic bytes, and
  write atomically.

### Material Quality

- Fixture is explicit demo/test mode only.
- Production search resolves all configured real providers and always keeps
  Openverse as the no-key fallback.
- Map Openverse licenses accurately. Apply project commercial-use and
  modification policy before a candidate reaches the project.
- Score candidates deterministically by rights confidence, orientation,
  resolution, preview availability, and provider rank.
- Keep at most twelve real candidates per scene.
- Preserve external platform search links as a separate, collapsed list. They
  are not counted or presented as usable media.

### StepFun

- Keep `step-3.7-flash` configurable and do not log or return its key.
- Give the planner block text with block IDs, mark script content as untrusted
  data, and require concrete provider-ready queries.
- Generate English stock-library queries and Chinese platform queries with a
  subject, action, environment, and shot description.
- Build a bounded, production-oriented image prompt with subject, action,
  environment, composition, subtitle-safe area, lighting, visual continuity,
  and negative constraints.
- Enforce the image API prompt limit and correct StepFun's height-by-width size
  mapping.

### Beginner Interface

- Use a two-column desktop workspace: scene navigation and one focused scene.
- On narrow screens, show a scene selector plus previous/next controls.
- Put the script excerpt and usable candidates first.
- Put AI reasoning and queries in a collapsed details panel.
- Show real assets, AI-generated assets, and external search shortcuts in
  separate sections.
- Use plain Chinese labels and action-oriented empty/error states.
- Make Settings a connection-status experience. Show StepFun as the recommended
  AI connection and move model identifiers into advanced settings.
- Style the project list, new-project screen, dialogs, loading states, buttons,
  focus states, and mobile layout as one coherent system.
- Never claim that generated images have no copyright restrictions.

## Non-Goals

- Video rendering, timeline editing, ASR, cloud accounts, or a database.
- Scraping platforms that do not provide a supported API.
- Automatically downloading third-party library assets where provider terms
  require the user to visit the source page.
- Treating a search link as a verified or licensed asset.
- Sending full scripts, API keys, local paths, or hidden reasoning to logs.

## Error Handling

User-facing errors answer three questions: what failed, whether current work was
kept, and what the user can do next. Raw exceptions, absolute paths, API keys,
tokens, and provider response bodies remain server-side.

## Verification

- Unit tests cover destructive project actions, provider resolution, license
  policy, ranking and limits, prompt builders, StepFun dimensions, secure
  downloads, settings permissions, and the redesigned UI.
- Existing API, security, CLI, and domain tests remain green.
- `format:check`, lint, typecheck, all tests, backend/frontend builds, and dist
  smoke pass.
- Playwright screenshots at 1440x900 and 390x844 show no blank column,
  clipped header, hidden navigation, or overlapping controls.
