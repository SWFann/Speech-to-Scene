# S2S UI Design Guidelines

Status: draft for Phase 1 review board.

This guide defines the visual and interaction direction for Speech-to-Scene UI work. It is intentionally narrow: design the local review board for script-to-scene-to-assets workflows, not a video editor, cloud dashboard, timeline renderer, or media-generation studio.

## Product Position

Speech-to-Scene is a local-first decision workspace for talking-head creators. Its interface should help the user answer four questions quickly:

1. Does this semantic scene need visual support?
2. If yes, what concrete visual subject should be searched?
3. Which candidate is useful, traceable, and appropriately licensed?
4. Has the manually downloaded local asset been attached to the right scene?

The UI should feel quiet, precise, and trustworthy. It should resemble a professional review console more than a marketing site.

## Reference Direction

- Apple Human Interface Guidelines: clarity, restraint, direct manipulation, and high confidence interactions.
- Microsoft Fluent 2: modern component rhythm, clean density, careful focus states, and adaptable patterns.
- Amazon Cloudscape: operational UI for complex workflows, accessible React components, responsive behavior, and task-oriented patterns.
- NVIDIA professional product surfaces: technical confidence, strong contrast, and restrained use of accent color.

These are references, not skins. Do not copy brand assets, logos, proprietary illustrations, or exact layouts.

## Core Layout

Use a three-column review board on desktop:

1. Left: semantic scene list.
2. Center: selected scene, source excerpt, editable search query, candidate grid.
3. Right: selected candidate evidence, rights snapshot, local attachment status.

On medium screens, hide or collapse the evidence inspector. On small screens, show one column at a time with scene navigation above the workspace.

Do not make a landing page for the review UI. The first screen is the working surface.

## Visual Principles

- Minimal, not empty: every visible element should support review, comparison, selection, attribution, or validation.
- Evidence first: candidate cards must show source, creator, rights status, and original page access near the visual.
- Human-in-the-loop: AI recommendations should be presented as suggestions, never final decisions.
- Concrete over abstract: prefer labels like `creator desk`, `manual download`, `license snapshot` over generic AI language.
- Local-first: use language and affordances that reinforce local project files and manual asset attachment.

## Color

Use a neutral base with a small set of semantic accents:

- Background: `#f7f7f4`
- Surface: `#ffffff`
- Subtle surface: `#fbfbf8`
- Text: `#1d1f24`
- Muted text: `#606874`
- Border: `#deded8`
- Primary action: `#1d1f24`
- Focus and selected state: `#2563eb`
- Safe or completed: `#0f7a5f`
- Warning or review-needed: `#a45f00`
- Error or blocked: `#b42318`

Avoid dominant purple gradients, dark-blue dashboards, beige-only editorial themes, decorative glow backgrounds, or ornamental blobs. Use accent color for state and focus, not decoration.

## Typography

Use system UI fonts:

```css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Guidelines:

- Base size: 14px.
- Compact labels: 11-12px.
- Section titles: 13-15px.
- Avoid hero-scale type inside the app.
- Letter spacing stays at 0.
- Do not scale type with viewport width.

## Spacing And Shape

- Base spacing unit: 4px.
- Common gaps: 8px, 12px, 16px, 24px.
- Border radius: 7-8px for panels, controls, and candidate cards.
- Candidate thumbnails should use stable aspect ratios.
- Toolbars and rows should have fixed heights where possible to prevent layout shift.
- Do not nest cards inside cards. Use cards only for repeated candidates, modal dialogs, or genuinely framed tools.

## Components

Scene list:

- Show scene number, semantic title, source summary, and derived status.
- Use status chips for `speaker_only`, `needs_asset`, `selected`, `skipped`, and `local_attached`.
- The active scene should be visually clear without relying only on color.

Scene workspace:

- Always show the original source excerpt for the current scene.
- Search terms are editable in-place.
- "Research", "Skip scene", "Open source page", "Attach local file", and "Save decision" are primary workflow actions.

Candidate cards:

- Show thumbnail, media type, concise rationale, creator, source, and rights badges.
- Selected cards use a blue outline and a clear selected badge.
- Warnings should appear inline, not hidden in hover-only UI.

Evidence inspector:

- Show candidate ID, provider, creator, source page, provider terms, retrieved time, rights status, commercial use, derivatives, and attribution requirement.
- Include a copyable attribution text area once implemented.
- Include a local asset attachment state and import affordance.

## Interaction Rules

- Every write action must be explicit and should map to a repository/API operation.
- Do not auto-download third-party assets.
- Opening remote pages should be a deliberate action.
- Editing a search query should not erase previous selected evidence unless the user confirms a replacement.
- Validation should explain missing decisions, missing source evidence, and missing local files in plain language.
- Empty states should tell the user what is missing and which command or action fixes it.

## Accessibility

- All interactive controls need visible focus states.
- Do not communicate status with color alone.
- Maintain WCAG AA contrast for text and controls.
- Candidate thumbnails need meaningful alternative text when real media is rendered.
- Keyboard users must be able to move through scene list, candidates, and inspector actions in a predictable order.
- Avoid hover-only information for licensing, attribution, or warnings.

## Content Tone

Use concise, operational Chinese. The UI should sound like a calm assistant in a review room:

- Good: `已选择`, `需要原页复核`, `导入本地文件`, `检索时许可快照`
- Avoid: `一键生成大片`, `智能神图`, `版权无忧`, `自动帮你搞定`

Never claim legal safety. Say the tool records evidence and the user should review the original page before publishing.

## Phase 1 Boundaries

The UI must not include:

- Timeline editing.
- Video rendering controls.
- ASR or subtitle alignment.
- Live recording.
- AI image or video generation.
- Cloud accounts, sign-in, billing, or team sharing.
- Mobile-app-only patterns.

## Preview

Open `docs/ui/s2s-review-board-preview.html` in a browser to view the current static preview. It is a visual prototype only; it does not call local APIs or write project files.
