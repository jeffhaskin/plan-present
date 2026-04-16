import fs from "fs";
import path from "path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { getTailscaleHostname } from "./tailscale";
import { tailscaleOnly } from "./network";
import {
  registerDocument,
  getDocument,
  listDocuments,
  removeDocument,
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
  const skipped: { file: string; error: string }[] = [];
  for (const filePath of mdFiles) {
    try {
      const entry = registerDocument(filePath);
      registered.push({ file: filePath, url: `http://${tailscaleHost}:${PORT}/doc/${entry.slug}`, slug: entry.slug });
    } catch (err: any) {
      skipped.push({ file: filePath, error: err.message });
    }
  }
  res.json({ registered, skipped });
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
  const docs = listDocuments();
  const tailscaleUrl = `http://${tailscaleHost}:${PORT}`;

  if (docs.length === 0) {
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>plan-present</title>
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:2rem auto;padding:0 1rem;color:#333}
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

  const rows = docs
    .map(
      (d) =>
        `<tr><td><a href="/doc/${d.slug}">${d.originalBaseName}</a></td><td class="dir"><code>${path.dirname(d.absolutePath)}</code></td><td><code>${d.slug}</code></td><td>${d.registeredAt}</td><td style="text-align:center"><input type="checkbox" class="doc-check" data-slug="${d.slug}"></td><td style="text-align:center"><input type="checkbox" class="file-check" data-slug="${d.slug}"></td></tr>`,
    )
    .join("\n");

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>plan-present</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#333}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee}
th{font-weight:600}a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px}
.action-btn{color:#fff;border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:0.85rem}
#deregister-btn{background:#cc2222}#deregister-btn:hover{background:#aa1111}
#delete-btn{background:#881111}#delete-btn:hover{background:#660000}
.action-btn:disabled{background:#aaa!important;cursor:not-allowed}
thead tr:last-child th{padding-top:4px;padding-bottom:6px;border-bottom:1px solid #eee}
td.dir{width:14ch;min-width:14ch;max-width:14ch;white-space:normal;word-break:break-all}</style></head>
<body><h1>plan-present</h1>
<p>${docs.length} document${docs.length === 1 ? "" : "s"} registered.</p>
<table><thead>
<tr><th>File</th><th>Directory</th><th>Slug</th><th>Registered</th><th style="text-align:center"><button id="deregister-btn" class="action-btn" disabled>Deregister</button></th><th style="text-align:center"><button id="delete-btn" class="action-btn" disabled>Delete File</button></th></tr>
<tr><th></th><th></th><th></th><th></th><th style="text-align:center"><input type="checkbox" id="doc-all" title="Select all"></th><th style="text-align:center"><input type="checkbox" id="file-all" title="Select all"></th></tr>
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
