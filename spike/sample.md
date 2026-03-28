# Plan Present — Spike Fixture

This document is a **realistic implementation plan** fixture for validating Markdown round‑trip behavior.
It includes *all* required constructs: headings, nested lists, tables, task lists, code blocks, blockquotes,
links, and mixed sequences. Inline example: `POST /open` and a link to [Tailscale](https://tailscale.com/).

---

## 1. Overview

The goal is to serve editable Markdown over a single long‑running server. The browser must display a
WYSIWYG editor while preserving the Markdown file as the source of truth.

### 1.1 Success Criteria

- The server starts and prints a clear startup banner.
- The editor renders Markdown *as you type* (single surface).
- Autosave never corrupts the file.

## 2. Requirements Table

| Requirement | Description | Priority |
| --- | --- | --- |
| R1 | Single server on port `7979` | P0 |
| R2 | Tailscale hostname resolved once at startup | P0 |
| R3 | URL format `http://<tailscale>:7979/doc/<slug>` | P0 |
| R4 | Slug from filename, collisions `_1`, `_2`, ... | P0 |
| R5 | Reject non‑Tailscale traffic in production | P1 |

## 3. Detailed Steps

### 3.1 Bootstrap

1. Initialize project with TypeScript + Vite.
   1. Install dependencies in a single `npm install`.
   2. Add scripts: `dev`, `build`, `start`, `spike`.
2. Create directory layout:
   - `src/server/`
     - `index.ts`
     - `network.ts`
   - `src/client/`
     - `index.html`
     - `App.tsx`
   - `spike/`

### 3.2 Server Skeleton

- Start Express on `0.0.0.0:7979`.
- Add `/health` endpoint returning `{ ok: true }`.
- Fail fast on bind errors.

> **Note:** This server is intentionally strict. If hostname resolution fails, the process must exit.
>
> > Nested note: the startup banner must show the full Tailscale URL.

### 3.3 Editor Shell

- Render a React root at `#root`.
- Show a placeholder if `slug` is missing.
- Load content from `GET /api/doc/:slug`.

### 3.4 Autosave Tasks

- [ ] Implement debounce (2s).
- [ ] Save on `beforeunload`.
- [x] Decide conflict policy (`_conflict.md`).

## 4. Mixed Sequences

Here is a list followed by a table, then a heading after a code block.

- Bullet A
  - Nested A.1
  - Nested A.2
- Bullet B

| Column | Value |
| --- | --- |
| Alpha | 1 |
| Beta | 2 |

```bash
# Register a document
curl -s -X POST http://localhost:7979/open \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/plan.md"}'
```

### 4.1 Heading After Code Block

This section exists to verify headings are preserved after fenced code blocks.

## 5. Risks

1. **Tables may not round‑trip.**
   - If tables lose structure, the spike must fail loudly.
2. **Markdown normalization.**
   - Formatting changes are acceptable if semantics remain intact.

## 6. Footer

Final check: *emphasis*, **bold**, `inline code`, and a link to
[OpenAI](https://openai.com/). Horizontal rule below.

---

