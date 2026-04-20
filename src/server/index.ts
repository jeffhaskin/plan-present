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
  setPriorityPin,
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

// POST /api/doc/:slug/pin — set the pinned flag on a document
app.post("/api/doc/:slug/pin", (req, res) => {
  const { pinned } = req.body;
  if (typeof pinned !== "boolean") {
    res.status(400).json({ error: "pinned (boolean) is required" });
    return;
  }
  const entry = setPinned(req.params.slug, pinned);
  if (!entry) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ pinned: !!entry.pinned, priorityPin: entry.priorityPin ?? null });
});

// POST /api/doc/:slug/priority-pin — set or clear the priority-pin slot (1-5)
app.post("/api/doc/:slug/priority-pin", (req, res) => {
  const { priority } = req.body;
  if (priority !== null && !(Number.isInteger(priority) && priority >= 1 && priority <= 5)) {
    res.status(400).json({ error: "priority must be null or an integer 1-5" });
    return;
  }
  let result;
  try {
    result = setPriorityPin(req.params.slug, priority);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }
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
<html><head><meta charset="utf-8"><title>plan-present</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;padding:0 100px;color:#333}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px}pre{background:#f4f4f4;padding:1rem;border-radius:6px;overflow-x:auto}</style></head>
<body><h1>plan-present</h1>
<p>No documents registered yet.</p>
<p>Register a markdown file with:</p>
<pre><code>curl -X POST ${tailscaleUrl}/open \\
  -H 'Content-Type: application/json' \\
  -d '{"path": "/absolute/path/to/your/file.md"}'</code></pre>
<p>Then visit the returned URL to edit it in the browser.</p>
</body></html>`);
    return;
  }

  const prioOptions = (p?: number) =>
    ["", "1", "2", "3", "4", "5"]
      .map(
        (v) =>
          `<option value="${v}"${(p ?? "") === (v === "" ? "" : Number(v)) ? " selected" : ""}>${v === "" ? "\u2014" : v}</option>`,
      )
      .join("");

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

  const rows = docs
    .map((d) => {
      const dir = path.dirname(d.absolutePath);
      return `<tr data-pinned="${d.pinned ? "true" : "false"}" data-priority="${d.priorityPin ?? ""}"><td class="pin-col"><button class="pin-btn${d.pinned ? " pinned" : ""}" data-slug="${d.slug}" title="${d.pinned ? "Unpin" : "Pin"}" aria-label="${d.pinned ? "Unpin" : "Pin"}">\u{1F4CC}</button></td><td class="prio-col"><select class="prio-select" data-slug="${d.slug}" title="Priority pin (1-5)" aria-label="Priority pin">${prioOptions(d.priorityPin)}</select></td><td><a href="/doc/${d.slug}">${d.originalBaseName}</a></td><td class="dir"><code>${dir}</code></td><td class="copy-col"><button type="button" class="dir-copy-btn" data-path="${escAttr(d.absolutePath)}" title="Copy pathname" aria-label="Copy pathname">${COPY_SVG}</button></td><td>${fmtTs(d.registeredAt)}</td><td style="text-align:center"><input type="checkbox" class="doc-check" data-slug="${d.slug}"></td><td style="text-align:center"><input type="checkbox" class="file-check" data-slug="${d.slug}"></td></tr>`;
    })
    .join("\n");

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>plan-present</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;padding:0 100px;color:#333}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee}
th{font-weight:600}a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px}
.action-btn{color:#fff;border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:0.85rem}
#deregister-btn{background:#cc2222}#deregister-btn:hover{background:#aa1111}
#delete-btn{background:#881111}#delete-btn:hover{background:#660000}
.action-btn:disabled{background:#aaa!important;cursor:not-allowed}
thead tr:last-child th{padding-top:4px;padding-bottom:6px;border-bottom:1px solid #eee}
td.dir{white-space:normal;word-break:break-all}
th.copy-col,td.copy-col{text-align:center;padding-left:8px;padding-right:8px;white-space:nowrap}
.dir-copy-btn{display:inline-flex;align-items:center;justify-content:center;background:none;border:1px solid transparent;border-radius:3px;padding:2px;cursor:pointer;color:#999;line-height:0;transition:color 0.12s,border-color 0.12s,background 0.12s}
.dir-copy-btn:hover{color:#333;border-color:#ccc;background:#fafafa}
.dir-copy-btn.copied{color:#2a7a2a;border-color:#7ab77a;background:#f1f9f1}
.dir-copy-btn.error{color:#cc3300;border-color:#e0a090;background:#fdf1ee}
.sort-btn{background:none;border:none;cursor:pointer;font-size:0.8rem;padding:0 3px;color:#999;vertical-align:middle}
.sort-btn:hover{color:#333}
th.pin-col,td.pin-col{width:36px;text-align:center;padding-left:4px;padding-right:4px}
.pin-btn{background:none;border:none;cursor:pointer;font-size:1.05rem;padding:2px 4px;line-height:1;opacity:0.22;filter:grayscale(1);transition:opacity 0.15s,filter 0.15s,transform 0.15s;transform:rotate(35deg)}
.pin-btn:hover{opacity:0.55}
.pin-btn.pinned{opacity:1;filter:none;transform:rotate(0deg)}
.pin-btn:disabled{cursor:wait}
th.prio-col,td.prio-col{width:46px;text-align:center;padding-left:2px;padding-right:2px}
.prio-select{font-size:0.85rem;padding:1px 2px;border:1px solid #ddd;border-radius:3px;background:#fff;color:#666;cursor:pointer}
tr[data-priority]:not([data-priority=""]) .prio-select{background:#ffe4c4;color:#7a3b00;border-color:#e89a4f;font-weight:600}
.prio-select:disabled{cursor:wait;opacity:0.6}</style></head>
<body><h1>plan-present</h1>
<p>${docs.length} document${docs.length === 1 ? "" : "s"} registered.</p>
<table><thead>
<tr><th class="pin-col" title="Pinned">\u{1F4CC}</th><th class="prio-col" title="Priority pin (1-5)">#</th><th>File <button class="sort-btn" id="sort-file" title="Sort by file name">⇅</button></th><th>Directory <button class="sort-btn" id="sort-dir" title="Sort by directory">⇅</button></th><th class="copy-col" title="Copy pathname">Copy<br>Pathname</th><th>Registered <button class="sort-btn" id="sort-reg" title="Sort by registered date">↓</button></th><th style="text-align:center"><button id="deregister-btn" class="action-btn" disabled>Deregister</button></th><th style="text-align:center"><button id="delete-btn" class="action-btn" disabled>Delete File</button></th></tr>
<tr><th class="pin-col"></th><th class="prio-col"></th><th></th><th></th><th class="copy-col"></th><th></th><th style="text-align:center"><input type="checkbox" id="doc-all" title="Select all"></th><th style="text-align:center"><input type="checkbox" id="file-all" title="Select all"></th></tr>
</thead>
<tbody>${rows}</tbody></table>
<script>
const deregBtn = document.getElementById('deregister-btn');
const delBtn = document.getElementById('delete-btn');
const docAll = document.getElementById('doc-all');
const fileAll = document.getElementById('file-all');
const docChecks = () => Array.from(document.querySelectorAll('.doc-check'));
const fileChecks = () => Array.from(document.querySelectorAll('.file-check'));
function syncState() {
  deregBtn.disabled = !docChecks().some(c => c.checked);
  delBtn.disabled = !fileChecks().some(c => c.checked);
  docAll.checked = docChecks().length > 0 && docChecks().every(c => c.checked);
  fileAll.checked = fileChecks().length > 0 && fileChecks().every(c => c.checked);
}
document.addEventListener('change', e => {
  if (e.target === docAll) docChecks().forEach(c => c.checked = docAll.checked);
  if (e.target === fileAll) fileChecks().forEach(c => c.checked = fileAll.checked);
  syncState();
});
deregBtn.addEventListener('click', async () => {
  const selected = docChecks().filter(c => c.checked).map(c => c.dataset.slug);
  if (!selected.length) return;
  deregBtn.disabled = true;
  deregBtn.textContent = 'Deregistering\u2026';
  await Promise.all(selected.map(slug => fetch('/api/doc/' + slug, {method:'DELETE'})));
  window.location.reload();
});
delBtn.addEventListener('click', async () => {
  const selected = fileChecks().filter(c => c.checked).map(c => c.dataset.slug);
  if (!selected.length) return;
  const names = selected.map(slug => fileChecks().find(c => c.dataset.slug === slug)?.closest('tr')?.querySelector('a')?.textContent).join(', ');
  if (!confirm('Permanently delete ' + selected.length + ' file(s) from disk?\\n\\n' + names)) return;
  delBtn.disabled = true;
  delBtn.textContent = 'Deleting\u2026';
  await Promise.all(selected.map(slug => fetch('/api/doc/' + slug + '/file', {method:'DELETE'})));
  window.location.reload();
});
// Sort (pin col = 0, priority col = 1; priority pins float above regular pins which float above the rest)
const tbody = document.querySelector('tbody');
const origRows = Array.from(tbody.rows);
const origIndex = new Map(origRows.map((r, i) => [r, i]));
const COL_IDX = {file: 2, dir: 3, reg: 5};
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
  const sel = row.querySelector('.prio-select');
  if (sel) sel.value = priority == null ? '' : String(priority);
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
      applyRowState(row, data.pinned, data.priorityPin);
      rebuildOrder();
    } finally {
      btn.disabled = false;
    }
  });
});
document.querySelectorAll('.prio-select').forEach(sel => {
  sel.addEventListener('change', async () => {
    const slug = sel.dataset.slug;
    const row = sel.closest('tr');
    const raw = sel.value;
    const priority = raw === '' ? null : Number(raw);
    sel.disabled = true;
    try {
      const resp = await fetch('/api/doc/' + slug + '/priority-pin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({priority}),
      });
      if (!resp.ok) {
        // Revert the select to the row's current state on failure
        sel.value = row.dataset.priority || '';
        return;
      }
      const data = await resp.json();
      applyRowState(row, data.entry.pinned, data.entry.priorityPin);
      for (const aff of (data.affected || [])) {
        const other = document.querySelector('.prio-select[data-slug="' + aff.slug + '"]');
        if (other) applyRowState(other.closest('tr'), aff.pinned, aff.priorityPin);
      }
      rebuildOrder();
    } finally {
      sel.disabled = false;
    }
  });
});
</script>
</body></html>`);
});

// SPA serving for /doc/:slug routes — always serve built assets
const clientDistDir = path.resolve(__dirname, "../../dist/client");
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
