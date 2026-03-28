# Unified Implementation Plan: plan-present

> **Bead tracking**: All tasks are tracked in the `br` issue tracker. Run `br ready` to see what can be started next. Run `br graph plan-present-nj9` to see the full dependency tree. Run `br list` for the complete inventory.

## Project Summary

A long-running HTTP server on port `7979` that serves WYSIWYG Markdown editors in the browser. AI agents register files via a simple `POST /open` endpoint (curl-friendly) and receive a stable Tailscale URL back. The browser UI uses Tiptap for single-surface rich Markdown editing with autosave. The Tailscale hostname is resolved once at startup and cached. The server fails hard if anything is wrong — no silent degradation, no fallbacks.

---

## Source Authority

This plan is derived from `sprints/open/initial/initial_conversation.md`. User statements are authoritative. Assistant suggestions are advisory unless the user explicitly accepted them.

### Authoritative User Requirements

These are non-negotiable. Every one was stated or confirmed by the user.

| # | Requirement | Source |
|---|-------------|--------|
| R1 | Single long-running server on port `7979`, not per-request ephemeral servers | "instead of spinning up a separate port ID and server for each one, it just uses the server that's already running" |
| R2 | Tailscale hostname discovered once at startup, cached in memory | "it should just check it every time the server itself launches and then hold it in memory" |
| R3 | Final URL format: `http://<tailscale-host>:7979/doc/<slug>` | "the final url would always be `http://<tailscale computer url>:7979`" + slug discussion |
| R4 | Slug is the filename (no extension), not a numeric ID. Collisions resolved by appending `_1`, `_2`, etc. | "even better than an ID number would just be the file name" / "unified_plan_1" |
| R5 | URL-incompatible characters in filenames replaced with underscores | "Just replace any incompatible character with like an underscore" |
| R6 | WYSIWYG single-surface editor (no split pane). Markdown renders while editing. | "while editing it, I would still like it to all be getting rendered" / "It's WYSIWYG" |
| R7 | Editor: Tiptap | "okay, tip tap it is" |
| R8 | Markdown file on disk is the source of truth | Agreed throughout |
| R9 | Autosave with debounce | "auto-save is compatible with the above, let's do it or use debounce, whatever" |
| R10 | Conflict handling: browser copy is authoritative. Rename on-disk original to `*_conflict.md`, save browser version under original name. | "just rename the original by appending _conflict to its name and assume the user temp copy is authoritative" |
| R11 | Single-user per document, but multiple documents open concurrently across agents/tabs | "I might have multiple assistants across different terminal sessions all using this tool at the same time" |
| R12 | No auth tokens. Rely on Tailscale network. Reject non-Tailscale traffic. | "just rely on the tailscale network for access And just reject any traffic outside the current tailscale network" |
| R13 | Agents interact via curl, not MCP-specific tooling | "We don't even really need MCP specific tooling. I can just tell the agents to use curl as a bash command." |
| R14 | Server launched manually by user in a tmux session | "The user in an independent tmux session, launches the mcp server" |

### Assistant Suggestions — Accepted

These were proposed by the assistant and explicitly or implicitly accepted by the user.

- Document registry in memory, optionally backed by JSON for restart recovery
- Short opaque document slugs derived from filename (user refined this further with specifics)
- `POST /open` as the registration endpoint shape
- Autosave with debounce (assistant proposed, user confirmed)
- Restrict to `.md` files

### Assistant Suggestions — Not Accepted (Advisory Only)

Do not treat these as requirements. Implement only if they prove necessary during development.

- Workspace-root restriction / allow-list for file paths (suggested but user never confirmed)
- Session tokens in URL (user explicitly rejected: "no tokens or anything")
- Read-only mode toggle (mentioned but not requested for v1)
- Restricting bind address vs filtering by source IP (implementation detail, not a requirement)

---

## Critical Reading of the Spec

### Clear product direction

- This is a lightweight single-user utility for agent-driven presentation and editing of Markdown files over Tailscale. It is not a document management platform.
- The user explicitly deprioritized security ceremony and formal MCP abstractions.
- The user strongly prioritized editing UX — single-surface WYSIWYG was the core ask that drove the entire conversation.

### Tensions and Ambiguities to Resolve

1. **"Reject traffic outside the current Tailscale network"** — directionally clear but technically ambiguous. The Tailscale CGNAT range is `100.64.0.0/10`. But the exact enforcement method (bind to Tailscale interface only vs. accept on `0.0.0.0` and filter by source IP) depends on the VPS network layout. This needs a spike.

