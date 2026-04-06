It seems I'm being blocked from writing to the sprint files. Here's the implementation plan:

---

# Dark Mode — Implementation Plan

## Philosophy

Respect the user's OS preference. No toggle, no localStorage, no JS theme switching. One `prefers-color-scheme: dark` media query. The system already knows what the user wants.

---

## Step 1: Extract CSS custom properties and add dark-mode overrides in `style.css`

**File:** `src/client/style.css`  
**Dependencies:** None

Replace every hardcoded color with a CSS custom property. Define light defaults on `:root`, override in `@media (prefers-color-scheme: dark)`.

**Variable map (light → dark):**

| Variable | Light | Dark |
|---|---|---|
| `--color-text` | `#333` | `#d4d4d4` |
| `--color-text-muted` | `#666` | `#999` |
| `--color-bg` | `#fff` | `#1e1e1e` |
| `--color-bg-subtle` | `#f5f5f5` | `#2a2a2a` |
| `--color-bg-muted` | `#f9f9f9` | `#252525` |
| `--color-border` | `#e0e0e0` | `#3a3a3a` |
| `--color-border-subtle` | `#eee` | `#333` |
| `--color-border-faint` | `#ddd` | `#383838` |
| `--color-link` | `#0066cc` | `#6cb6ff` |
| `--color-selection` | `rgba(0,102,204,0.15)` | `rgba(108,182,255,0.2)` |
| `--color-blockquote-border` | `#8899aa` | `#556677` |
| `--color-blockquote-text` | `#555` | `#aaa` |
| `--color-btn-border` | `#ccc` | `#555` |
| `--color-btn-bg` | `#f5f5f5` | `#2a2a2a` |
| `--color-btn-active` | `#ddd` | `#444` |

**What to do:**
1. Add `:root { ... }` block after the `*` reset with all light values
2. Add `@media (prefers-color-scheme: dark) { :root { ... } }` with dark values
3. Replace every hardcoded hex (`body`, `h1/h2` borders, `a` color, `code/pre` bg, `th/td` borders, `blockquote`, `hr`, `::selection`, `.btn-done`) with `var(--name)`

**Also add new CSS classes** for Step 2: `.editor-header`, `.state-page`, `.state-page--center`, `.state-page__muted`, `.save-indicator` — all using variables for colors.

**Acceptance:** Light mode pixel-identical. Dark mode activates via OS preference. Zero hardcoded hex in rules.

---

## Step 2: Replace inline color styles with CSS classes in `Editor.tsx`

**File:** `src/client/Editor.tsx`  
**Dependencies:** Step 1

1. **Header** (~line 128): `style={{...}}` → `className="editor-header"`, remove style prop
2. **Closed state** (~line 101): `style={{...}}` → `className="state-page state-page--center"`, `style={{ color: "#666"... }}` → `className="state-page__muted"`
3. **Error state** (~line 110): → `className="state-page"`
4. **Loading state** (~line 118): → `className="state-page"`
5. **SaveIndicator** (~line 181): Add `className="save-indicator"`, reduce inline style to just `background` and `opacity` (the two dynamic values)

**Acceptance:** Zero hardcoded color hex in inline styles. SaveIndicator's `colorMap` status colors stay (semantic, not theme). No TS errors.

---

## Step 3: Add dark mode to server-rendered HTML in `index.ts`

**File:** `src/server/index.ts`  
**Dependencies:** None

1. Define `PAGE_STYLES` const after imports — self-contained CSS variables + dark media query + all the rules currently inline in the templates
2. Empty index page (~line 148): `<style>${PAGE_STYLES}</style>`
3. Populated index page (~line 170): `<style>${PAGE_STYLES}</style>`
4. 404 page (~line 190): Add `<style>${PAGE_STYLES}</style>`

**Acceptance:** All 3 HTML responses use `PAGE_STYLES`. Dark mode works. No hardcoded colors in template strings.

---

## Step 4: Add `color-scheme` meta tag to `index.html`

**File:** `src/client/index.html`  
**Dependencies:** None

Add `<meta name="color-scheme" content="light dark" />` to `<head>`. This gives native dark scrollbars and form controls for free.

**Acceptance:** Meta tag present. Browser renders native dark controls in dark mode.

---

## Step 5: Unit tests for dark-mode presence

**File:** `src/server/__tests__/darkmode.test.ts` (new)  
**Dependencies:** Steps 1, 2, 3

Static file reads (no server startup). Verify:
- `style.css` contains `prefers-color-scheme: dark`, CSS variables on `:root`, no hardcoded hex in `body` rule, new CSS classes
- `index.ts` contains `prefers-color-scheme:dark` in `PAGE_STYLES`, uses `${PAGE_STYLES}` 3+ times
- `Editor.tsx` contains `className="editor-header"`, `className="state-page"`, `className="save-indicator"`

**Acceptance:** `npx vitest run src/server/__tests__/darkmode.test.ts` passes.

---

## Execution Order

```
Step 1 ──────► Step 2 ──┐
                        ├──► Step 5
Step 3 ─────────────────┤
                        │
Step 4 ─────────────────┘
```

Steps 1, 3, 4 run **in parallel**. Step 2 waits for 1. Step 5 waits for all.
