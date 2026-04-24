import fs from "fs";
import path from "path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { getTailscaleHostname } from "./tailscale";
import { tailscaleOnly } from "./network";
import {
  registerDocument,
  getDocument,
  getDocumentByPath,
  listDocuments,
  removeDocument,
  setPinned,
  movePriority,
  loadFromDisk,
} from "./registry";
import { saveWithConflictDetection } from "./conflict";

const PORT = 7979;
const HOST = "0.0.0.0";
const VERSION = "0.1.0";

function getMode(): string {
  if (
    process.env.NODE_ENV === "development" ||
    process.argv.includes("--dev") ||
    process.argv.includes("--mode=dev")
  ) {
    return "development";
  }
  return "production";
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
}

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use(tailscaleOnly);

const tailscaleHost = getTailscaleHostname();
const mode = getMode();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    tailscaleHost,
    docCount: listDocuments().length,
    uptime: process.uptime(),
  });
});

// POST /open — register a document and return its URL
app.post("/open", (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "path is required" });
    return;
  }
  if (!path.isAbsolute(filePath)) {
    res.status(400).json({ error: "path must be absolute" });
    return;
  }
  try {
    const entry = registerDocument(filePath);
    const url = `http://${tailscaleHost}:${PORT}/doc/${entry.slug}`;
    res.json({ url, slug: entry.slug });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /open/dir — register all *.md files in a directory
app.post("/open/dir", (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath || typeof dirPath !== "string") {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const absDir = path.isAbsolute(dirPath) ? dirPath : path.resolve(process.cwd(), dirPath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (err: any) {
    res.status(400).json({ error: `Cannot read directory: ${err.message}` });
    return;
  }
  const mdFiles = entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => path.join(absDir, e.name));
  if (mdFiles.length === 0) {
    res.json({ registered: [], skipped: [], message: "No .md files found" });
    return;
  }
  const registered: { file: string; url: string; slug: string }[] = [];
  const alreadyRegistered: { file: string; url: string; slug: string }[] = [];
  const skipped: { file: string; error: string }[] = [];
  for (const filePath of mdFiles) {
    const abs = path.resolve(filePath);
    const existing = getDocumentByPath(abs);
    if (existing) {
      alreadyRegistered.push({ file: filePath, url: `http://${tailscaleHost}:${PORT}/doc/${existing.slug}`, slug: existing.slug });
      continue;
    }
    try {
      const entry = registerDocument(filePath);
      registered.push({ file: filePath, url: `http://${tailscaleHost}:${PORT}/doc/${entry.slug}`, slug: entry.slug });
    } catch (err: any) {
      skipped.push({ file: filePath, error: err.message });
    }
  }
  res.json({ registered, alreadyRegistered, skipped });
});

// GET /api/docs — list all registered documents
app.get("/api/docs", (_req, res) => {
  const docs = listDocuments().map((entry) => ({
    slug: entry.slug,
    fileName: entry.originalBaseName,
    absolutePath: entry.absolutePath,
    url: `http://${tailscaleHost}:${PORT}/doc/${entry.slug}`,
  }));
  res.json(docs);
});

// GET /api/doc/:slug — load a document
app.get("/api/doc/:slug", (req, res) => {
  const entry = getDocument(req.params.slug);
  if (!entry) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  try {
    const content = fs.readFileSync(entry.absolutePath, "utf-8");
    const stat = fs.statSync(entry.absolutePath);
    res.json({
      content,
      mtime: stat.mtimeMs,
      slug: entry.slug,
      fileName: entry.originalBaseName,
      absolutePath: entry.absolutePath,
    });
  } catch {
    removeDocument(req.params.slug);
    res.status(404).json({ error: "File no longer exists on disk", removed: true });
  }
});

// PUT /api/doc/:slug — save a document with conflict detection
app.put("/api/doc/:slug", (req, res) => {
  const entry = getDocument(req.params.slug);
  if (!entry) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const { content, baseMtime } = req.body;
  if (typeof content !== "string" || typeof baseMtime !== "number") {
    res.status(400).json({ error: "content (string) and baseMtime (number) are required" });
    return;
  }
  const result = saveWithConflictDetection(entry.absolutePath, content, baseMtime);
  entry.lastSavedAt = new Date().toISOString();
  entry.lastKnownMtimeMs = result.mtime;
  res.json({
    saved: result.saved,
    conflict: result.conflict,
    mtime: result.mtime,
    conflictPath: result.conflictPath,
    recreated: result.recreated,
  });
});

// POST /api/doc/:slug/pin — pin or unpin (pinning appends the next priority slot)
app.post("/api/doc/:slug/pin", (req, res) => {
  const { pinned } = req.body;
  if (typeof pinned !== "boolean") {
    res.status(400).json({ error: "pinned (boolean) is required" });
    return;
  }
  const result = setPinned(req.params.slug, pinned);
  if (!result) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({
    entry: {
      slug: result.entry.slug,
      pinned: !!result.entry.pinned,
      priorityPin: result.entry.priorityPin ?? null,
    },
    affected: result.affected.map((e) => ({
      slug: e.slug,
      pinned: !!e.pinned,
      priorityPin: e.priorityPin ?? null,
    })),
  });
});

// POST /api/doc/:slug/pin/move — reorder pinned item (swap for up/down, shift for top/bottom)
app.post("/api/doc/:slug/pin/move", (req, res) => {
  const { direction } = req.body;
  if (direction !== "up" && direction !== "down" && direction !== "top" && direction !== "bottom") {
    res.status(400).json({ error: "direction must be 'up', 'down', 'top', or 'bottom'" });
    return;
  }
  const result = movePriority(req.params.slug, direction);
  if (!result) {
    res.status(404).json({ error: "Document not found or not prioritized" });
    return;
  }
  res.json({
    entry: {
      slug: result.entry.slug,
      pinned: !!result.entry.pinned,
      priorityPin: result.entry.priorityPin ?? null,
    },
    affected: result.affected.map((e) => ({
      slug: e.slug,
      pinned: !!e.pinned,
      priorityPin: e.priorityPin ?? null,
    })),
  });
});

// DELETE /api/doc/:slug — unregister a document
app.delete("/api/doc/:slug", (req, res) => {
  const removed = removeDocument(req.params.slug);
  if (!removed) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ removed: true });
});

