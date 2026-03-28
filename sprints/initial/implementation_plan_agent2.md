# Implementation Plan: Remote Markdown Presenter/Editor

## Purpose

Build a long-running local server that lets AI agents register a Markdown file for browser-based review/editing and returns a stable Tailscale URL such as `http://<tailscale-host>:7979/doc/<slug>`. The browser experience should be a single-surface WYSIWYG-style Markdown editor, not a split raw-text/preview view.

This plan is based on `sprints/open/initial/initial_conversation.md`, treating user statements as authoritative. Assistant suggestions are treated as advisory unless the user explicitly accepted them.

## What Is Authoritative

### User requirements and constraints

- The system serves Markdown plans from a VPS so the user can review them in a browser instead of a terminal.
- The page must be editable, not read-only.
- The URL should use the machine's Tailscale hostname and port `7979`.
- The hostname should be discovered when the server starts, then cached in memory or config rather than re-resolved on every request.
- The system should be simple for AI agents to use. It does not need a formal MCP tool if a simple HTTP endpoint usable via `curl` is enough.
- Multiple agents may use the same server concurrently. The design should support multiple open documents on one server/port.
- Document identifiers should not expose the full path.
- The user prefers slugged filenames in the URL over numeric ids:
  - `/doc/unified_plan`
  - `/doc/unified_plan_1` for collisions
- Slugs should omit the file extension and replace URL-incompatible characters with underscores or similar.
- Single-user operation is assumed.
- Autosave with debounce is desired.
- If the source file changes after editing starts, the browser/editor copy is authoritative:
  - rename the existing on-disk file with a `_conflict` suffix
  - save the editor copy under the original filename
- Security should stay simple:
  - no tokens
  - rely on Tailscale network access
  - reject traffic outside the current Tailscale network
- The editing experience should be WYSIWYG-like, similar in spirit to Obsidian:
  - single editing surface
  - Markdown rendered while editing
  - no split-pane raw text preview
- The chosen editor stack is Tiptap.
- Tiptap must support Markdown tables; that concern was explicitly resolved in the conversation.

### Suggestions that should be treated as non-binding

- Restricting served files to configured workspace roots was suggested by the assistant but never explicitly approved by the user.
- A JSON-backed registry was suggested but not required.
- Specific endpoint names like `POST /open` were suggested, not mandated.
- The assistant suggested a temp-file editing model in the browser, but the user only specified the conflict outcome, not the exact implementation strategy.

## Critical Reading Of The Spec

### Clear product direction

- The intended product is not a general document management tool. It is a lightweight single-user utility for agent-driven presentation and editing of Markdown files over Tailscale.
- The user explicitly deprioritized heavyweight security and formal MCP abstractions.
- The user strongly prioritized editing UX over implementation minimalism, which is why plain textarea or split preview approaches should be excluded.

### Tensions and risks in the requested behavior

- "Reject any traffic outside the current Tailscale network" is directionally clear, but technically ambiguous. The plan should define this as allowing only requests arriving on the Tailscale interface or from the Tailscale CGNAT range / MagicDNS-resolved access path, then validate feasibility during implementation.
- "Use filename-based slugs" is user-approved, but slug collision behavior across renamed/moved files needs a deterministic registry rule.
- "Editor copy is authoritative on conflict" is clear, but `_conflict` naming rules are underspecified:
  - preserve extension
  - avoid overwriting an existing conflict file
  - include numeric suffixes if needed
- Tiptap is the selected editor, but Markdown round-tripping fidelity remains the main product risk, especially for tables, fenced code blocks, task lists, and uncommon Markdown formatting.
- The repo is greenfield. There is no existing server, frontend, build tooling, or runtime layout to extend. The plan must therefore include bootstrap choices.

### Design corrections to earlier discussion

- The system should be framed as an HTTP service first, not an MCP server first.
- Numeric document ids should not be used as the primary URL form because the user superseded that preference with filename-based slugs.
- A split editor/preview UI is out of scope.
- Raw `contenteditable` should be avoided; Tiptap is the accepted path.

## Current Repository State

- This repository currently contains sprint notes and metadata, but no application code or scaffold.
- There is no existing package manifest, frontend app, backend app, or tests.
- This should be treated as a greenfield implementation with a small initial footprint.

## Proposed Architecture

### High-level shape

Implement one long-running process on port `7979` with two responsibilities:

1. HTTP API for agent registration and document save/load operations.
2. Browser UI for editing a registered document in a single rendered editing surface.

