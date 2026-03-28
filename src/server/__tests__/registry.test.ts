import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  registerDocument,
  getDocument,
  getDocumentByPath,
  listDocuments,
  removeDocument,
} from "../registry";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-test-"));
});

afterEach(() => {
  // Clean up registry state by removing all docs we registered
  for (const entry of listDocuments()) {
    removeDocument(entry.slug);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("registerDocument", () => {
  it("registers a file and retrieves by slug", () => {
    const file = path.join(tmpDir, "my_doc.md");
    fs.writeFileSync(file, "# Hello");

    const entry = registerDocument(file);
    assert.equal(entry.slug, "my_doc");
    assert.equal(entry.originalBaseName, "my_doc.md");
    assert.ok(entry.lastKnownMtimeMs > 0);
    assert.ok(entry.lastKnownSize > 0);

    const got = getDocument("my_doc");
    assert.deepEqual(got, entry);
  });

  it("deduplicates: registering the same file twice returns the same entry", () => {
    const file = path.join(tmpDir, "plan.md");
    fs.writeFileSync(file, "content");

    const first = registerDocument(file);
    const second = registerDocument(file);
    assert.deepEqual(first, second);
    assert.equal(listDocuments().length, 1);
  });

  it("resolves slug collisions for files with the same basename", () => {
    const dir1 = path.join(tmpDir, "a");
    const dir2 = path.join(tmpDir, "b");
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);

    const file1 = path.join(dir1, "readme.md");
    const file2 = path.join(dir2, "readme.md");
    fs.writeFileSync(file1, "first");
    fs.writeFileSync(file2, "second");

    const entry1 = registerDocument(file1);
    const entry2 = registerDocument(file2);

    assert.equal(entry1.slug, "readme");
    assert.equal(entry2.slug, "readme_1");
    assert.notEqual(entry1.absolutePath, entry2.absolutePath);
  });

  it("throws on nonexistent file", () => {
    const file = path.join(tmpDir, "nope.md");
    assert.throws(() => registerDocument(file), { code: "ENOENT" });
  });

  it("throws on non-markdown file", () => {
    const file = path.join(tmpDir, "data.json");
    fs.writeFileSync(file, "{}");
    assert.throws(() => registerDocument(file), /Not a markdown file/);
  });
});

describe("listDocuments", () => {
  it("returns all registered documents", () => {
    const file1 = path.join(tmpDir, "a.md");
    const file2 = path.join(tmpDir, "b.md");
    fs.writeFileSync(file1, "a");
    fs.writeFileSync(file2, "b");

    registerDocument(file1);
    registerDocument(file2);

    const list = listDocuments();
    assert.equal(list.length, 2);
    const slugs = list.map((e) => e.slug).sort();
    assert.deepEqual(slugs, ["a", "b"]);
  });
});

describe("removeDocument", () => {
  it("removes from both primary and secondary index", () => {
    const file = path.join(tmpDir, "removeme.md");
    fs.writeFileSync(file, "bye");

    const entry = registerDocument(file);
    assert.ok(getDocument(entry.slug));
    assert.ok(getDocumentByPath(entry.absolutePath));

    const removed = removeDocument(entry.slug);
    assert.equal(removed, true);
    assert.equal(getDocument(entry.slug), undefined);
    assert.equal(getDocumentByPath(entry.absolutePath), undefined);
    assert.equal(listDocuments().length, 0);
  });

  it("returns false for unknown slug", () => {
    assert.equal(removeDocument("nonexistent"), false);
  });
});