// DELETE /api/doc/:slug/file — unregister and delete the file from disk
app.delete("/api/doc/:slug/file", (req, res) => {
  const entry = getDocument(req.params.slug);
  if (!entry) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const { absolutePath } = entry;
  removeDocument(req.params.slug);
  try {
    fs.unlinkSync(absolutePath);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      res.status(500).json({ error: `Failed to delete file: ${err.message}` });
      return;
    }
  }
  res.json({ deleted: true });
});

// GET / — index page listing registered documents
app.get("/", (_req, res) => {
  const docs = [...listDocuments()].sort((a, b) => {
    const ap = typeof a.priorityPin === "number" ? a.priorityPin : null;
    const bp = typeof b.priorityPin === "number" ? b.priorityPin : null;
    if (ap !== null && bp === null) return -1;
    if (ap === null && bp !== null) return 1;
    if (ap !== null && bp !== null && ap !== bp) return ap - bp;
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.registeredAt.localeCompare(a.registeredAt);
  });
  const tailscaleUrl = `http://${tailscaleHost}:${PORT}`;

  if (docs.length === 0) {
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="icon" href="/icon_dark.png"><title>plan-present</title>
<script>(function(){try{var t=localStorage.getItem('plan-present-theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})()</script>
<style>:root{--bg:#fff;--fg:#333;--fg-muted:#555;--surface:#f4f4f4;--border:#eee;--link:#0066cc;--btn-bg:#f5f5f5;--btn-border:#ccc;--btn-fg:#444}[data-theme=dark]{--bg:#1a1a1a;--fg:#d8d8d8;--fg-muted:#888;--surface:#252525;--border:#333;--link:#5599ee;--btn-bg:#2a2a2a;--btn-border:#444;--btn-fg:#bbb}
body{font-family:system-ui,sans-serif;margin:2rem auto;padding:0 100px;color:var(--fg);background:var(--bg)}
code{background:var(--surface);padding:2px 6px;border-radius:3px}pre{background:var(--surface);padding:1rem;border-radius:6px;overflow-x:auto}
.btn-theme-toggle{position:fixed;top:10px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;background:var(--btn-bg);border:1px solid var(--btn-border);border-radius:6px;color:var(--btn-fg);cursor:pointer}
.theme-icon-light{display:inline;vertical-align:middle;filter:drop-shadow(0 0 2px rgba(0,0,0,0.25))}.theme-icon-dark{display:none;vertical-align:middle;filter:drop-shadow(0 0 2px rgba(255,255,255,0.25))}[data-theme=dark] .theme-icon-light{display:none}[data-theme=dark] .theme-icon-dark{display:inline}</style></head>
<body><button id="theme-btn" class="btn-theme-toggle" aria-label="Toggle dark mode"><svg id="theme-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="18" height="18" fill="currentColor"><path id="theme-path"/></svg></button>
<h1><img src="/icon_dark.png" class="theme-icon-dark" style="height:1em;margin-right:0.35em"><img src="/icon_light.png" class="theme-icon-light" style="height:1em;margin-right:0.35em">plan-present</h1>
<p>No documents registered yet.</p>
<p>Register a markdown file with:</p>
<pre><code>curl -X POST ${tailscaleUrl}/open \\
  -H 'Content-Type: application/json' \\
  -d '{"path": "/absolute/path/to/your/file.md"}'</code></pre>
<p>Then visit the returned URL to edit it in the browser.</p>
<script>
(function(){
var SOLID="M272 384c9.6-31.9 29.5-59.1 49.2-86.2c0 0 0 0 0 0c5.2-7.1 10.4-14.2 15.4-21.4c19.8-28.5 31.4-63 31.4-100.3C368 78.8 289.2 0 192 0S16 78.8 16 176c0 37.3 11.6 71.9 31.4 100.3c5 7.2 10.2 14.3 15.4 21.4c0 0 0 0 0 0c19.8 27.1 39.7 54.4 49.2 86.2l160 0zM192 512c44.2 0 80-35.8 80-80l0-16-160 0 0 16c0 44.2 35.8 80 80 80zM112 176c0 8.8-7.2 16-16 16s-16-7.2-16-16c0-61.9 50.1-112 112-112c8.8 0 16 7.2 16 16s-7.2 16-16 16c-44.2 0-80 35.8-80 80z";
var REGULAR="M297.2 248.9C311.6 228.3 320 203.2 320 176c0-70.7-57.3-128-128-128S64 105.3 64 176c0 27.2 8.4 52.3 22.8 72.9c3.7 5.3 8.1 11.3 12.8 17.7c0 0 0 0 0 0c12.9 17.7 28.3 38.9 39.8 59.8c10.4 19 15.7 38.8 18.3 57.5L109 384c-2.2-12-5.9-23.7-11.8-34.5c-9.9-18-22.2-34.9-34.5-51.8c0 0 0 0 0 0s0 0 0 0c-5.2-7.1-10.4-14.2-15.4-21.4C27.6 247.9 16 213.3 16 176C16 78.8 94.8 0 192 0s176 78.8 176 176c0 37.3-11.6 71.9-31.4 100.3c-5 7.2-10.2 14.3-15.4 21.4c0 0 0 0 0 0s0 0 0 0c-12.3 16.8-24.6 33.7-34.5 51.8c-5.9 10.8-9.6 22.5-11.8 34.5l-48.6 0c2.6-18.7 7.9-38.6 18.3-57.5c11.5-20.9 26.9-42.1 39.8-59.8c0 0 0 0 0 0s0 0 0 0c4.7-6.4 9-12.4 12.7-17.7zM192 128c-26.5 0-48 21.5-48 48c0 8.8-7.2 16-16 16s-16-7.2-16-16c0-44.2 35.8-80 80-80c8.8 0 16 7.2 16 16s-7.2 16-16 16zm0 384c-44.2 0-80-35.8-80-80l0-16 160 0 0 16c0 44.2-35.8 80-80 80z";
var dark=document.documentElement.getAttribute('data-theme')==='dark';
var path=document.getElementById('theme-path');
function apply(d){document.documentElement.setAttribute('data-theme',d?'dark':'light');try{localStorage.setItem('plan-present-theme',d?'dark':'light');}catch(e){}path.setAttribute('d',d?REGULAR:SOLID);dark=d;}
apply(dark);
document.getElementById('theme-btn').addEventListener('click',function(){apply(!dark);});
})();
</script>
</body></html>`);
    return;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtTs = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return iso;
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  };

  const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  const COPY_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>";
  const CHECK_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>";
  const RESET_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='23 4 23 10 17 10'/><polyline points='1 20 1 14 7 14'/><path d='M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'/></svg>";
  const TRASH_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><line x1='10' y1='11' x2='10' y2='17'/><line x1='14' y1='11' x2='14' y2='17'/></svg>";

  const rows = docs
    .map((d) => {
      const dir = path.dirname(d.absolutePath);
      return `<tr data-pinned="${d.pinned ? "true" : "false"}" data-priority="${d.priorityPin ?? ""}" data-name="${escAttr(d.originalBaseName)}"><td class="pin-col"><div class="pin-controls"><button type="button" class="pin-btn${d.pinned ? " pinned" : ""}" data-slug="${d.slug}" title="${d.pinned ? "Unpin" : "Pin"}" aria-label="${d.pinned ? "Unpin" : "Pin"}">\u{1F4CC}</button><button type="button" class="prio-move prio-top" data-slug="${d.slug}" data-direction="top" title="${d.pinned ? "Move to top" : "Pin & move to top"}">\u2912</button><button type="button" class="prio-move prio-up" data-slug="${d.slug}" data-direction="up" title="Move up"${d.pinned ? "" : " disabled"}>\u25B2</button><button type="button" class="prio-move prio-down" data-slug="${d.slug}" data-direction="down" title="Move down"${d.pinned ? "" : " disabled"}>\u25BC</button><button type="button" class="prio-move prio-bottom" data-slug="${d.slug}" data-direction="bottom" title="Move to bottom"${d.pinned ? "" : " disabled"}>\u2913</button></div></td><td class="actions-col"><button type="button" class="row-action row-reset" data-slug="${d.slug}" title="Deregister (remove from list; file stays on disk)" aria-label="Deregister">${RESET_SVG}</button><button type="button" class="row-action row-delete" data-slug="${d.slug}" title="Delete file from disk" aria-label="Delete file">${TRASH_SVG}</button></td><td><a href="/doc/${d.slug}">${d.originalBaseName}</a><button type="button" class="row-action dir-copy-btn" data-path="${escAttr(d.absolutePath)}" title="Copy full pathname" aria-label="Copy full pathname">${COPY_SVG}</button></td><td class="dir"><code>${dir}</code></td><td>${fmtTs(d.registeredAt)}</td></tr>`;
    })
    .join("\n");

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="icon" href="/icon_dark.png"><title>plan-present</title>
<script>(function(){try{var t=localStorage.getItem('plan-present-theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})()</script>
<style>:root{--bg:#fff;--fg:#333;--fg-muted:#666;--surface:#f4f4f4;--border:#eee;--link:#0066cc;--btn-bg:#f5f5f5;--btn-border:#ccc;--btn-fg:#444;--sel-bg:#fafafa;--sort-fg:#999;--prio-bg:#fff;--prio-fg:#666;--prio-border:#ddd}[data-theme=dark]{--bg:#1a1a1a;--fg:#d8d8d8;--fg-muted:#aaa;--surface:#252525;--border:#333;--link:#5599ee;--btn-bg:#2a2a2a;--btn-border:#444;--btn-fg:#bbb;--sel-bg:#2a2a2a;--sort-fg:#666;--prio-bg:#252525;--prio-fg:#aaa;--prio-border:#444}
body{font-family:system-ui,sans-serif;margin:2rem auto;padding:0 100px;color:var(--fg);background:var(--bg)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)}
th{font-weight:600}a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
code{background:var(--surface);padding:2px 6px;border-radius:3px}
th.actions-col,td.actions-col{width:56px;text-align:center;padding-left:4px;padding-right:4px;white-space:nowrap}
.dir-copy-btn{margin-left:6px;vertical-align:middle}
.row-action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;margin:0 1px;background:none;border:1px solid transparent;border-radius:3px;cursor:pointer;color:var(--sort-fg);line-height:0;transition:color 0.12s,background 0.12s,border-color 0.12s}
.row-action:hover{color:var(--fg);background:var(--sel-bg);border-color:var(--btn-border)}
.row-reset:hover{color:#cc7700;border-color:#e0a060}
.row-delete:hover{color:#cc2222;border-color:#e09090;background:#fdf1ee}
[data-theme=dark] .row-delete:hover{background:#3a1a1a}
.row-action:disabled{opacity:0.35;cursor:wait}
td.dir{white-space:normal;word-break:break-all}
.dir-copy-btn.copied{color:#2a7a2a;border-color:#7ab77a;background:#f1f9f1}
.dir-copy-btn.error{color:#cc3300;border-color:#e0a090;background:#fdf1ee}
.sort-btn{background:none;border:none;cursor:pointer;font-size:0.8rem;padding:0 3px;color:var(--sort-fg);vertical-align:middle}
.sort-btn:hover{color:var(--fg)}
th.pin-col,td.pin-col{width:108px;padding-left:8px;padding-right:4px}
th.pin-col{text-align:center}
.pin-controls{display:flex;align-items:center;gap:2px;justify-content:flex-start}
.pin-btn{background:none;border:none;cursor:pointer;font-size:1.05rem;padding:2px 4px;line-height:1;opacity:0.22;filter:grayscale(1);transition:opacity 0.15s,filter 0.15s,transform 0.15s;transform:rotate(35deg)}
.pin-btn:hover{opacity:0.55}
.pin-btn.pinned{opacity:1;filter:none;transform:rotate(0deg)}
.pin-btn:disabled{cursor:wait}
.prio-move{background:none;border:1px solid transparent;border-radius:3px;padding:0 3px;cursor:pointer;font-size:0.7rem;line-height:1;color:var(--prio-fg);opacity:0.7;transition:opacity 0.12s,background 0.12s,border-color 0.12s}
.prio-move:hover:not(:disabled){opacity:1;background:var(--sel-bg);border-color:var(--btn-border);color:var(--fg)}
.prio-move:disabled{opacity:0.18;cursor:default}
tr[data-pinned="false"] .prio-move:not(.prio-top){display:none}
tr[data-pinned="false"] .prio-top{opacity:0.22;filter:grayscale(1)}
tr[data-pinned="false"] .prio-top:hover{opacity:0.55;background:none;border-color:transparent;color:var(--prio-fg)}
.btn-theme-toggle{position:fixed;top:10px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;background:var(--btn-bg);border:1px solid var(--btn-border);border-radius:6px;color:var(--btn-fg);cursor:pointer}
.theme-icon-light{display:inline;vertical-align:middle;filter:drop-shadow(0 0 2px rgba(0,0,0,0.25))}.theme-icon-dark{display:none;vertical-align:middle;filter:drop-shadow(0 0 2px rgba(255,255,255,0.25))}[data-theme=dark] .theme-icon-light{display:none}[data-theme=dark] .theme-icon-dark{display:inline}</style></head>
<body><button id="theme-btn" class="btn-theme-toggle" aria-label="Toggle dark mode"><svg id="theme-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="18" height="18" fill="currentColor"><path id="theme-path"/></svg></button>
<h1><img src="/icon_dark.png" class="theme-icon-dark" style="height:1em;margin-right:0.35em"><img src="/icon_light.png" class="theme-icon-light" style="height:1em;margin-right:0.35em">plan-present</h1>
<p>${docs.length} document${docs.length === 1 ? "" : "s"} registered.</p>
<table><thead>
<tr><th class="pin-col" title="Pinned (up/down to reorder)">\u{1F4CC}</th><th class="actions-col" title="Deregister / Delete"></th><th>File <button class="sort-btn" id="sort-file" title="Sort by file name">⇅</button></th><th>Directory <button class="sort-btn" id="sort-dir" title="Sort by directory">⇅</button></th><th>Registered <button class="sort-btn" id="sort-reg" title="Sort by registered date">↓</button></th></tr>
</thead>
<tbody>${rows}</tbody></table>
<script>
document.querySelectorAll('.row-reset').forEach(btn => {
  btn.addEventListener('click', async () => {
    const slug = btn.dataset.slug;
    btn.disabled = true;
    const resp = await fetch('/api/doc/' + slug, {method: 'DELETE'});
    if (resp.ok) {
      window.location.reload();
    } else {
      btn.disabled = false;
    }
  });
});
document.querySelectorAll('.row-delete').forEach(btn => {
  btn.addEventListener('click', async () => {
    const slug = btn.dataset.slug;
    const row = btn.closest('tr');
    const name = row?.dataset.name || slug;
    if (!confirm('Permanently delete "' + name + '" from disk?')) return;
    btn.disabled = true;
    const resp = await fetch('/api/doc/' + slug + '/file', {method: 'DELETE'});
    if (resp.ok) {
      window.location.reload();
    } else {
      btn.disabled = false;
    }
  });
});
// Sort (pin col = 0, actions col = 1; pinned rows float above the rest, ordered by priority slot)
const tbody = document.querySelector('tbody');
const origRows = Array.from(tbody.rows);
const origIndex = new Map(origRows.map((r, i) => [r, i]));
const COL_IDX = {file: 2, dir: 3, reg: 4};
const sortState = {file: null, dir: null, reg: 'desc'};
const ICONS = {null: '\u21c5', asc: '\u2191', desc: '\u2193'};
function priorityOf(row) {
  const v = row.dataset.priority;
  return v ? Number(v) : null;
}
function rebuildOrder() {
  const active = Object.keys(sortState).find(k => sortState[k] !== null);
  const rows = [...origRows];
  if (active) {
    const colIdx = COL_IDX[active];
    const dir = sortState[active];
    rows.sort((a, b) => {
      const ta = a.cells[colIdx].textContent.trim().toLowerCase();
      const tb = b.cells[colIdx].textContent.trim().toLowerCase();
      const cmp = ta.localeCompare(tb);
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      return origIndex.get(a) - origIndex.get(b);
    });
  }
  rows.sort((a, b) => {
    const ap = priorityOf(a);
    const bp = priorityOf(b);
    if (ap !== null && bp === null) return -1;
    if (ap === null && bp !== null) return 1;
    if (ap !== null && bp !== null && ap !== bp) return ap - bp;
    const pa = a.dataset.pinned === 'true' ? 1 : 0;
    const pb = b.dataset.pinned === 'true' ? 1 : 0;
    return pb - pa;
  });
  rows.forEach(r => tbody.appendChild(r));
  document.getElementById('sort-file').textContent = ICONS[sortState.file ?? null];
  document.getElementById('sort-dir').textContent = ICONS[sortState.dir ?? null];
  document.getElementById('sort-reg').textContent = ICONS[sortState.reg ?? null];
}
function applySort(col) {
  const first = col === 'reg' ? 'desc' : 'asc';
  const second = first === 'asc' ? 'desc' : 'asc';
  const next = sortState[col] === null ? first : sortState[col] === first ? second : null;
  Object.keys(sortState).forEach(k => sortState[k] = null);
  sortState[col] = next;
  rebuildOrder();
}
document.getElementById('sort-file').addEventListener('click', () => applySort('file'));
document.getElementById('sort-dir').addEventListener('click', () => applySort('dir'));
document.getElementById('sort-reg').addEventListener('click', () => applySort('reg'));
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
const COPY_SVG_JS = \`${COPY_SVG}\`;
const CHECK_SVG_JS = \`${CHECK_SVG}\`;
document.querySelectorAll('.dir-copy-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const p = btn.dataset.path;
    const ok = await copyText(p);
    if (ok) {
      btn.classList.add('copied');
      btn.innerHTML = CHECK_SVG_JS;
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = COPY_SVG_JS; }, 1200);
    } else {
      btn.classList.add('error');
      setTimeout(() => btn.classList.remove('error'), 1200);
    }
  });
});
function applyRowState(row, pinned, priority) {
  row.dataset.pinned = pinned ? 'true' : 'false';
  row.dataset.priority = priority == null ? '' : String(priority);
  const btn = row.querySelector('.pin-btn');
  if (btn) {
    btn.classList.toggle('pinned', !!pinned);
    btn.title = pinned ? 'Unpin' : 'Pin';
    btn.setAttribute('aria-label', btn.title);
  }
  const topBtn = row.querySelector('.prio-top');
  if (topBtn) topBtn.title = pinned ? 'Move to top' : 'Pin & move to top';
}
function updateMoveButtons() {
  const pinnedRows = Array.from(document.querySelectorAll('tbody tr'))
    .filter(r => r.dataset.priority && r.dataset.priority !== '')
    .map(r => ({ row: r, p: Number(r.dataset.priority) }));
  pinnedRows.sort((a, b) => a.p - b.p);
  const minP = pinnedRows.length ? pinnedRows[0].p : null;
  const maxP = pinnedRows.length ? pinnedRows[pinnedRows.length - 1].p : null;
  document.querySelectorAll('tbody tr').forEach(row => {
    const top = row.querySelector('.prio-top');
    const up = row.querySelector('.prio-up');
    const down = row.querySelector('.prio-down');
    const bottom = row.querySelector('.prio-bottom');
    const p = row.dataset.priority ? Number(row.dataset.priority) : null;
    if (!up || !down || !top || !bottom) return;
    if (p == null) {
      top.disabled = false;
      up.disabled = true;
      down.disabled = true;
      bottom.disabled = true;
    } else {
      top.disabled = p === minP;
      up.disabled = p === minP;
      down.disabled = p === maxP;
      bottom.disabled = p === maxP;
    }
  });
}
function findRowBySlug(slug) {
  const el = document.querySelector('.pin-btn[data-slug="' + slug + '"]');
  return el ? el.closest('tr') : null;
}
async function applyPinResponse(row, data) {
  applyRowState(row, data.entry.pinned, data.entry.priorityPin);
  for (const aff of (data.affected || [])) {
    const other = findRowBySlug(aff.slug);
    if (other) applyRowState(other, aff.pinned, aff.priorityPin);
  }
  rebuildOrder();
  updateMoveButtons();
}
document.querySelectorAll('.pin-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const slug = btn.dataset.slug;
    const row = btn.closest('tr');
    const nextPinned = row.dataset.pinned !== 'true';
    btn.disabled = true;
    try {
      const resp = await fetch('/api/doc/' + slug + '/pin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pinned: nextPinned}),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      await applyPinResponse(row, data);
    } finally {
      btn.disabled = false;
    }
  });
});
document.querySelectorAll('.prio-move').forEach(btn => {
  btn.addEventListener('click', async () => {
    const slug = btn.dataset.slug;
    const direction = btn.dataset.direction;
    const row = btn.closest('tr');
    btn.disabled = true;
    try {
      const resp = await fetch('/api/doc/' + slug + '/pin/move', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({direction}),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      await applyPinResponse(row, data);
    } finally {
      // updateMoveButtons will refresh disabled state
    }
  });
});
updateMoveButtons();

(function(){
var SOLID="M272 384c9.6-31.9 29.5-59.1 49.2-86.2c0 0 0 0 0 0c5.2-7.1 10.4-14.2 15.4-21.4c19.8-28.5 31.4-63 31.4-100.3C368 78.8 289.2 0 192 0S16 78.8 16 176c0 37.3 11.6 71.9 31.4 100.3c5 7.2 10.2 14.3 15.4 21.4c0 0 0 0 0 0c19.8 27.1 39.7 54.4 49.2 86.2l160 0zM192 512c44.2 0 80-35.8 80-80l0-16-160 0 0 16c0 44.2 35.8 80 80 80zM112 176c0 8.8-7.2 16-16 16s-16-7.2-16-16c0-61.9 50.1-112 112-112c8.8 0 16 7.2 16 16s-7.2 16-16 16c-44.2 0-80 35.8-80 80z";
var REGULAR="M297.2 248.9C311.6 228.3 320 203.2 320 176c0-70.7-57.3-128-128-128S64 105.3 64 176c0 27.2 8.4 52.3 22.8 72.9c3.7 5.3 8.1 11.3 12.8 17.7c0 0 0 0 0 0c12.9 17.7 28.3 38.9 39.8 59.8c10.4 19 15.7 38.8 18.3 57.5L109 384c-2.2-12-5.9-23.7-11.8-34.5c-9.9-18-22.2-34.9-34.5-51.8c0 0 0 0 0 0s0 0 0 0c-5.2-7.1-10.4-14.2-15.4-21.4C27.6 247.9 16 213.3 16 176C16 78.8 94.8 0 192 0s176 78.8 176 176c0 37.3-11.6 71.9-31.4 100.3c-5 7.2-10.2 14.3-15.4 21.4c0 0 0 0 0 0s0 0 0 0c-12.3 16.8-24.6 33.7-34.5 51.8c-5.9 10.8-9.6 22.5-11.8 34.5l-48.6 0c2.6-18.7 7.9-38.6 18.3-57.5c11.5-20.9 26.9-42.1 39.8-59.8c0 0 0 0 0 0s0 0 0 0c4.7-6.4 9-12.4 12.7-17.7zM192 128c-26.5 0-48 21.5-48 48c0 8.8-7.2 16-16 16s-16-7.2-16-16c0-44.2 35.8-80 80-80c8.8 0 16 7.2 16 16s-7.2 16-16 16zm0 384c-44.2 0-80-35.8-80-80l0-16 160 0 0 16c0 44.2-35.8 80-80 80z";
var dark=document.documentElement.getAttribute('data-theme')==='dark';
var path=document.getElementById('theme-path');
function applyTheme(d){document.documentElement.setAttribute('data-theme',d?'dark':'light');try{localStorage.setItem('plan-present-theme',d?'dark':'light');}catch(e){}path.setAttribute('d',d?REGULAR:SOLID);dark=d;}
applyTheme(dark);
document.getElementById('theme-btn').addEventListener('click',function(){applyTheme(!dark);});
})();
</script>
</body></html>`);
});

// SPA serving for /doc/:slug routes — always serve built assets.
// Resolve the project root by walking up from __dirname until we find
// package.json, so this works whether running from src/ (tsx dev) or
// dist/ (built), and regardless of where the repo lives on disk.
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find project root from ${startDir} (no package.json ancestor)`);
}
const clientDistDir = path.join(findProjectRoot(__dirname), "dist", "client");
app.use(express.static(clientDistDir));

app.get("/doc/:slug", (req, res) => {
  const entry = getDocument(req.params.slug);
  if (!entry) {
    res.status(404).send("<!DOCTYPE html><html><body><h1>404</h1><p>Document not found.</p></body></html>");
    return;
  }
  res.sendFile(path.join(clientDistDir, "index.html"));
});

const restored = loadFromDisk();

const server = app.listen(PORT, HOST, () => {
  const url = `http://${tailscaleHost}:${PORT}`;
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║           plan-present                   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Version : ${VERSION}`);
  console.log(`  Port    : ${PORT}`);
  console.log(`  Mode    : ${mode}`);
  console.log(`  URL     : ${url}`);
  if (restored > 0) {
    console.log(`  Docs    : ${restored} restored from disk`);
  }
  console.log("");
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Exiting.`);
    process.exit(1);
  }

  throw error;
});

// Graceful shutdown — release the port before exiting so tsx watch restarts cleanly
function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
