# Implementation Plan - Plan Present (Agent 3)

This plan outlines the implementation of a WYSIWYG Markdown editor/presenter designed for use on a VPS via Tailscale.

## 1. Overview
The goal is to provide a single-surface, rich-text editing experience for Markdown files, served over a stable Tailscale URL on port 7979. This allows AI agents to present implementation plans in a visually pleasing and editable format.

## 2. Architecture

### 2.1 Backend (Node.js/Express)
- **Long-running Server:** Listens on port 7979.
- **Tailscale Hostname Resolution:** At startup, runs `tailscale status --json` to resolve the MagicDNS hostname (e.g., `flywheel.tail2a835b.ts.net`).
- **Document Registry:** An in-memory mapping (with optional JSON persistence) of `slug` -> `absolute_file_path`.
- **API Endpoints:**
    - `POST /open`: Accepts a JSON body with a `path`. Generates a slug from the filename, registers it, and returns the full URL.
    - `GET /api/doc/:slug`: Returns the Markdown content of the file and its last modified time (`mtime`).
    - `POST /api/doc/:slug`: Receives updated Markdown. Performs conflict detection by checking if the current `mtime` on disk matches the one sent by the client. If not, renames the original file to `*_conflict.md` before saving the new content.
- **Static Assets:** Serves the frontend bundle.

### 2.2 Frontend (React + Tiptap)
- **Single Page Application:** A minimalist UI focused on the editor.
- **Tiptap Editor:** Configured with:
    - `StarterKit`
    - `Markdown` extension (for round-tripping)
    - `Table`, `TableRow`, `TableCell`, `TableHeader` (GFM support)
    - `CodeBlockLowlight` (for code blocks)
    - `TaskItem`, `TaskList` (for checklists)
- **State Management:**
    - Loads content from `/api/doc/:slug`.
    - Tracks `mtime` for conflict detection.
- **Autosave:** Implements a debounced save function (e.g., 2 seconds) that calls `POST /api/doc/:slug`.
- **Conflict Handling:** If the backend returns a conflict status, notify the user that a conflict occurred and the original was renamed.

## 3. Detailed Implementation Steps

### Step 1: Project Initialization
- Initialize a Node.js project.
- Setup the directory structure:
    - `server/`: Express backend code.
    - `client/`: React frontend code (built with Vite).
- Install dependencies.

### Step 2: Backend Development
- Implement Tailscale hostname discovery.
- Implement the document registry logic (slug generation, collision handling).
- Create the `POST /open` endpoint.
- Create the file I/O endpoints with conflict detection logic.
- Setup static file serving for the production build of the frontend.

### Step 3: Frontend Development
- Setup Tiptap with the required extensions (especially Markdown and Tables).
- Create a basic layout (header with filename, main editor area).
- Implement data fetching and autosave logic.
- Style with Vanilla CSS for a clean, Obsidian-like look.

### Step 4: Integration & Testing
- Ensure the `curl` workflow works as expected.
- Test the conflict handling by manually modifying a file on disk while it's open in the editor.
- Verify Tailscale accessibility.

## 4. Security & Constraints
- **Binding:** Bind the server to `0.0.0.0` but ensure it's only accessible via Tailscale (or rely on the user's Tailscale configuration for firewalling).
- **Path Restriction:** Only allow opening files within the project root or specified allowed directories to prevent arbitrary file access.
- **Single User:** The system assumes turn-based access (either AI or User is editing, not both simultaneously).

## 5. Future Enhancements (Post-MVP)
- Read-only mode toggle.
- Better UI for conflict resolution (diff view).
- Persistent registry across server restarts.
