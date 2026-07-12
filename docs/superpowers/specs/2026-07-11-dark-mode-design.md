# Dark mode — design

2026-07-11. Add user-switchable dark mode to the web app (`cloud/web`), using
shadcn's recommended dark-mode implementation for TanStack Start, unmodified.

## Goals

1. Light / Dark / System theme preference, defaulting to System.
2. No flash of wrong theme on load (SSR-safe).
3. Theme control in the app-shell header (desktop) and mobile drawer.

Out of scope: syncing the preference across devices (it lives in
localStorage, per-device), a theme field on the Settings page, and any
palette changes — `src/styles.css` already ships a complete `.dark` token
block from the shadcn scaffold; it is used as-is.

## Decisions

- **Follow shadcn's official TanStack Start recipe verbatim**
  (https://ui.shadcn.com/docs/dark-mode/tanstack-start). Persistence is
  localStorage (key `theme`); flash prevention is a `<ScriptOnce>` inline
  script from `@tanstack/react-router` that sets the `.dark` class and
  `color-scheme` on `<html>` before React hydrates. This supersedes an
  earlier lean toward a cookie — both are per-device with no backend; the
  recipe wins because it is the maintained, documented path.
- **`suppressHydrationWarning` on `<html>`** — required because the inline
  script mutates the root element's class before hydration, so server markup
  legitimately differs from the client DOM. Suppression applies one level
  deep only.
- **System mode tracks OS changes live** via a `matchMedia` change listener
  in the provider (part of the recipe).

## Changes (5 files, no backend)

1. `src/components/theme-provider.tsx` (new) — shadcn's `ThemeProvider` +
   `useTheme` context, localStorage persistence, `ScriptOnce` anti-flash
   script, `matchMedia` listener.
2. `src/components/ui/dropdown-menu.tsx` (new) — installed via
   `pnpm dlx shadcn@latest add dropdown-menu`; the toggle needs it and the
   project doesn't have it yet.
3. `src/components/mode-toggle.tsx` (new) — shadcn's `ModeToggle`: sun/moon
   icon button opening a Light / Dark / System dropdown.
4. `src/routes/__root.tsx` — add `suppressHydrationWarning` to `<html>`;
   wrap `{children}` in `<ThemeProvider defaultTheme="system"
   storageKey="theme">` inside `<body>`.
5. `src/components/app-shell.tsx` — `<ModeToggle />` next to the Sign out
   button on desktop and in the mobile drawer footer.

The provider wraps the root document, so the sign-in screen is themed too;
it just has no toggle of its own.

## Testing

- Verify in the running app: toggle Light/Dark/System, reload in each state
  (no flash), flip the OS appearance while in System mode, check the
  sign-in screen and mobile drawer.
- Existing `vitest` suite must keep passing; no new unit tests — the code
  is a copied, documented recipe with no app-specific logic.
