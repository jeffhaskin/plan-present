import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../slugify";

describe("slugify", () => {
  it("basic name: unified_plan.md → unified_plan", () => {
    assert.equal(slugify("unified_plan.md"), "unified_plan");
  });

  it("special chars: My Plan (v2).md → my_plan_v2", () => {
    assert.equal(slugify("My Plan (v2).md"), "my_plan_v2");
  });

  it("collapses consecutive underscores", () => {
    assert.equal(slugify("foo___bar.md"), "foo_bar");
  });

  it("trims leading/trailing underscores: ___weird___name___.md → weird_name", () => {
    assert.equal(slugify("___weird___name___.md"), "weird_name");
  });

  it("empty result falls back to doc: .md → doc", () => {
    assert.equal(slugify(".md"), "doc");
  });

  it("handles .markdown extension", () => {
    assert.equal(slugify("README.markdown"), "readme");
  });

  it("uses only basename when given a path with directories", () => {
    assert.equal(slugify("/some/deep/path/my_doc.md"), "my_doc");
  });

  it("already-clean names pass through unchanged", () => {
    assert.equal(slugify("hello-world.md"), "hello-world");
  });

  it("handles dashes in names", () => {
    assert.equal(slugify("my-plan-v2.md"), "my-plan-v2");
  });

  it("handles numbers", () => {
    assert.equal(slugify("plan123.md"), "plan123");
  });
});
