# Touch layouts follow the iOS HIG; the wide workspace keeps its geometry

ADR 0003 chose iOS app patterns for phones. The first cut stacked the desktop
toolbar, a deployment notice and a large page title above a small editor, so a
phone gave the diagram less than half of the screen. We rebuilt the touch layouts
around the iOS Human Interface Guidelines and kept the wide workspace as it is.

There are three layout classes, chosen by width (`src/ui/model.ts`):

- **Compact** (below 768 px, iPhone): a tab bar with Code, Preview, Examples and
  Settings. Code and Preview carry a navigation bar whose title is the diagram
  language, with the render provenance as its subtitle; tapping it opens the
  language sheet. One Share button replaces Copy snapshot, New session and
  Export, which move into a Share and Export sheet.
- **Regular** (768 to 1099 px, iPad): an Editor tab with source and preview side
  by side, plus Examples and Settings. It shares the compact navigation bar.
- **Wide** (from 1100 px): the iCloud-style workspace from ADR 0003.

Sheets are native `<dialog>` elements: a bottom sheet with a grabber on a phone,
a form sheet at regular width. Examples are a navigation stack: languages, each
with a picture of its default example, then a gallery of that language's
examples. People choose a diagram by how it looks, not by its name. The pictures
are the pre-rendered corpus thumbnails; a build without them (NEOLESK_CACHE_SKIP)
shows placeholders and requests nothing. Settings are inset grouped rows with a
segmented control, a checkmark list and a switch. A newly opened snapshot link or
session link opens on Preview on a phone, and a reload keeps the current tab.

## Constraints not visible in the code

- **The corpus screenshots the preview canvas at wide width** (ADR 0012). The
  canvas colours are separate tokens (`--canvas-*`), and the wide bar, notice and
  pane-header heights are pinned to 52, 24 and 34 px. The preview pane's left
  border also uses the canvas token: the preview starts at a sub-pixel offset,
  so that border blends into the first screenshot column. A before and after
  capture of 76 browser-rendered examples at 1440 × 900 had identical geometry,
  and 74 matched pixel for pixel. The other two differ by the same amount
  between two runs of unchanged code. Change these values only together with a
  reviewed corpus update.
- **The participant view contract does not change.** Sessions and MCP agents
  still store `panel` as `code`, `preview`, `examples` or `settings`. At regular
  width `code` and `preview` both select the Editor tab.
- **Safari ignores `interactive-widget`.** The shell follows the visual viewport
  instead, hides the tab bar while the keyboard is up, and shows Done to dismiss
  it. The editor uses 16 px text on touch layouts, because iOS zooms into any
  smaller editable text; that is also why `maximum-scale=1` could be removed.

## Deliberate departures from literal iOS values

- Text uses the Increase Contrast values where the standard iOS colour fails
  WCAG AA as small text: tint text `#0062cc` (light) and `#409cff` (dark), a
  `#0071e3` filled-button background, and darker status text. Fills keep the
  standard colours.
- Icons stay Lucide at a 1.75 stroke, as ADR 0003 requires; SF Symbols cannot
  ship on the web.

## Consequences

- PNG, JPEG and PDF rows are disabled with "Needs a render server" when there is
  no consented server, instead of failing after a tap.
- On touch layouts an export goes to the system share sheet when the browser can
  share files, so a phone can save to Files or Photos.
- `npm run test:e2e` runs the journeys on iPhone WebKit, iPad WebKit and desktop
  Chromium.
