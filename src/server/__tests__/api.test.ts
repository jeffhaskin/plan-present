import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

let server: ChildProcess;
let tmpDir: string;
const PORT = 7979; // Server hardcodes this port

function baseUrl(): string {
  return `http://127.0.0.1:${PORT}`;
}

async function waitForServer(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl()}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server did not start in time");
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-test-"));

  server = spawn(
    "npx",
    ["tsx", "src/server/index.ts"],
    {
      env: {
        ...process.env,
      },
      cwd: process.cwd(),
      stdio: "pipe",
    },
  );

  await waitForServer();
});

after(() => {
  server.kill("SIGTERM");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await fetch(`${baseUrl()}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.uptime, "number");
    assert.equal(typeof body.docCount, "number");
  });
});

describe("POST /open", () => {
  it("registers a valid .md file and returns url + slug", async () => {
    const file = path.join(tmpDir, "test_doc.md");
    fs.writeFileSync(file, "# Test");

    const res = await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.url, "string");
    assert.equal(body.slug, "test_doc");
  });

  it("returns 400 for nonexistent path", async () => {
    const res = await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/nonexistent/file.md" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 for non-.md file", async () => {
    const file = path.join(tmpDir, "data.txt");
    fs.writeFileSync(file, "hello");

    const res = await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    assert.equal(res.status, 400);
  });

  it("returns same slug when registering same file twice", async () => {
    const file = path.join(tmpDir, "dedup.md");
    fs.writeFileSync(file, "# Dedup");

    const res1 = await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    const body1 = await res1.json();

    const res2 = await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    const body2 = await res2.json();

    assert.equal(body1.slug, body2.slug);
  });
});

describe("GET /api/doc/:slug", () => {
  it("returns document content and mtime", async () => {
    const file = path.join(tmpDir, "loadme.md");
    fs.writeFileSync(file, "# Load Me");

    // Register first
    await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });

    const res = await fetch(`${baseUrl()}/api/doc/loadme`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.content, "# Load Me");
    assert.equal(typeof body.mtime, "number");
    assert.equal(body.slug, "loadme");
    assert.equal(body.fileName, "loadme.md");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await fetch(`${baseUrl()}/api/doc/nonexistent`);
    assert.equal(res.status, 404);
  });
});

describe("PUT /api/doc/:slug", () => {
  it("saves with matching mtime — no conflict", async () => {
    const file = path.join(tmpDir, "saveme.md");
    fs.writeFileSync(file, "original");

    await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });

    // Get current mtime
    const getRes = await fetch(`${baseUrl()}/api/doc/saveme`);
    const doc = await getRes.json();

    const res = await fetch(`${baseUrl()}/api/doc/saveme`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "updated", baseMtime: doc.mtime }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.saved, true);
    assert.equal(body.conflict, false);

    // Verify on disk
    assert.equal(fs.readFileSync(file, "utf-8"), "updated");
  });

  it("saves with stale mtime — conflict", async () => {
    const file = path.join(tmpDir, "conflict_test.md");
    fs.writeFileSync(file, "v1");

    await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });

    const getRes = await fetch(`${baseUrl()}/api/doc/conflict_test`);
    const doc = await getRes.json();

    // Externally modify the file to change mtime
    fs.writeFileSync(file, "v2-external");

    const res = await fetch(`${baseUrl()}/api/doc/conflict_test`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v3-browser", baseMtime: doc.mtime }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.saved, true);
    assert.equal(body.conflict, true);
    assert.ok(body.conflictPath);
  });
});

describe("DELETE /api/doc/:slug", () => {
  it("removes a registered document", async () => {
    const file = path.join(tmpDir, "deleteme.md");
    fs.writeFileSync(file, "bye");

    await fetch(`${baseUrl()}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file }),
    });

    const res = await fetch(`${baseUrl()}/api/doc/deleteme`, {
      method: "DELETE",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.removed, true);

    // Verify gone
    const getRes = await fetch(`${baseUrl()}/api/doc/deleteme`);
    assert.equal(getRes.status, 404);
  });
});

describe("GET /api/docs", () => {
  it("returns array of registered docs", async () => {
    const res = await fetch(`${baseUrl()}/api/docs`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
  });
});
