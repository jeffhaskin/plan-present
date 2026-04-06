# plan-present

A WYSIWYG Markdown editor and MCP server for remote development workflows. When AI assistants generate Markdown plans on a VPS, this tool lets you view and edit them in a rich browser interface while keeping the source `.md` file on disk.

**Core workflow:** AI passes a file path to an MCP tool &rarr; server registers the document and returns a URL &rarr; you open the URL in a browser and edit with full formatting &rarr; autosave keeps the disk file in sync.

## Features

- **Rich editor** &mdash; Tiptap-based single-surface editor (like Obsidian) with headings, lists, tables, task lists, code blocks with syntax highlighting
- **MCP integration** &mdash; `open_document`, `list_documents`, `close_document` tools for AI assistants
- **Autosave with conflict detection** &mdash; debounced saves to disk, mtime-based conflict detection with automatic backup of external changes
- **Document registry** &mdash; SQLite-backed registry with slug-based URLs and deduplication
- **Tailscale networking** &mdash; auto-discovers hostname, serves URLs accessible only via your tailnet
- **REST API** &mdash; `POST /open`, `GET/PUT/DELETE /api/doc/:slug`, `GET /api/docs`

## Tech Stack

- **Backend:** Express 5, TypeScript, SQLite3, MCP SDK
- **Frontend:** React 19, Vite, Tiptap 3, Lowlight (syntax highlighting)
- **Infrastructure:** Tailscale, port 7979

## Getting Started

### Prerequisites

- **Node.js** &ge; 18
- **npm**
- **Tailscale** &mdash; the server binds to `0.0.0.0:7979` but constructs URLs using your Tailscale hostname. You must be connected to a tailnet.

### Install & Build

```bash
npm install
npm run build          # REQUIRED — builds both the server (tsc) and client (vite)
```

The `npm run build` step compiles TypeScript **and** bundles the React frontend into `dist/client/`. The Express server serves the editor UI from `dist/client/` in all modes, so **if you skip the build, the editor pages will 404**.

### Running

```bash
# Development (auto-restarts on server-side TS changes):
npm run dev

# Production:
npm start
```

> **Note:** `npm run dev` uses `tsx watch` to auto-restart the Express server when server-side TypeScript changes. However, it does **not** run a Vite dev server &mdash; the client is always served from the `dist/client/` build output. If you change client code, you must re-run `npm run build` for changes to take effect.

### Tests

```bash
npm test
```

## Architecture

plan-present has two components:

1. **Web server** (Express, port 7979) &mdash; serves the editor UI and REST API. This must be running for anything to work. The server always serves the React client from `dist/client/` (the Vite build output), so `npm run build` is a prerequisite.
2. **MCP server** (`src/mcp-server.ts`) &mdash; an optional thin stdio-based MCP wrapper that calls the web server's REST API. Alternative to using curl via CLAUDE.md.

The MCP server does not serve files or run the editor itself &mdash; it's a client of the web server.

## Setup

### 1. Install and build

```bash
cd /path/to/plan-present
npm install
npm run build
```

### 2. Start the web server

The Express server must be running in the background before anything else works. A tmux session works well:

```bash
tmux new-session -d -s plan-present -c /path/to/plan-present "npm run dev"
```

Verify it's running:

```bash
curl -s http://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'):7979/health
```

You should see `{"ok":true, ...}`.

### 3. Connect to Claude Code

#### Option A: CLAUDE.md curl instruction (recommended)

Add this to your `~/.claude/CLAUDE.md` (or project-level `CLAUDE.md`), replacing `<tailscale-host>` with your machine's Tailscale hostname:

```markdown
## plan-present &mdash; Open a Markdown File for Browser Editing

When you want to open a markdown file for visual editing in the browser, register it with the plan-present server:

\```bash
curl -s -X POST http://<tailscale-host>:7979/open \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/file.md"}'
\```

Returns `{"url":"...","slug":"..."}` &mdash; open the URL in a browser to edit.
```

This is the simplest integration. Claude uses the REST API directly via curl. No MCP configuration needed.

#### Option B: MCP server

The MCP server (`src/mcp-server.ts`) is a thin stdio-based wrapper that calls the web server's REST API. Add it to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "plan-present": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/plan-present/src/mcp-server.ts"
      ],
      "env": {
        "PLAN_PRESENT_URL": "http://<tailscale-host>:7979"
      },
      "description": "Open markdown files for WYSIWYG browser editing"
    }
  }
}
```

**Important:** You must set `PLAN_PRESENT_URL` in the `env` block to your machine's Tailscale hostname. The default (`http://flywheel.tail2a835b.ts.net:7979`) will not work on other machines.

This registers `open_document`, `list_documents`, and `close_document` as MCP tools.

## Updating

If plan-present is already installed and you need to pull the latest version and rebuild:

```bash
cd /path/to/plan-present
git pull origin main
npm install
npm run build
```

Then restart the server. If it's running in a tmux session:

```bash
tmux kill-session -t plan-present
tmux new-session -d -s plan-present -c /path/to/plan-present "npm run dev"
```

### For Claude Code agents

If you are an AI assistant updating this tool on behalf of a user, run these steps in order:

```bash
# 1. Pull latest code
cd /path/to/plan-present && git pull origin main

# 2. Install any new/changed dependencies
npm install

# 3. Rebuild (REQUIRED — the client is served from dist/client/)
npm run build

# 4. Restart the server (adjust the tmux session name if different)
tmux kill-session -t plan-present 2>/dev/null
tmux new-session -d -s plan-present -c /path/to/plan-present "npm run dev"

# 5. Verify the server is healthy
sleep 2 && curl -s http://localhost:7979/health
```

The `npm run build` step is **not optional** — it compiles the TypeScript server and bundles the React frontend. Skipping it means the editor UI will serve stale assets or 404.

## MCP Tools

| Tool | Description |
|------|-------------|
| `open_document(path)` | Register a `.md` file and get a browser URL for editing |
| `list_documents()` | List all registered documents with their URLs |
| `close_document(slug)` | Unregister a document (does not delete the file on disk) |

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/open` | Register a document (`{"path": "/abs/path.md"}`) |
| `GET` | `/api/docs` | List all registered documents |
| `GET` | `/api/doc/:slug` | Load document content |
| `PUT` | `/api/doc/:slug` | Save document (with conflict detection) |
| `DELETE` | `/api/doc/:slug` | Unregister a document |
| `GET` | `/health` | Server health check |

## License

Private