The same process should serve both API and frontend to keep deployment simple.

### Recommended stack

- Runtime: Node.js
- Language: TypeScript
- HTTP server: a lightweight framework such as Fastify or Express
- Frontend bundler: Vite
- Editor: Tiptap with Markdown support and the extensions needed for:
  - headings
  - paragraphs
  - bold/italic
  - bullet and ordered lists
  - task lists
  - blockquotes
  - code blocks
  - inline code
  - links
  - tables
- Markdown pipeline: Tiptap Markdown support with GFM-enabled table/task-list behavior
- Persistence for registry: start with in-memory registry plus optional JSON snapshot on disk for restart recovery

Rationale:

- Node/TypeScript is the most practical fit for a browser-heavy Tiptap implementation.
- A single-process app reduces orchestration and keeps the agent entrypoint simple.
- Vite is appropriate for a small greenfield UI without adding unnecessary framework weight.

## Functional Design

### 1. Startup

On server startup:

- resolve the machine's Tailscale hostname once
- store it in process memory
- optionally persist it to a local config file for diagnostics
- start the HTTP server on port `7979`
- initialize the document registry

If Tailscale hostname resolution fails, startup should fail clearly rather than silently serving unusable URLs.

### 2. Document registration flow

Agent behavior:

- agent issues an HTTP request with a local Markdown file path
- server validates the request and registers the document
- server returns the browser URL for that document

Server behavior:

- canonicalize the input path to an absolute path
- verify the file exists and is a Markdown file
- derive a slug from the basename without extension
- sanitize unsupported characters to underscores
- resolve collisions with suffixes like `_1`, `_2`
- reuse the same slug if the same file is re-registered and no conflicting mapping exists
- store registry metadata:
  - slug
  - absolute path
  - initial file stat data
  - timestamps

Returned value:

- `http://<tailscale-host>:7979/doc/<slug>`

### 3. Browser document flow

For `GET /doc/<slug>`:

- serve a single-page editor shell
- load the document contents through an API call
- initialize Tiptap from Markdown
- render a single editable document surface

The UI should prioritize function over styling complexity:

- readable typography
- visible save state
- visible conflict/error state
- no split pane
- no multi-document interface inside the page

### 4. Save model

Autosave behavior:

- debounce saves
- only save when the document is dirty
- send serialized Markdown to the server

Server-side save behavior:

- read current on-disk file metadata
- compare against the registered baseline or last-known successful save
- if unchanged, overwrite normally
- if changed externally:
  - rename existing file to conflict variant
  - write incoming Markdown to the original path
  - update registry metadata to the new file version

Conflict filename policy should be deterministic:

- `file_conflict.md`
- if that exists, `file_conflict_1.md`, `file_conflict_2.md`, etc.

### 5. Allowed traffic

The user asked to reject non-Tailscale traffic. Implementation should therefore:

- bind on an address reachable from the browser over Tailscale
- inspect the connection source and reject requests that are not from the Tailscale network/interface

This needs one implementation spike early because the exact enforcement method depends on the VPS network layout. The requirement is valid, but the lowest-friction reliable check must be confirmed in code.

## Suggested HTTP Surface

Exact paths are flexible, but this shape keeps the agent API simple:

- `POST /open`
  - input: `{ "path": "/abs/path/to/file.md" }`
  - output: `{ "url": "http://host:7979/doc/slug", "slug": "slug" }`
- `GET /api/docs/:slug`
  - output: Markdown content and current metadata
- `PUT /api/docs/:slug`
  - input: serialized Markdown plus client save metadata
  - output: save status, conflict outcome if triggered
- `GET /doc/:slug`
  - browser editor page
- `GET /health`
  - simple readiness/status response

Non-goals for v1:

- authentication tokens
- file browsing UI
- collaborative editing
- revision history
- multiple panes/modes

## Data Model

### In-memory registry entry

- `slug`
- `absolutePath`
- `originalBaseName`
- `createdAt`
- `lastOpenedAt`
- `lastSavedAt`
- `lastKnownMtimeMs`
- `lastKnownSize`

### Optional JSON persistence

Useful but not required for the first milestone:

- save registry on open/save/close
- reload on startup to preserve existing slug mappings where practical

This is lower priority than getting the core edit/save flow working.

## UI/Editor Requirements

### Must support well

