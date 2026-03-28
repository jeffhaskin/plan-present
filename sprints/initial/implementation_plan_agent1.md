# Implementation Plan: plan-present

## Project Summary

A long-running HTTP server on port `7979` that serves WYSIWYG Markdown editors in the browser. AI agents register files via a simple `POST /open` endpoint (curl-friendly) and receive a stable URL back. The browser UI uses Tiptap for single-surface rich Markdown editing with autosave. The Tailscale hostname is resolved once at startup and used for all returned URLs.

---

## Authoritative User Requirements

Extracted directly from the conversation — these are non-negotiable.

| # | Requirement |
|---|-------------|
| R1 | Single long-running server on port `7979`, not per-request ephemeral servers |
| R2 | Tailscale hostname discovered once at startup via CLI/API, cached in memory |
| R3 | Final URL format: `http://<tailscale-host>:7979/doc/<slug>` |
| R4 | Slug is the filename (no extension), not a numeric ID. Collisions resolved by appending `_1`, `_2`, etc. |
| R5 | URL-incompatible characters in filenames replaced with underscores |
| R6 | WYSIWYG single-surface editor (no split pane). Markdown renders while editing. |
| R7 | Editor: Tiptap (user's explicit choice) |
| R8 | Markdown file on disk is the source of truth |
| R9 | Autosave with debounce |
| R10 | Conflict handling: if on-disk file changed since load, rename on-disk to `*_conflict.md`, save browser version as authoritative under original name |
| R11 | Single-user per document, but multiple documents open concurrently (different agents, different tabs) |
| R12 | No auth tokens. Security relies on Tailscale network only. Reject non-Tailscale traffic. |
| R13 | Agents interact via curl (`POST /open` with file path), not via MCP-specific tooling |
| R14 | Multiple AI agents across different terminal sessions can register files simultaneously |
| R15 | Server launched manually by user in a tmux session |

## Approved Design Decisions (from conversation)

- Document registry: in-memory, optionally backed by a small JSON file for restart recovery
- No workspace-root restriction was explicitly requested, but the assistant suggested it and the user didn't push back. Implement as a simple configurable allow-list, defaulting to permissive.
- Read-only mode was mentioned as optional for v1. Deprioritize but keep the API slot open.

---

## Risk Assessment

### HIGH RISK: Tiptap Markdown Table Round-Tripping

Current research (March 2026) reveals significant issues with `@tiptap/markdown`:

1. **Tables exported to markdown fail** — tables created in the editor don't correctly serialize to markdown syntax (GitHub issue #5750)
2. **Markdown table syntax not supported in editor input** — you can't type `| cell | cell |` directly (GitHub issue #7435)
3. **One child node per cell** limitation in markdown mode

**Impact**: Tables are a core element of implementation plans. If tables don't round-trip, the tool fails its primary use case.

**Mitigation strategy** (in priority order):
1. Build a spike (Step 2) that specifically tests table round-tripping before committing to the full build
2. If `@tiptap/markdown` tables are broken, evaluate the community `tiptap-markdown` package or a custom serializer using `markdown-it` / `remark`
3. If Tiptap tables fundamentally can't round-trip to markdown, consider a hybrid approach: render tables as editable HTML tables in the editor but use a custom serializer to write GFM table syntax on save
4. Worst case: fall back to Milkdown (user's second choice from conversation)

### MEDIUM RISK: Tiptap Markdown Extension Maturity

The `@tiptap/markdown` package is described as "early release" with edge cases not fully supported. `getMarkdown()` returning empty strings in some frameworks is concerning.

**Mitigation**: Pin exact package versions. Write integration tests for all markdown constructs used in typical plans. Keep the serialization layer isolated so it can be swapped.

### LOW RISK: Tailscale Interface Binding

User wants to reject non-Tailscale traffic. This requires either binding to the Tailscale interface IP specifically or filtering by source IP.

**Mitigation**: Bind to `0.0.0.0` but add middleware that checks the request's source against the Tailscale subnet (100.x.x.x range). Simple and reliable.

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (v25 available on machine) | Already installed, good for HTTP servers + bundling JS |
| Server framework | Express or Fastify | Lightweight, well-known. Fastify preferred for performance but Express is simpler. |
| Editor | Tiptap v2/v3 + extensions | User's explicit choice |
| Markdown parsing | `@tiptap/markdown` (with fallback plan) | Official package, but spike needed for tables |
| Frontend bundling | Vite | Fast dev server, simple config, good for single-page apps |
| Tailscale lookup | `tailscale status --json` via child_process | Already confirmed working on this machine |

### Key NPM Packages

```
@tiptap/core
@tiptap/starter-kit
@tiptap/markdown
@tiptap/extension-table (or @tiptap/extension-table-kit)
@tiptap/extension-table-row
@tiptap/extension-table-cell
@tiptap/extension-table-header
@tiptap/extension-task-list
@tiptap/extension-task-item
express (or fastify)
vite
```

---

## Architecture

```
plan-present/
  src/
    server/
      index.js          # Entry point, starts HTTP server
      tailscale.js      # Resolves Tailscale hostname at startup
      registry.js       # Document slug registry (in-memory + optional JSON persistence)
      routes.js         # Express routes: POST /open, GET /doc/:slug, API endpoints
      conflict.js       # File conflict detection and resolution
    editor/
      index.html        # Single-page editor shell
      editor.js         # Tiptap setup, markdown load/save, autosave logic
      style.css         # Editor styling
  package.json
  vite.config.js        # Bundles editor assets
```

### Data Flow

```
Agent (curl) ──POST /open {path}──> Server
  Server:
    1. Validate file exists and is .md
    2. Generate slug from filename
    3. Resolve collisions in registry
    4. Store mapping: slug -> {absolutePath, mtime at registration}
    5. Return {url: "http://<ts-host>:7979/doc/<slug>"}

Browser ──GET /doc/<slug>──> Server
  Server:
    1. Look up slug in registry
    2. Serve editor HTML (static assets)

Browser (editor JS) ──GET /api/doc/<slug>──> Server
  Server:
    1. Read markdown file from disk
    2. Return {content: "...", mtime: ...}

Browser (autosave) ──PUT /api/doc/<slug>──> Server
  Server:
    1. Check current file mtime vs mtime-at-load
    2. If mtime changed (conflict):
       a. Rename on-disk file to <name>_conflict.md
       b. Save browser content as <name>.md
    3. If no conflict:
       a. Write browser content to file
       b. Update stored mtime
    4. Return {saved: true, conflict: false|true}
```

---

## Implementation Steps

### Step 0: Project Scaffolding
- `npm init`
- Install dependencies
- Create directory structure
- Add `start` script to `package.json`
- Configure `.gitignore` for `node_modules/`, `dist/`

### Step 1: Tailscale Hostname Resolution
- Module that runs `tailscale status --json` via `child_process.execSync`
- Parses JSON, extracts `Self.DNSName`
- Strips trailing dot
- Caches result in module scope
- Falls back to `localhost` if Tailscale unavailable (dev convenience)
- **Test**: run module, confirm it returns `flywheel.tail2a835b.ts.net`

### Step 2: Tiptap Markdown Spike (CRITICAL — do before full build)
- Minimal HTML page with Tiptap + markdown extension + table extensions
- Load a sample markdown string containing: heading, list, table, code block, task list, blockquote, inline code, link, emphasis
- Render in editor
- Export back to markdown
- **Compare input vs output**. Document any normalization or data loss.
- If tables fail: evaluate alternatives before proceeding
- This step gates Step 5. Do not proceed to full editor build if tables don't round-trip.

### Step 3: Document Registry
- In-memory `Map<slug, {absolutePath, mtime, registeredAt}>`
- Slug generation: `path.basename(filePath, '.md')` → lowercase → replace non-alphanumeric with `_` → deduplicate with `_1`, `_2` suffix
- Optional: persist registry to `~/.plan-present/registry.json` on changes, reload on startup
- Expose functions: `registerDocument(filePath)`, `getDocument(slug)`, `listDocuments()`, `removeDocument(slug)`

### Step 4: HTTP Server + Routes
- Express app bound to `0.0.0.0:7979`
- Middleware: reject requests not from Tailscale subnet (100.64.0.0/10 CGNAT range) unless `--dev` flag is passed
- Routes:
  - `POST /open` — body: `{path: "/absolute/path/to/file.md"}` — returns `{url, slug}`
  - `GET /doc/:slug` — serves the editor HTML page
  - `GET /api/doc/:slug` — returns `{content, mtime}`
  - `PUT /api/doc/:slug` — body: `{content, baseMtime}` — saves with conflict detection
  - `GET /api/docs` — lists all registered documents (for a potential index page)
  - `DELETE /api/doc/:slug` — unregisters a document
- Static asset serving for bundled editor JS/CSS

### Step 5: Tiptap Editor Page
- Single HTML page served for all `/doc/:slug` routes
- On load: fetch markdown content from `/api/doc/:slug`
- Initialize Tiptap with:
  - StarterKit (headings, lists, bold, italic, code, blockquote)
  - Table extensions (table, row, cell, header)
  - TaskList + TaskItem
  - Markdown extension with GFM enabled
- Parse fetched markdown into editor
- Style the editor to look clean and readable (not like a code editor, not like a word processor — somewhere in between, like Obsidian)
- No toolbar. The WYSIWYG surface is the interface. Keyboard shortcuts for formatting.

### Step 6: Autosave + Conflict Handling
- Debounced save: 2-second debounce after last edit
- On save: `PUT /api/doc/:slug` with current content + the mtime from when the document was loaded
- Server compares mtime:
  - Match → write file, return new mtime
  - Mismatch → rename existing to `_conflict.md`, write browser version, return `{conflict: true}`
- Editor shows a brief, non-intrusive notification on save (and on conflict)
- On page unload/close: trigger immediate save if there are unsaved changes (`beforeunload`)

### Step 7: Polish + Edge Cases
- Handle: file deleted on disk while editor is open (save creates it fresh)
- Handle: server restart while editor tabs are open (editor retries fetch, shows error if slug is gone)
- Handle: same file registered twice by different agents (returns existing slug, doesn't duplicate)
- Add a simple index page at `/` listing all currently registered documents
- Clean editor CSS: readable font, good line height, code block styling, table borders
- Startup banner: print the Tailscale URL to stdout so the user sees it in tmux

### Step 8: Dev/Run Configuration
- `npm start` — production mode, Tailscale-only
- `npm run dev` — dev mode, accepts localhost, Vite HMR for editor assets
- Document the curl interface for agents in a short README or inline help at `/`

---

## Curl Interface for Agents

Agents use exactly one command to register a file:

```bash
curl -s -X POST http://localhost:7979/open \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/plan.md"}'
```

Response:
```json
{"url": "http://flywheel.tail2a835b.ts.net:7979/doc/plan", "slug": "plan"}
```

The agent then returns that URL to the user. That's it.

To close/unregister:
```bash
curl -s -X DELETE http://localhost:7979/api/doc/plan
```

---

## What Is NOT in Scope for v1

- MCP server protocol (user explicitly said curl is sufficient)
- Multi-user collaboration / CRDT
- Authentication beyond Tailscale network membership
- Syntax highlighting in code blocks (monospace is enough)
- File browser / directory listing
- Creating new files from the browser
- Version history / undo beyond editor session
- Mobile-optimized layout
- Toolbar or formatting buttons (keyboard shortcuts only)
- Split-pane or side-by-side editing

---

## Open Questions for User

1. **Server language**: Node.js is the natural fit given Tiptap is JS. But the user mentioned Python in the conversation for the "simple HTTP server" pattern. Should the server be Python (Flask/FastAPI) serving pre-bundled static assets, or Node.js (Express) for tighter integration? Node.js is recommended.

2. **Editor CSS theme**: Any preference on light/dark mode? Default to light with clean typography, or match terminal dark theme?

3. **Step 2 outcome**: If the Tiptap markdown spike reveals that tables don't round-trip, does the user want to (a) accept table normalization, (b) switch to Milkdown, or (c) use a hybrid custom serializer?

---

## Estimated Complexity

| Step | Effort | Risk |
|------|--------|------|
| 0 - Scaffolding | Small | None |
| 1 - Tailscale | Small | None (already verified) |
| 2 - Tiptap spike | Small-Medium | **HIGH** — determines if Tiptap works |
| 3 - Registry | Small | None |
| 4 - HTTP server | Medium | Low |
| 5 - Editor page | Medium-Large | Medium (Tiptap config complexity) |
| 6 - Autosave/conflict | Medium | Low-Medium |
| 7 - Polish | Medium | Low |
| 8 - Dev config | Small | None |

**Critical path**: Step 2 (spike) must pass before Steps 5-6 are worth building. Everything else can proceed in parallel.
