Now I have the full picture. Here's the implementation plan:

---

# Dark Mode Implementation Plan

## Architecture Decision

CSS custom properties (variables) on `:root` and `[data-theme="dark"]`. No React context, no JS theme provider. Pure CSS with a tiny toggle script. Respects `prefers-color-scheme` by default, allows manual override persisted to `localStorage`.

---

## Step 1: Extract CSS variables and add dark theme to `style.css`

**Files:** `src/client/style.css`

**Description:** Replace every hardcoded color in `style.css` with CSS custom properties. Define light values on `:root`, dark values on `[data-theme="dark"]`, and auto-detect via `prefers-color-scheme`.

Variable map:

| Variable | Light | Dark |
|---|---|---|
| `--color-text` | `#333` | `#d4d4d4` |
| `--color-bg` | `#fff` | `#1e1e1e` |
| `--color-heading-border` | `#e0e0e0` | `#333` |
| `--color-heading-border-light` | `#eee` | `#2a2a2a` |
| `--color-link` | `#0066cc` | `#4da6ff` |
| `--color-code-bg` | `#f5f5f5` | `#2d2d2d` |
| `--color-table-border` | `#ddd` | `#444` |
| `--color-table-header-bg` | `#f9f9f9` | `#2a2a2a` |
| `--color-blockquote-border` | `#8899aa` | `#556677` |
| `--color-blockquote-text` | `#555` | `#999` |
| `--color-selection` | `rgba(0,102,204,0.15)` | `rgba(77,166,255,0.25)` |
| `--color-hr` | `#ddd` | `#444` |
| `--color-btn-border` | `#ccc` | `#555` |
| `--color-btn-bg` | `#f5f5f5` | `#2d2d2d` |
| `--color-btn-text` | `#333` | `#d4d4d4` |
| `--color-btn-active-bg` | `#ddd` | `#444` |

Add at top of file:
```css
:root {
  --color-text: #333;
  --color-bg: #fff;
  /* ... all variables ... */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-text: #d4d4d4;
    --color-bg: #1e1e1e;
    /* ... dark values ... */
  }
}

[data-theme="dark"] {
  --color-text: #d4d4d4;
  --color-bg: #1e1e1e;
  /* ... dark values ... */
}
```

Then replace every hardcoded color reference with `var(--color-*)`.

**Dependencies:** None  
**Acceptance criteria:**
- No hardcoded color values remain in `style.css`
- Light mode looks identical to current
- `[data-theme="dark"]` on `<html>` switches all editor styles to dark
- `prefers-color-scheme: dark` auto-activates dark when no manual override

---

## Step 2: Replace inline style colors in `Editor.tsx` with CSS classes

**Files:** `src/client/Editor.tsx`, `src/client/style.css`

**Description:** The following inline styles in `Editor.tsx` have hardcoded colors that need to use CSS variables or be moved to CSS classes:

1. **Header** (line ~131): `borderBottom: "1px solid #e0e0e0"`, `color: "#666"` → Add `.editor-header` class to `style.css` using `var(--color-heading-border)` and a new `var(--color-text-muted)` (light: `#666`, dark: `#999`).

