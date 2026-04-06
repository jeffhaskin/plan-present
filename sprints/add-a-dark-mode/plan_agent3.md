The plan is ready — here's the summary:

## Dark Mode Implementation Plan — 8 Steps

**Architecture:** CSS custom properties on `:root` / `[data-theme="dark"]`, driven by a single `data-theme` attribute on `<html>`. Synchronous inline script prevents FOUC. localStorage persists the choice; `prefers-color-scheme` is the fallback default.

### Steps

| # | Title | Files | Depends On |
|---|---|---|---|
| **1** | Define CSS variables + dark palette | `style.css` | — |
| **2** | Move Editor.tsx inline colors to CSS classes | `Editor.tsx`, `style.css` | 1 |
| **3** | Add FOUC-prevention script to `index.html` | `index.html` | — |
| **4** | Create ThemeToggle component | `ThemeToggle.tsx` (new), `style.css` | 1, 3 |
| **5** | Wire ThemeToggle into Editor header | `Editor.tsx` | 2, 4 |
| **6** | Update server-rendered index page HTML | `index.ts`, `html.ts` (new) | — |
| **7** | Unit tests for HTML helpers | `__tests__/dark-mode.test.ts` (new) | 6 |
| **8** | Build + test verification | — | All |

### Parallelism

Steps **1, 3, 6** can execute concurrently (first wave). Then **2 + 4** in parallel (second wave). Then **5** and **7** (third wave). Then **8** (final verification).

Key design decisions:
- **No React context or theme provider** — CSS variables do all the work, zero runtime overhead
- **Duplicated theme-init script** in SPA `index.html` and server-rendered pages (they're separate HTML documents)
- **Server HTML helpers extracted to `html.ts`** — testable without spinning up Express
- **Short CSS variable names** (`--c-text`) in server HTML, full names (`--color-text`) in SPA — independent scopes, keeps inline HTML compact

Shall I write this to the plan file, or would you like changes first?
