---
id: cr-002
title: File list directory column flexible width
status: Completed
---

## Summary

After CR-001 expanded the home page to full viewport width, the directory column remained locked at 14ch due to explicit `width`, `min-width`, and `max-width` constraints in the inline CSS. It should grow with the wider table.

## Change

In `src/server/index.ts`, removed the three fixed-width properties from `td.dir`, keeping only `white-space:normal` and `word-break:break-all` so the column flexes naturally with available table width.

## Acceptance criteria

- Directory column grows with the table on wide viewports
- Long paths still wrap rather than overflow