- headings
- paragraphs
- ordered and unordered lists
- task lists
- blockquotes
- fenced code blocks
- inline code
- emphasis
- links
- Markdown tables

### Expected behavior

- rendered single-surface editing
- editable table cells
- visually distinct code blocks
- stable serialization back to Markdown
- no raw Markdown editing pane

### Known product risk

Tiptap may normalize Markdown formatting on save. That is acceptable only if:

- semantic structure is preserved
- common planning documents remain readable in plain `.md`
- tables, checklists, code fences, and blockquotes round-trip reliably

This should be validated with fixture documents before broadening scope.

## Implementation Phases

### Phase 0: Bootstrap

- initialize Node/TypeScript project structure
- add server and frontend build tooling
- define runtime scripts
- establish a minimal directory layout for server, client, and shared types

### Phase 1: Core server skeleton

- implement startup/config handling
- resolve and cache Tailscale hostname
- bind to port `7979`
- add health endpoint
- add request logging and error handling

### Phase 2: Document registry and `/open`

- implement file path validation and canonicalization
- implement slug generation and collision handling
- register documents in memory
- return stable document URLs

### Phase 3: Browser editor shell

- serve a frontend app from the same process
- implement document loading by slug
- initialize Tiptap with required extensions
- render editable content from Markdown

### Phase 4: Autosave and conflict handling

- implement debounced autosave in the client
- implement save endpoint
- detect external file changes
- implement `_conflict` rename policy
- surface save/conflict state in the UI

### Phase 5: Network restriction

- implement and verify rejection of non-Tailscale requests
- confirm behavior from browser access over Tailscale

### Phase 6: Hardening

- fixture-based round-trip tests for representative Markdown documents
- manual validation of multi-agent registration behavior
- startup diagnostics for hostname and bind state
- basic documentation for agent usage via `curl`

## Testing Strategy

### Automated tests

- slug generation:
  - basename extraction
  - extension stripping
  - invalid character replacement
  - collision suffixing
- registry behavior:
  - same file reopened
  - different files same basename
- save/conflict behavior:
  - unchanged save
  - external modification then save
  - repeated conflict suffixing
- API tests:
  - `/open`
  - load
  - save
  - invalid path/file-type cases
- Markdown round-trip fixtures:
  - headings
  - nested lists
  - task lists
  - blockquotes
  - fenced code blocks
  - tables
  - inline code

### Manual tests

- open a registered document in browser via Tailscale URL
- verify editing stays single-surface and rendered
- verify autosave feedback
- verify code block editing remains usable
- verify table cell editing and row/column operations if enabled
- verify conflict rename behavior using an external file edit
- verify rejection of non-Tailscale traffic

## Open Questions To Resolve During Implementation

- Which concrete mechanism will be used to resolve the Tailscale hostname:
  - `tailscale status --json`
  - `tailscale ip`
  - local API if available
- What exact network rule is the most reliable implementation of "reject traffic outside the current Tailscale network" on the target VPS?
- Should the server require absolute paths only, or accept relative paths and resolve them server-side?
- Should raw HTML inside Markdown be supported, passed through, sanitized, or rejected?
- Should registry state survive server restarts in v1, or is re-registering documents acceptable?
- Which frontend framework, if any, should wrap Tiptap:
  - vanilla TS
  - React

## Recommended Default Decisions

Unless discovery during implementation contradicts them, use these defaults:

- Node.js + TypeScript
- one combined server/frontend app
- React + Vite for the editor shell
- Fastify for the HTTP server
- absolute file paths in `/open`
- in-memory registry first, JSON persistence second
- fail-fast startup if Tailscale hostname cannot be resolved
- restrict accepted files to `.md` and `.markdown`

## Milestone Definition For A Good V1

V1 is complete when all of the following are true:

- an agent can `POST /open` with a Markdown file path
- the response contains a working Tailscale URL on port `7979`
- visiting that URL loads a single-surface rendered editor
- the user can edit normal planning Markdown comfortably
- autosave writes back to the original file
- external modification triggers the `_conflict` rename flow and preserves the editor copy as authoritative
- multiple registered documents can coexist under distinct slugs on the same server
- non-Tailscale traffic is rejected

## Final Assessment

This is a feasible small product, but only if implemented as a focused HTTP service with a Tiptap-based editor and disciplined scope control. The main technical risk is Markdown round-tripping fidelity, not server plumbing. The implementation plan should therefore prioritize an early editor/save spike before polishing secondary concerns like registry persistence or UI refinement.