2. **SaveIndicator** (line ~174-194): Colors `#999`, `#339933`, `#cc7700`, `#cc3300`, background `#fff` text → These status colors work on both themes (they're on colored pill backgrounds with white text). Keep the status color map as-is — these are semantic, not theme-dependent.

3. **Closed state** (line ~104): `color: "#666"` → use `var(--color-text-muted)`.

4. **Error/loading states** (lines ~111, ~119): No colors hardcoded beyond inherited — these are fine.

Move layout-only properties (padding, flex, font) to CSS classes where sensible, but the primary goal is eliminating hardcoded colors. Add these new variables:

| Variable | Light | Dark |
|---|---|---|
| `--color-text-muted` | `#666` | `#999` |
| `--color-header-border` | `#e0e0e0` | `#333` |

**Dependencies:** Step 1 (needs the CSS variable system)  
**Acceptance criteria:**
- No hardcoded color values in `Editor.tsx` inline styles (layout values like padding are fine)
- Header, closed state use CSS variables
- SaveIndicator status pills remain readable in both themes

---

## Step 3: Add theme toggle button to editor header

**Files:** `src/client/Editor.tsx`, `src/client/style.css`

**Description:** Add a small toggle button in the editor header (between filename and "Save & Done" button). Behavior:

1. On mount, read `localStorage.getItem("theme")`. If `"dark"` or `"light"`, apply `data-theme` to `document.documentElement`. If absent, let `prefers-color-scheme` handle it.
2. Toggle cycles: auto → dark → light → auto. Or simpler: just toggle between light/dark, stored in localStorage.
3. Button shows a sun/moon character (☀/☾) — no icon library, just unicode.
4. Persist choice to `localStorage.setItem("theme", value)`.

Implementation: A small `useTheme` hook or inline logic in `Editor.tsx`. Keep it minimal — ~15 lines.

Add `.btn-theme` class in `style.css`:
```css
.btn-theme {
  background: none;
  border: 1px solid var(--color-btn-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  color: var(--color-text-muted);
}
```

**Dependencies:** Steps 1 and 2  
**Acceptance criteria:**
- Toggle button visible in header
- Clicking toggles between light and dark
- Choice persists across page reloads via localStorage
- Removing localStorage entry falls back to OS preference

---

## Step 4: Add dark mode to server-rendered index page

**Files:** `src/server/index.ts`

**Description:** The two inline HTML templates in the `GET /` handler (empty state at line ~148 and document list at line ~170) have hardcoded colors in `<style>` tags. Update both:

1. Add CSS variables inline in the `<style>` block (same pattern as client but only the subset used: text, bg, code-bg, link, table-border).
2. Add `<meta name="color-scheme" content="light dark">` to `<head>`.
3. Add `@media (prefers-color-scheme: dark)` block with dark overrides.
4. Replace hardcoded color values with `var()` references.

No toggle button needed on index page — just respect OS preference.

**Dependencies:** None (independent of client changes)  
**Acceptance criteria:**
- Index page (both empty and with-docs variants) renders correctly in light mode
- Dark mode activates automatically via `prefers-color-scheme`
- No hardcoded colors remain in the inline HTML styles

---

## Step 5: Add `color-scheme` meta tag and dark scrollbar support

**Files:** `src/client/index.html`, `src/client/style.css`

**Description:**

1. In `index.html`, add `<meta name="color-scheme" content="light dark">` to `<head>`. This tells the browser to use native dark form controls, scrollbars, etc.

2. In `style.css`, add `color-scheme: light dark` to `:root` and set it explicitly on `[data-theme]`:
```css
:root { color-scheme: light; }
[data-theme="dark"] { color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; }
}
```

3. Add a `<script>` in `index.html` (before React loads) that reads `localStorage.theme` and applies `data-theme` to `<html>` immediately — prevents flash of wrong theme (FOWT):
```html
<script>
  (function(){
    var t = localStorage.getItem('theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  })();
</script>
```

**Dependencies:** Step 1 (needs the variable system)  
**Acceptance criteria:**
- No flash of light theme when dark is selected on page load
- Native browser controls (scrollbars, checkboxes) match theme
- `color-scheme` property updates when theme changes

---

## Step 6: Add unit tests for theme logic

**Files:** `src/client/__tests__/theme.test.ts` (new)

**Description:** Write unit tests using Node's built-in test runner (`node:test`) with stubs:

1. **Theme initialization:** When localStorage has `"dark"`, `data-theme` is set to `"dark"` on documentElement.
2. **Theme initialization:** When localStorage is empty, no `data-theme` attribute is set.
3. **Theme toggle:** Calling toggle from `"light"` sets `"dark"` and vice versa.
4. **Theme persistence:** After toggle, localStorage contains the new value.

Stub `localStorage` and `document.documentElement` — no DOM library needed. Test the pure logic function, not the React component.

Extract the theme logic into a small `src/client/theme.ts` module:
```typescript
export function getStoredTheme(): string | null {
  return localStorage.getItem("theme");
}
export function applyTheme(theme: string | null): void {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
export function toggleTheme(): string {
  const current = document.documentElement.getAttribute("data-theme");
  const isDark = current === "dark" ||
    (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDark ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
  return next;
}
```

**Dependencies:** Step 3 (needs the theme toggle logic to exist)  
**Acceptance criteria:**
- Tests pass with `npm test`
- Tests use stubs, no browser/server required
- Cover init, toggle, and persistence paths

---

## Execution Order

```
Step 1 ──┐
         ├── Step 2 ── Step 3 ── Step 6
Step 4   │
Step 5 ──┘
```

**Parallel group 1** (no dependencies): Steps 1, 4  
**Parallel group 2** (depends on Step 1): Steps 2, 5  
**Sequential** (depends on Step 2): Step 3  
**Sequential** (depends on Step 3): Step 6