2. **Conflict file naming** — the user said "appending `_conflict` to its name." But what if `plan_conflict.md` already exists from a previous conflict? The implementation must handle recursive conflicts deterministically: `plan_conflict.md`, `plan_conflict_1.md`, `plan_conflict_2.md`, etc. The extension must be preserved (not `plan_conflict` without `.md`).

3. **Same file registered twice** — if two agents both `POST /open` the same file path, the server should return the existing slug, not create a duplicate. The registry must deduplicate by absolute path.

4. **Raw HTML in Markdown** — the user's plan files may contain raw HTML. The plan should decide: sanitize it, pass it through, or strip it. Decision: **strip it on import, do not attempt to preserve it.** This is a plan editor, not an HTML editor. If this causes problems, it will be loud.

5. **Markdown normalization on save** — Tiptap's internal model is structured rich text, not raw Markdown. Saving will normalize formatting (e.g., consistent heading syntax, list markers, whitespace). This is acceptable for implementation plans. The user was warned about this in the conversation and proceeded.

### Design Corrections to the Conversation

These points were discussed but the final design supersedes earlier versions:

- The system is an HTTP service first. It is not an MCP server. The user explicitly said MCP is unnecessary.
- Numeric document IDs (`/doc/1`, `/doc/2`) were discussed then explicitly superseded by filename-based slugs.
- Split-pane editing is out of scope. The user rejected TOAST UI for exactly this reason.
- Raw `contenteditable` hacks are out of scope. Tiptap is the accepted path.

---

## Risk Assessment

### HIGH RISK: Tiptap Markdown Table Round-Tripping

Current research (March 2026) reveals known issues with `@tiptap/markdown`:

