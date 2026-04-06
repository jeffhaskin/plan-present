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

```bash
npm install
```

### Development

```bash
npm run dev
```

Starts the Express server with TypeScript watch compilation and Vite dev server on port 7979.

### Production

```bash
npm run build
npm start
```

### Tests

```bash
npm test
```

## Architecture

plan-present has two components:

1. **Web server** (Express, port 7979) &mdash; serves the editor UI and REST API. This must be running for anything to work.
2. **MCP server** (`src/mcp-server.ts`) &mdash; a thin stdio-based MCP wrapper that calls the web server's REST API. This is what Claude Code connects to.

The MCP server does not serve files or run the editor itself &mdash; it's a client of the web server. Both must be running.

## Setup

### 1. Start the web server

The Express server must be running in the background. A tmux session works well:

```bash
tmux new-session -d -s plan-present -c /data/projects/plan-present "npm run dev"
```

### 2. Connect Claude Code via MCP

Add the MCP server to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "plan-present": {
      "command": "npx",
      "args": [
        "tsx",
        "/data/projects/plan-present/src/mcp-server.ts"
      ],
      "description": "Open markdown files for WYSIWYG browser editing"
    }
  }
}
```

This registers `open_document`, `list_documents`, and `close_document` as MCP tools that Claude can call natively.

#### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAN_PRESENT_URL` | `http://flywheel.tail2a835b.ts.net:7979` | Base URL of the running web server |

Set `PLAN_PRESENT_URL` if your Tailscale hostname or port differs from the default.

### Alternative: CLAUDE.md curl instruction (no MCP)

If you don't want to set up the MCP server, you can add a curl instruction to your `CLAUDE.md` so Claude uses the REST API directly:

```markdown
## plan-present

When you want to open a markdown file for visual editing in the browser:

\```bash
curl -s -X POST http://<tailscale-host>:7979/open \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/file.md"}'
\```
```

This works but is less ergonomic &mdash; Claude has to be told when to use it, and there's no tool-level integration for `list_documents` or `close_document`.

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
