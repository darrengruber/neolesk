---
status: accepted
---

# iCloud on desktop, iOS app patterns on mobile

We decided that neolesk should look like an Apple first-party product. Apple
publishes no web design system, and its own web property degrades on phones —
Pages, Numbers and Keynote are view-only on iCloud.com in mobile Safari, because
Apple's answer to mobile is the native app. So we clone two different references:
iCloud.com's sidebar, toolbar and window chrome on desktop, and iOS app patterns
on mobile — bottom tab bar, sheets with detents, large-title navigation and
safe-area insets.

## Constraints not visible in the code

- **We cannot ship Apple's assets.** SF Pro and SF Symbols are both licensed for
  "software products running on Apple's iOS, iPadOS, macOS or tvOS". A public
  website is neither. We use the `-apple-system` / `system-ui` stack, which gives
  real SF on Apple devices without shipping a file, and an open icon set restyled
  toward SF Symbols' geometry.
- **Liquid Glass refraction is Chromium-only.** `backdrop-filter: url(#filter)`
  is not supported in Safari or Firefox, which is a striking place to lose the
  effect on Apple's own browser. We use it where available and fall back to flat
  translucent blur elsewhere, and we mirror Apple's WWDC 2026 transparency slider
  as a user setting.
- **This is deliberate visual similarity to Apple's trade dress.** It was raised
  and chosen knowingly.

## The resulting design system

- **Colour**: Apple's semantic palette wholesale — label, secondaryLabel,
  systemBackground, separator, the fill hierarchy — with neolesk's blue kept as
  the app tint. Apple's own apps each carry a distinct tint over a shared
  palette, so this is the faithful reading, and the semantic layer is what makes
  dark mode and Liquid Glass behave.
- **Appearance**: follows `prefers-color-scheme`, with a Light/Dark/Auto
  override in settings. The current stylesheet is light-only with hardcoded hex
  values, so this is a full token pass.
- **Motion**: spring physics for anything the user manipulates — sheets, drags,
  the pane splitter, tab transitions — and simple curves for incidental fades.
  `prefers-reduced-motion` is honoured throughout.
- **Desktop navigation**: the sidebar holds examples and cheat sheets, promoted
  out of modals. Language selection is a toolbar popover with a provenance badge
  beside it, so the cause of "on this device" or "rendered by <server>" sits next
  to the control that determines it.
- **Mobile navigation**: a bottom tab bar — Code, Preview, Examples, Settings.