1. **Tables exported to markdown may fail** — GitHub issue [#5750](https://github.com/ueberdosis/tiptap/issues/5750): tables created in the editor don't correctly serialize to GFM table syntax
2. **Markdown table syntax not supported as direct editor input** — GitHub issue [#7435](https://github.com/ueberdosis/tiptap/issues/7435): you can't type `| cell | cell |` and have it become a table
3. **One child node per cell** limitation in markdown mode
4. **`getMarkdown()` returning empty strings** reported in some framework contexts

**Impact**: Tables are a core element of implementation plans. If tables don't round-trip, the tool fails its primary use case.

**Mitigation**: A mandatory spike (Phase 2) that tests table round-tripping before any other editor work begins. The spike produces a written verdict document. If tables fail, **stop and escalate to the user.** Do not silently switch editors, do not build workarounds, do not proceed. Fail loud.

### MEDIUM RISK: Tailscale Network Filtering

"Reject non-Tailscale traffic" is clear intent but the implementation path has multiple options with different tradeoffs. Binding only to the Tailscale interface IP is cleanest but may break `localhost` access during development. Binding to `0.0.0.0` with source-IP filtering is more flexible but requires correct identification of the Tailscale CGNAT range.

**Mitigation**: Phase 1 includes a network spike. In `--dev` mode, skip the filter entirely and bind to `0.0.0.0`. In production mode, enforce the filter. If the filter can't be made reliable, fail startup and tell the user why.

### LOW RISK: Markdown Normalization

Tiptap will normalize some Markdown formatting on save (e.g., consistent heading markers, list indentation, whitespace). This is inherent to any structured-document editor that round-trips through Markdown.

**Mitigation**: Document the known normalizations in the spike verdict. If normalization destroys semantic content (not just formatting), escalate.

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js v25 (installed) | Required for Tiptap; already on machine |
| Language | TypeScript | Types flow between server and client; catches errors at build time |
| Server | Express | Simpler than Fastify for this scope; extensive ecosystem |
| Editor | Tiptap + extensions | User's explicit choice |
| Markdown | `@tiptap/markdown` with GFM | Official Tiptap package; spike validates fitness |
| Frontend | React + Vite | Tiptap has first-class React bindings; Vite for fast builds |
| Tailscale | `tailscale status --json` via `child_process` | Already verified working on this machine |

### NPM Packages

```
# Core
typescript
@types/node
@types/express
ts-node (or tsx for execution)

# Server
express

# Editor - core
@tiptap/core
@tiptap/react
@tiptap/pm
@tiptap/starter-kit
@tiptap/markdown

# Editor - extensions
@tiptap/extension-table
@tiptap/extension-table-row
@tiptap/extension-table-cell
@tiptap/extension-table-header
@tiptap/extension-task-list
@tiptap/extension-task-item
@tiptap/extension-code-block-lowlight (syntax highlighting in code blocks)

# Frontend build
react
react-dom
@types/react
@types/react-dom
vite
@vitejs/plugin-react

# Syntax highlighting (for code blocks)
lowlight
```

---

## Architecture

### Directory Layout

```
plan-present/
  src/
    server/
      index.ts            # Entry point — starts server, fails fast on errors
      tailscale.ts         # Resolves Tailscale hostname at startup
      registry.ts          # Document slug registry (in-memory + optional JSON persistence)
      routes.ts            # Express routes: POST /open, GET /doc/:slug, API endpoints
      conflict.ts          # File conflict detection and resolution logic
      network.ts           # Tailscale network filtering middleware
    client/
      index.html           # SPA shell
      App.tsx              # Root component — routes to editor by slug
      Editor.tsx           # Tiptap editor component with markdown load/save
      useAutosave.ts       # Autosave hook with debounce
      style.css            # Editor styling — clean, Obsidian-inspired
    shared/
      types.ts             # Shared types between server and client
  spike/
      table-roundtrip.ts   # Spike: validates Tiptap markdown table fidelity
      sample.md            # Spike: representative plan document for testing
      VERDICT.md           # Spike: written results — pass or fail with evidence
  package.json
  tsconfig.json
  tsconfig.server.json
  vite.config.ts
```

### Data Flow

```
Agent (curl) ──POST /open {path}──> Server
  Server:
    1. Canonicalize path to absolute
    2. Validate file exists and is .md
    3. Check if path already registered → return existing slug
    4. Generate slug from filename (strip ext, sanitize, deduplicate)
    5. Store mapping: slug -> {absolutePath, mtime, registeredAt}
    6. Return {url: "http://<ts-host>:7979/doc/<slug>", slug: "<slug>"}

Browser ──GET /doc/<slug>──> Server
  Server:
    1. Verify slug exists in registry
    2. Serve SPA shell (index.html)

Browser (React app) ──GET /api/doc/<slug>──> Server
  Server:
    1. Look up slug in registry
    2. Read markdown file from disk
    3. Stat file for mtime
    4. Return {content: "...", mtime: <number>, slug: "...", fileName: "..."}

Browser (autosave) ──PUT /api/doc/<slug>──> Server
  Server:
    1. Look up slug in registry
    2. Stat current file on disk
    3. Compare current mtime vs client's baseMtime
    4. If match (no external changes):
       a. Write content to file atomically (write to .tmp then rename)
       b. Return {saved: true, conflict: false, mtime: <new>}
    5. If mismatch (external change detected):
       a. Rename on-disk file: plan.md → plan_conflict.md
          (if plan_conflict.md exists, use plan_conflict_1.md, etc.)
       b. Write browser content to plan.md
       c. Return {saved: true, conflict: true, conflictPath: "...", mtime: <new>}
```

### In-Memory Registry Data Model

```typescript
interface RegistryEntry {
  slug: string;
  absolutePath: string;
  originalBaseName: string;   // e.g., "unified_plan.md"
  registeredAt: number;       // timestamp
  lastSavedAt: number | null; // timestamp of last successful save
  lastKnownMtimeMs: number;   // mtime at registration or last save
  lastKnownSize: number;      // file size at registration or last save
}

// Registry is a Map<string, RegistryEntry> keyed by slug
// Secondary index: Map<string, string> keyed by absolutePath → slug (for dedup)
```

---

## HTTP API Surface

| Method | Path | Purpose | Input | Output |
|--------|------|---------|-------|--------|
| `POST` | `/open` | Register a document | `{path: "/abs/path.md"}` | `{url, slug}` |
| `GET` | `/doc/:slug` | Serve editor SPA | — | HTML |
| `GET` | `/api/doc/:slug` | Load document content | — | `{content, mtime, slug, fileName}` |
| `PUT` | `/api/doc/:slug` | Save document | `{content, baseMtime}` | `{saved, conflict, mtime}` |
| `DELETE` | `/api/doc/:slug` | Unregister a document | — | `{removed: true}` |
| `GET` | `/api/docs` | List registered documents | — | `[{slug, fileName, url}]` |
| `GET` | `/` | Index page listing active docs | — | HTML |
| `GET` | `/health` | Server readiness check | — | `{ok, tailscaleHost, docCount, uptime}` |

### Curl Interface for Agents

Register a file:
```bash
curl -s -X POST http://localhost:7979/open \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/plan.md"}'
```

Response:
```json
{"url": "http://flywheel.tail2a835b.ts.net:7979/doc/plan", "slug": "plan"}
```

Unregister:
```bash
curl -s -X DELETE http://localhost:7979/api/doc/plan
```

Check health:
```bash
curl -s http://localhost:7979/health
```

---

## Implementation Phases

### Phase 0: Project Bootstrap

**Goal**: Working TypeScript project with build tooling, ready for code.

- `npm init -y`
- Install all dependencies (server + client + dev)
- Create `tsconfig.json` (base), `tsconfig.server.json` (Node target), `vite.config.ts` (React)
- Create directory structure: `src/server/`, `src/client/`, `src/shared/`, `spike/`
- Add scripts to `package.json`:
  - `dev` — runs server with ts-node/tsx + Vite dev server
  - `build` — compiles server TS + bundles client with Vite
  - `start` — runs compiled server in production mode
  - `spike` — runs the Tiptap spike
- Update `.gitignore`: add `node_modules/`, `dist/`
- Verify: `npm run build` succeeds with empty app

### Phase 1: Server Skeleton + Tailscale + Network Spike

**Goal**: Express server running on `7979` with Tailscale hostname resolved and network filtering validated.

#### 1a. Tailscale Hostname Resolution (`tailscale.ts`)
- Run `tailscale status --json` via `child_process.execSync`
- Parse JSON, extract `Self.DNSName`
- Strip trailing dot (the API returns `flywheel.tail2a835b.ts.net.`)
- Cache in module scope
- **If resolution fails, crash the server with a clear error message.** No fallback to localhost. No silent degradation. The server is useless without a valid Tailscale hostname.
- Export: `getTailscaleHostname(): string`
- Verify: run module standalone, confirm it returns `flywheel.tail2a835b.ts.net`

#### 1b. Express Server (`index.ts`)
- Create Express app
- Bind to `0.0.0.0:7979`
- Add JSON body parsing middleware
- Add request logging (minimal — method, path, status, ms)
- Add `/health` endpoint returning `{ok: true, tailscaleHost, docCount: 0, uptime}`
- Print startup banner to stdout:
  ```
  plan-present listening on port 7979
  Tailscale URL: http://flywheel.tail2a835b.ts.net:7979
  ```
- **If bind fails (port in use), crash with clear error.** Don't try another port.

#### 1c. Network Restriction Spike (`network.ts`)
- Determine the Tailscale interface IP (parse from `tailscale status --json` or `tailscale ip -4`)
- Implement Express middleware that:
  - In `--dev` mode: allows all traffic (skip filter)
  - In production mode: checks `req.socket.remoteAddress` against Tailscale CGNAT range (`100.64.0.0/10`) and `127.0.0.1`
  - Rejects non-matching requests with `403 Forbidden`
- Test from Tailscale IP and from non-Tailscale IP
- **If the filtering approach doesn't work reliably on this VPS, stop and document why.** Do not ship an unverified security boundary.
- Document the result: what works, what doesn't, what the final approach is

### Phase 2: Tiptap Markdown Spike (CRITICAL GATE)

**Goal**: Written proof that Tiptap can round-trip the Markdown constructs used in implementation plans. This phase GATES all editor work. Do not proceed to Phase 4 if this fails.

#### Spike Design
- Create `spike/sample.md` containing a representative implementation plan with:
  - H1, H2, H3 headings
  - Paragraphs with **bold**, *italic*, `inline code`, [links](url)
  - Bullet lists (nested)
  - Numbered lists (nested)
  - Task lists (`- [ ]` / `- [x]`)
  - GFM tables (simple and multi-column)
  - Fenced code blocks (with language tags)
  - Blockquotes (including nested)
  - Horizontal rules
  - Mixed content (table after a list, code block inside a blockquote — if relevant)

#### Spike Implementation (`spike/table-roundtrip.ts`)
- Programmatic Node.js script (no browser needed — use Tiptap's Node-only APIs if available, otherwise use jsdom or similar)
- Load `sample.md` as a string
- Parse into Tiptap document using the same extensions as the real editor
- Serialize back to Markdown
- Compare input vs output
- Print a structured report:
  - For each construct: PASS / FAIL / NORMALIZED (formatting changed but semantics preserved)
  - For tables specifically: cell content preserved? structure preserved? alignment preserved?
- Write results to `spike/VERDICT.md`

#### Decision Criteria
- **All constructs PASS or NORMALIZED**: proceed to Phase 4
- **Tables FAIL (content/structure loss)**: **STOP. Escalate to user.** Do not switch to Milkdown. Do not build a custom serializer. Do not proceed. Present the evidence and let the user decide.
- **Other constructs FAIL**: evaluate severity. Escalate if it affects plan documents.

### Phase 3: Document Registry

**Goal**: Working in-memory registry that maps slugs to file paths, with deterministic collision handling.

#### Slug Generation (`registry.ts`)
1. `path.basename(filePath, '.md')` — strip directory and extension (also handle `.markdown`)
2. Lowercase
3. Replace any character not in `[a-z0-9_-]` with `_`
4. Collapse consecutive underscores to one
5. Trim leading/trailing underscores
6. If slug is empty after sanitization, use `doc` as fallback
7. Check registry for collision:
   - If slug exists AND points to the same absolute path → return existing slug (dedup)
   - If slug exists AND points to a different path → append `_1`, `_2`, etc. until unique

#### Registry API
```typescript
registerDocument(filePath: string): RegistryEntry    // validates, creates entry, returns it
getDocument(slug: string): RegistryEntry | undefined
getDocumentByPath(absPath: string): RegistryEntry | undefined  // for dedup lookup
listDocuments(): RegistryEntry[]
removeDocument(slug: string): boolean
```

#### Optional JSON Persistence
- On every registry mutation, write the full registry to `~/.plan-present/registry.json`
- On startup, attempt to reload — but validate that every file still exists on disk. Discard stale entries.
- This is lower priority than core save/load. Skip for the first working version if it slows things down.

#### Tests (unit)
- Slug from `unified_plan.md` → `unified_plan`
- Slug from `My Plan (v2).md` → `my_plan__v2_` → `my_plan_v2`
- Slug collision: two different files both named `plan.md` → `plan` and `plan_1`
- Same file registered twice → same slug returned
- Slug from empty/weird filenames → `doc`

### Phase 4: Browser Editor

**Goal**: Tiptap-based WYSIWYG editor served at `/doc/:slug`, loading content from the API.

#### 4a. SPA Shell
- `src/client/index.html` — minimal HTML, mounts React app
- `src/client/App.tsx` — reads slug from URL path, renders `<Editor slug={slug} />`
- Express serves the built SPA for any `/doc/:slug` route (SPA catch-all)

#### 4b. Editor Component (`Editor.tsx`)
- On mount: `GET /api/doc/:slug` → receive `{content, mtime, fileName}`
- Store `baseMtime` in component state (used for conflict detection on save)
- Initialize Tiptap editor with extensions:
  - `StarterKit` (headings, paragraphs, bold, italic, bullet/ordered lists, code blocks, blockquotes, horizontal rules)
  - `Table`, `TableRow`, `TableCell`, `TableHeader`
  - `TaskList`, `TaskItem`
  - `CodeBlockLowlight` with `lowlight` (syntax highlighting in fenced code blocks)
  - `Markdown` with GFM enabled
- Parse the fetched Markdown content into the editor
- Display the filename in a subtle header bar above the editor

#### 4c. Editor Styling (`style.css`)
- Obsidian-inspired: clean, readable, not flashy
- Good typography: system font stack, comfortable line height (~1.6), readable font size
- Headings visually distinct by size and weight
- Code blocks: monospace font, subtle background, rounded corners
- Tables: visible cell borders, subtle header row styling, comfortable cell padding
- Blockquotes: left border accent, slightly indented
- Task lists: actual checkboxes
- Links: colored, underlined
- No toolbar — formatting via keyboard shortcuts
- Full viewport height editor, minimal chrome
- Save status indicator: small text in corner ("Saved" / "Saving..." / "Conflict detected")

#### 4d. Keyboard Shortcuts
Tiptap provides these by default via StarterKit, but document them:
- `Ctrl+B` — bold
- `Ctrl+I` — italic
- `Ctrl+Shift+X` — strikethrough (if enabled)
- `Ctrl+E` — inline code
- Tab / Shift+Tab in lists — indent/outdent
- Enter in lists — continue list
- Backspace at start of list item — unindent or exit list

### Phase 5: Autosave + Conflict Handling

**Goal**: Edits automatically persist to disk. External changes trigger the conflict protocol.

#### 5a. Client-Side Autosave (`useAutosave.ts`)
- Custom React hook that watches the Tiptap editor for changes
- Debounce: 2 seconds after last keystroke
- On trigger: serialize editor content to Markdown, `PUT /api/doc/:slug` with `{content, baseMtime}`
- On successful response: update `baseMtime` to the returned `mtime`
- On conflict response: show notification ("Conflict detected — original saved as `plan_conflict.md`"), update `baseMtime`
- On network error: show notification, retry on next edit
- `beforeunload` handler: if there are unsaved changes, trigger immediate save and warn the user

#### 5b. Server-Side Save (`routes.ts` PUT handler)
1. Look up slug in registry
2. `fs.stat()` the file — get current `mtimeMs`
3. Compare `currentMtimeMs` vs `baseMtime` from client
4. **No conflict** (mtimes match):
   - Write content to `<path>.tmp`
   - `fs.rename()` the `.tmp` file to the original path (atomic write)
   - `fs.stat()` the new file for updated mtime
   - Update registry entry's `lastSavedAt` and `lastKnownMtimeMs`
   - Return `{saved: true, conflict: false, mtime: <new>}`
5. **Conflict** (mtimes differ):
   - Determine conflict filename: `plan_conflict.md`
   - If that exists: `plan_conflict_1.md`, `plan_conflict_2.md`, etc.
   - `fs.rename()` the current on-disk file to the conflict filename
   - Write browser content to the original path (atomic via `.tmp`)
   - Update registry entry
   - Return `{saved: true, conflict: true, conflictPath: "<conflict filename>", mtime: <new>}`
6. **File deleted on disk**:
   - Write browser content to the original path (recreate it)
   - Return `{saved: true, conflict: false, mtime: <new>, recreated: true}`

#### 5c. Conflict File Naming (deterministic)
```
plan.md → plan_conflict.md
plan.md (second conflict) → plan_conflict_1.md
plan.md (third conflict) → plan_conflict_2.md
```
Always preserve the `.md` extension. Always check existence before choosing a name.

### Phase 6: Index Page + Polish

**Goal**: Usable, finished product.

#### 6a. Index Page (`GET /`)
- Simple HTML page listing all registered documents
- Each entry: document name, slug, clickable link to `/doc/<slug>`, registration time
- Auto-refreshes or is static (doesn't need to be fancy)

#### 6b. Edge Cases
- Same file registered by multiple agents → return existing slug (dedup by absolute path)
- Server restart while editor tabs are open → editor fetch fails, show clear error with "re-register the document" message
- File registered but then deleted before editor opens → `GET /api/doc/:slug` returns 404 with clear message
- Very large markdown files → no special handling needed for v1, but don't load the whole file into memory redundantly

#### 6c. Startup Banner
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  plan-present v1
  Port: 7979
  URL:  http://flywheel.tail2a835b.ts.net:7979
  Mode: production | dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 6d. Run Modes
- `npm start` — production: Tailscale-only, serves pre-built client assets
- `npm run dev` — development: all traffic allowed, Vite HMR for client, `tsx` for server with watch mode

### Phase 7: Testing + Verification

**Goal**: Confidence that the system works as specified.

#### Automated Tests

**Slug generation:**
- basename extraction, extension stripping
- invalid character replacement
- consecutive underscore collapse
- collision suffixing (`_1`, `_2`)
- same-file dedup

**Registry:**
- register, retrieve, list, remove
- dedup by absolute path
- collision handling with different files, same basename

**Conflict handling:**
- normal save (no external change)
- save after external modification → conflict rename
- repeated conflicts → incrementing suffix
- file deleted before save → recreated

**API integration:**
- `POST /open` with valid path → 200 + url
- `POST /open` with nonexistent file → 400
- `POST /open` with non-.md file → 400
- `POST /open` same file twice → same slug
- `GET /api/doc/:slug` → content + mtime
- `PUT /api/doc/:slug` → save + updated mtime
- `DELETE /api/doc/:slug` → removed
- `GET /health` → ok

**Markdown round-trip fixtures:**
- headings, nested lists, task lists, blockquotes, fenced code blocks, tables, inline code, links, emphasis
- Verify semantic preservation (not necessarily byte-identical formatting)

#### Manual Tests
- Open a registered document via Tailscale URL in browser
- Verify single-surface editing (no split pane)
- Edit a table: add/remove rows, edit cells
- Edit a code block: type code, verify it stays in the block
- Trigger autosave, verify file on disk is updated
- Modify the file on disk externally, then trigger autosave from browser → verify conflict rename
- Attempt access from non-Tailscale IP → verify rejection
- Register 3+ documents from different terminal sessions → verify all coexist
- Kill and restart server → verify registered documents are gone (or restored if JSON persistence is implemented)

---

## Milestone Definition: V1 Complete

V1 is done when **all** of the following are true:

- [ ] An agent can `POST /open` with a Markdown file path and receive a working Tailscale URL
- [ ] Visiting that URL loads a single-surface WYSIWYG editor with rendered Markdown
- [ ] The user can comfortably edit headings, lists, tables, code blocks, quotes, task lists
- [ ] Autosave writes changes back to the original `.md` file on disk
- [ ] External file modification triggers `_conflict` rename, browser copy saved as authoritative
- [ ] Multiple documents can be registered and edited concurrently in separate tabs
- [ ] Non-Tailscale traffic is rejected
- [ ] Server prints its Tailscale URL on startup
- [ ] All automated tests pass
- [ ] The Tiptap spike VERDICT.md documents round-trip fidelity

---

## What Is NOT in Scope for V1

- MCP server protocol (user explicitly said curl is sufficient)
- Multi-user collaboration / CRDT / operational transform
- Authentication beyond Tailscale network membership
- File browser / directory listing UI
- Creating new files from the browser
- Version history / undo beyond editor session
- Mobile-optimized layout
- Formatting toolbar (keyboard shortcuts only)
- Split-pane or side-by-side editing
- Fallback editors (Milkdown, ProseMirror, etc.)
- Fallback to localhost when Tailscale is unavailable
- Graceful degradation of any kind — fail loud

---

## Open Questions to Resolve During Implementation

1. **Network filtering mechanism**: bind to Tailscale interface IP only, or bind to `0.0.0.0` and filter by source? Phase 1c spike resolves this.
2. **Absolute paths only, or resolve relative?** Recommendation: require absolute paths. Agents always know the absolute path. Relative paths introduce ambiguity about the working directory.
3. **Raw HTML in Markdown**: strip, pass through, or sanitize? Recommendation: strip on import. This is a plan editor.
4. **Should registry survive restarts in v1?** Recommendation: implement JSON persistence if time allows, but it's not blocking. Re-registering documents is a 1-line curl command.
5. **React or vanilla TS for the editor shell?** Decision: React. Tiptap has first-class React bindings (`@tiptap/react`), and the autosave hook pattern maps cleanly to React hooks.

---

## Diff Summary: What This Plan Incorporates From Each Source

### From Agent 1 (original)
- Requirements table with numbered references
- Risk assessment with specific GitHub issue numbers (#5750, #7435)
- Spike as explicit gate with pass/fail criteria
- Data flow diagram
- Curl examples with real commands
- Dev mode vs production mode
- Index page at `/`
- `beforeunload` save trigger
- Package enumeration
- Complexity/effort estimates (dropped — they don't help implementation)

### From Agent 2
- Authoritative vs non-binding distinction for requirements
- "Critical Reading" section identifying tensions and ambiguities
- "Design corrections" meta-section
- TypeScript over JavaScript
- Fail-fast on Tailscale resolution (no localhost fallback)
- Conflict file naming with numeric suffixes for existing conflicts
- Explicit data model with TypeScript interface
- Health endpoint
- Testing strategy with enumerated test cases
- Milestone definition ("V1 is complete when...")
- Network restriction as its own spike
- Open questions structured as implementation-time decisions
- "Recommended default decisions" approach

### From Agent 3
- `CodeBlockLowlight` for syntax highlighting in code blocks
- UI header showing the filename
- Path restriction mentioned as consideration (kept as advisory, not required)
- Concise structure (adopted where it reduced verbosity without losing information)

### New in This Unified Plan
- "No fallbacks" philosophy applied throughout — fail loud at every decision point
- Atomic file writes via `.tmp` + `rename` pattern
- Conflict naming algorithm fully specified with recursive suffix handling
- Dedup by absolute path (secondary index in registry)
- `beforeunload` + autosave interaction specified
- File-deleted-on-disk edge case explicitly handled
- Spike writes to a VERDICT.md file as a permanent record
- Phase structure (not just steps) with clear goals per phase
- Run mode documentation in the startup banner

---

## Bead Reference

All tasks are tracked in the `br` issue tracker. Sprint: `initial`.

### Epics

| ID | Phase | Title |
|----|-------|-------|
| `plan-present-nj9` | 0 | Project Bootstrap |
| `plan-present-adn` | 1 | Server Infrastructure |
| `plan-present-i31` | 2 | Tiptap Markdown Spike (CRITICAL GATE) |
| `plan-present-cri` | 3 | Document Registry |
| `plan-present-tlx` | 4 | Browser Editor |
| `plan-present-hty` | 5 | Autosave & Conflict Handling |
| `plan-present-x44` | 6 | Integration & Polish |
| `plan-present-6ce` | 7 | Testing & Verification |

### All Tasks

| ID | Title | Depends On | Phase |
|----|-------|------------|-------|
| `nj9.1` | npm init + install all deps | (root) | 0 |
| `nj9.2` | TypeScript configs + directory structure | nj9.1 | 0 |
| `adn.1` | Tailscale hostname module | nj9.2 | 1 |
| `adn.2` | Network filtering middleware | nj9.2 | 1 |
| `adn.3` | Express server + health endpoint | adn.1 | 1 |
| `adn.4` | Network restriction spike | adn.2, adn.3 | 1 |
| `i31.1` | Sample markdown fixture | nj9.2 | 2 |
| `i31.2` | Spike script | nj9.2 | 2 |
| `i31.3` | Execute spike + VERDICT.md | i31.1, i31.2 | 2 |
| `cri.1` | Shared TypeScript types | nj9.2 | 3 |
| `cri.2` | Slug generation logic | nj9.2 | 3 |
| `cri.3` | In-memory registry + CRUD | cri.1, cri.2 | 3 |
| `cri.4` | Optional JSON persistence | cri.3 | 3 |
| `tlx.1` | React SPA shell + Vite config | nj9.2 | 4 |
| `tlx.2` | Tiptap editor component | i31.3, tlx.1, cri.1 | 4 |
| `tlx.3` | Editor CSS (Obsidian-inspired) | tlx.2 | 4 |
| `tlx.4` | Save status indicator | tlx.2 | 4 |
| `hty.1` | Conflict resolution module | nj9.2 | 5 |
| `hty.2` | Save endpoint (PUT) | adn.3, cri.3, hty.1 | 5 |
| `hty.3` | Load endpoint (GET) | adn.3, cri.3 | 5 |
| `hty.4` | Registration endpoints (POST/DELETE/LIST) | adn.3, cri.3 | 5 |
| `hty.5` | Client autosave hook | tlx.2 | 5 |
| `hty.6` | beforeunload handler | hty.5 | 5 |
| `x44.1` | SPA serving from Express | adn.3, tlx.1 | 6 |
| `x44.2` | Index page | hty.4 | 6 |
| `x44.3` | Startup banner + logging | adn.3 | 6 |
| `x44.4` | Dev/prod mode config | adn.3, tlx.1 | 6 |
| `6ce.1` | Slug generation unit tests | cri.2 | 7 |
| `6ce.2` | Registry unit tests | cri.3 | 7 |
| `6ce.3` | Conflict handling unit tests | hty.1 | 7 |
| `6ce.4` | API integration tests | hty.2, hty.3, hty.4 | 7 |
| `6ce.5` | Markdown round-trip fixtures | tlx.2 | 7 |
| `6ce.6` | Manual test checklist | adn.4, hty.5, x44.1, x44.2 | 7 |

### Parallelization Map

After bootstrap (`nj9.1` → `nj9.2`), **8 tasks become ready simultaneously**:

```
                    ┌─ adn.1 (Tailscale module)
                    ├─ adn.2 (Network middleware)
                    ├─ i31.1 (Spike sample.md)
nj9.1 → nj9.2 ─────├─ i31.2 (Spike script)
                    ├─ cri.1 (Shared types)
                    ├─ cri.2 (Slug generation)
                    ├─ hty.1 (Conflict module)
                    └─ tlx.1 (SPA shell)
```

This is the maximum parallelism point. Eight independent workstreams can proceed simultaneously. They converge later:

```
adn.1 ──────────────────────────┐
                                ├─ adn.3 (Express server)
                                │     │
adn.2 ─────────────────────────────────├─ adn.4 (Network spike)
                                │     │
cri.1 + cri.2 ─── cri.3 ──────├─────├─ hty.2 (Save endpoint)
                                │     ├─ hty.3 (Load endpoint)
hty.1 ─────────────────────────├─────├─ hty.4 (Reg endpoints)
                                │     │
i31.1 + i31.2 ─── i31.3 ──────├─────│
                                │     │
tlx.1 ─────────────────────────├─────├─ tlx.2 (Editor component)
                                      │     │
                                      │     ├─ tlx.3 (CSS)
                                      │     ├─ tlx.4 (Status indicator)
                                      │     ├─ hty.5 (Autosave) ── hty.6 (beforeunload)
                                      │     └─ 6ce.5 (Round-trip tests)
                                      │
                                      ├─ x44.1 (SPA serving)
                                      ├─ x44.2 (Index page)
                                      ├─ x44.3 (Banner)
                                      ├─ x44.4 (Dev/prod)
                                      └─ 6ce.4 (API tests)

Everything ─── 6ce.6 (Manual tests — final validation)
```

### Critical Path

The longest dependency chain determines the minimum total time:

```
nj9.1 → nj9.2 → i31.2 → i31.3 → tlx.2 → hty.5 → 6ce.6
  │        │        │        │        │        │        │
  └ bootstrap  └ spike script  └ GATE   └ editor  └ autosave  └ final test
```

This is the critical path because the spike gates the editor, and the editor gates the autosave, and the autosave gates the manual test. Everything else runs in parallel alongside this chain.
