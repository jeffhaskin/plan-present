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

## Summary
Spike output: PASS 10, NORMALIZED 0, FAIL 2.

**Critical failure:** Both tables were removed during round‑trip serialization.

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
| Requirements table | `| Requirement | Description | Priority |` | _Table removed; only `## 2. Requirements Table` remains_ | FAIL |
| Mixed‑sequence table | `| Column | Value |` | _Table removed; list jumps straight to code block_ | FAIL |
| Heading after code block | `### 4.1 Heading After Code Block` | `### 4.1 Heading After Code Block` | PASS |

## Evidence Notes
- The round‑tripped output contains the **table section headings only**, with **no table rows**.
- All other constructs survived, but the table loss is a hard stop per the spike gate.

## Decision
**STOP.** Table round‑trip fails (content + structure loss). Do **not** proceed to Phase 4 editor work.
Escalate to the user with this evidence and await direction.
