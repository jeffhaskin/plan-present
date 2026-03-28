import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  generateConflictPath,
  atomicWrite,
  saveWithConflictDetection,
} from "../conflict";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conflict-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateConflictPath", () => {
  it("returns _conflict.md when no conflict file exists", () => {
    const original = path.join(tmpDir, "plan.md");
    fs.writeFileSync(original, "content");
    const result = generateConflictPath(original);
    assert.equal(result, path.join(tmpDir, "plan_conflict.md"));
  });

  it("returns _conflict_1.md when _conflict.md already exists", () => {
    const original = path.join(tmpDir, "plan.md");
    fs.writeFileSync(original, "content");
    fs.writeFileSync(path.join(tmpDir, "plan_conflict.md"), "old");
    const result = generateConflictPath(original);
    assert.equal(result, path.join(tmpDir, "plan_conflict_1.md"));
  });

  it("returns _conflict_2.md when _conflict.md and _conflict_1.md exist", () => {
    const original = path.join(tmpDir, "plan.md");
    fs.writeFileSync(original, "content");
    fs.writeFileSync(path.join(tmpDir, "plan_conflict.md"), "old1");
    fs.writeFileSync(path.join(tmpDir, "plan_conflict_1.md"), "old2");
    const result = generateConflictPath(original);
    assert.equal(result, path.join(tmpDir, "plan_conflict_2.md"));
  });
});

describe("atomicWrite", () => {
  it("writes content to file", () => {
    const filePath = path.join(tmpDir, "test.md");
    atomicWrite(filePath, "hello world");
    assert.equal(fs.readFileSync(filePath, "utf-8"), "hello world");
  });

  it("does not leave .tmp file on success", () => {
    const filePath = path.join(tmpDir, "test.md");
    atomicWrite(filePath, "hello world");
    assert.equal(fs.existsSync(filePath + ".tmp"), false);
  });
});

describe("saveWithConflictDetection", () => {
  it("normal save: mtime matches, write succeeds", () => {
    const filePath = path.join(tmpDir, "doc.md");
    fs.writeFileSync(filePath, "original");
    const mtime = fs.statSync(filePath).mtimeMs;

    const result = saveWithConflictDetection(filePath, "updated", mtime);
    assert.equal(result.saved, true);
    assert.equal(result.conflict, false);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "updated");
    assert.ok(result.mtime > 0);
  });

  it("conflict save: mtime mismatch triggers rename + write", () => {
    const filePath = path.join(tmpDir, "doc.md");
    fs.writeFileSync(filePath, "version-A");
    const oldMtime = fs.statSync(filePath).mtimeMs;

    // Simulate external modification
    fs.writeFileSync(filePath, "version-B-external");

    const result = saveWithConflictDetection(filePath, "version-C", oldMtime);
    assert.equal(result.saved, true);
    assert.equal(result.conflict, true);
    assert.ok(result.conflictPath);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "version-C");
    assert.equal(
      fs.readFileSync(result.conflictPath!, "utf-8"),
      "version-B-external",
    );
  });

  it("repeated conflicts produce incrementing conflict filenames", () => {
    const filePath = path.join(tmpDir, "doc.md");

    // First conflict
    fs.writeFileSync(filePath, "v1");
    const mtime1 = fs.statSync(filePath).mtimeMs;
    fs.writeFileSync(filePath, "v2-ext");
    const r1 = saveWithConflictDetection(filePath, "v2-mine", mtime1);
    assert.equal(path.basename(r1.conflictPath!), "doc_conflict.md");

    // Second conflict
    const mtime2 = fs.statSync(filePath).mtimeMs;
    fs.writeFileSync(filePath, "v3-ext");
    const r2 = saveWithConflictDetection(filePath, "v3-mine", mtime2);
    assert.equal(path.basename(r2.conflictPath!), "doc_conflict_1.md");

    // Third conflict
    const mtime3 = fs.statSync(filePath).mtimeMs;
    fs.writeFileSync(filePath, "v4-ext");
    const r3 = saveWithConflictDetection(filePath, "v4-mine", mtime3);
    assert.equal(path.basename(r3.conflictPath!), "doc_conflict_2.md");
  });

  it("file deleted: recreates file", () => {
    const filePath = path.join(tmpDir, "doc.md");
    // File doesn't exist
    const result = saveWithConflictDetection(filePath, "new content", 0);
    assert.equal(result.saved, true);
    assert.equal(result.conflict, false);
    assert.equal(result.recreated, true);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "new content");
  });
});
