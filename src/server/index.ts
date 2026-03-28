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
    res.status(404).json({ error: "File no longer exists on disk" });
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
        `<tr><td><a href="/doc/${d.slug}">${d.originalBaseName}</a></td><td><code>${d.slug}</code></td><td>${d.registeredAt}</td></tr>`,
    )
    .join("\n");

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>plan-present</title>
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:2rem auto;padding:0 1rem;color:#333}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee}
th{font-weight:600}a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px}</style></head>
<body><h1>plan-present</h1>
<p>${docs.length} document${docs.length === 1 ? "" : "s"} registered.</p>
<table><thead><tr><th>File</th><th>Slug</th><th>Registered</th></tr></thead>
<tbody>${rows}</tbody></table>
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
