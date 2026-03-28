# Tiptap Markdown Spike — VERDICT

Date: 2026-03-28

## Package Versions Tested
- @tiptap/core 3.21.0
- @tiptap/pm 3.21.0
- @tiptap/react 3.21.0
- @tiptap/starter-kit 3.21.0
- @tiptap/markdown 3.21.0
- @tiptap/extension-table 3.21.0
- @tiptap/extension-table-row 3.21.0
- @tiptap/extension-table-cell 3.21.0
- @tiptap/extension-table-header 3.21.0
- @tiptap/extension-task-list 3.21.0
- @tiptap/extension-task-item 3.21.0
- @tiptap/extension-code-block-lowlight 3.21.0
- lowlight 3.3.0

## Summary (Re-run 2026-03-28)
Spike output: PASS 10, NORMALIZED 2, FAIL 0.

**All constructs pass.** Tables round-trip with content and structure preserved (formatting normalized).

### Root Cause of Original Failure
The table extensions were imported using **default imports** (`import Table from "@tiptap/extension-table"`)
but these packages only export **named exports**. Default imports resolved to `undefined` at runtime,
so the editor had no table schema or serializer registered. Fix: use `import { Table } from ...`.

## Per‑Construct Verdicts

| Construct | Input Snippet | Output Snippet | Verdict |
| --- | --- | --- | --- |
| H1 heading | `# Plan Present — Spike Fixture` | `# Plan Present — Spike Fixture` | PASS |
| H2 heading | `## 1. Overview` | `## 1. Overview` | PASS |
| H3 heading | `### 1.1 Success Criteria` | `### 1.1 Success Criteria` | PASS |
| Inline formatting | `**realistic implementation plan**` | `**realistic implementation plan**` | PASS |
| Links | `[Tailscale](https://tailscale.com/)` | `[Tailscale](https://tailscale.com/)` | PASS |
| Task list | `- [ ] Implement debounce (2s).` | `- [ ] Implement debounce (2s).` | PASS |
| Code block | <code>```bash</code> | <code>```bash</code> | PASS |
| Blockquote | `> **Note:** This server is intentionally strict.` | `> **Note:** This server is intentionally strict.` | PASS |
| Horizontal rule | `---` | `---` | PASS |
| Requirements table | `| Requirement | Description | Priority |` | Content preserved, column padding normalized | NORMALIZED |
| Mixed‑sequence table | `| Column | Value |` | Content preserved, column padding normalized | NORMALIZED |
| Heading after code block | `### 4.1 Heading After Code Block` | `### 4.1 Heading After Code Block` | PASS |

## Evidence Notes
- Tables round-trip with all cell content and structure intact.
- "NORMALIZED" means the serializer re-pads columns for alignment — content is identical.
- The `@tiptap/extension-table` v3.21.0 ships a built-in `renderTableToMarkdown` serializer that works correctly.

## Decision
**GO.** All constructs pass. Proceed to Phase 4 editor work.
Use **named imports** (`import { Table }`) for all `@tiptap/extension-*` packages.
