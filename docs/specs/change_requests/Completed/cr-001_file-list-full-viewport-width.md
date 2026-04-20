---
id: cr-001
title: File list full viewport width
status: Completed
---

## Summary

The home-page file list table should fill the full viewport width instead of being capped at 960px, with 100px padding on each side. The layout should remain centered for very wide viewports.

## Change

In `src/server/index.ts`, the inline `<style>` for the home page sets `body{max-width:960px;...}`. Remove that constraint and replace the body padding with `100px` on each side.

## Acceptance criteria

- Table width = viewport width minus 200px (100px each side)
- Content is horizontally centered
- No horizontal scrollbar on typical viewports
