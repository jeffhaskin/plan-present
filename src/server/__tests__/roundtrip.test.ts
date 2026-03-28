import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

function roundtrip(markdown: string): string {
  const editor = new Editor({
    content: markdown,
    contentType: "markdown",
    injectCSS: false,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Markdown,
    ],
  });
  const output = editor.getMarkdown();
  editor.destroy();
  return output;
}

describe("markdown round-trip", () => {
  it("preserves headings", () => {
    const input = "# Heading 1\n\n## Heading 2\n\n### Heading 3\n";
    const output = roundtrip(input);
    assert.ok(output.includes("# Heading 1"));
    assert.ok(output.includes("## Heading 2"));
    assert.ok(output.includes("### Heading 3"));
  });

  it("preserves bold and italic", () => {
    const input = "This is **bold** and *italic* text.\n";
    const output = roundtrip(input);
    assert.ok(output.includes("**bold**"));
    assert.ok(output.includes("*italic*"));
  });

  it("preserves links", () => {
    const input = "Visit [Example](https://example.com) for details.\n";
    const output = roundtrip(input);
    assert.ok(output.includes("[Example](https://example.com)"));
  });

  it("preserves code blocks with language", () => {
    const input = '```bash\ncurl -s https://example.com\n```\n';
    const output = roundtrip(input);
    assert.ok(output.includes("```bash"));
    assert.ok(output.includes("curl -s https://example.com"));
  });

  it("preserves blockquotes", () => {
    const input = "> **Note:** This is important.\n";
    const output = roundtrip(input);
    assert.ok(output.includes("> "));
    assert.ok(output.includes("**Note:**"));
  });

  it("preserves horizontal rules", () => {
    const input = "Above\n\n---\n\nBelow\n";
    const output = roundtrip(input);
    assert.ok(output.includes("---"));
  });

  it("preserves task lists", () => {
    const input = "- [ ] Unchecked task\n- [x] Checked task\n";
    const output = roundtrip(input);
    assert.ok(output.includes("- [ ]"));
    assert.ok(output.includes("- [x]"));
  });

  it("preserves table content", () => {
    const input =
      "| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n";
    const output = roundtrip(input);
    assert.ok(output.includes("alpha"));
    assert.ok(output.includes("beta"));
    assert.ok(output.includes("Name"));
    assert.ok(output.includes("Value"));
    // Check table structure (pipes present)
    assert.ok(output.includes("|"));
  });

  it("preserves requirement tables with multiple columns", () => {
    const input =
      "| Requirement | Description | Priority |\n| --- | --- | --- |\n| Auth | User login | P0 |\n| Search | Full text | P1 |\n";
    const output = roundtrip(input);
    assert.ok(output.includes("Auth"));
    assert.ok(output.includes("User login"));
    assert.ok(output.includes("P0"));
    assert.ok(output.includes("Search"));
  });

  it("preserves ordered lists", () => {
    const input = "1. First\n2. Second\n3. Third\n";
    const output = roundtrip(input);
    assert.ok(output.includes("First"));
    assert.ok(output.includes("Second"));
    assert.ok(output.includes("Third"));
  });

  it("preserves nested bullet lists", () => {
    const input = "- Item A\n  - Sub A1\n  - Sub A2\n- Item B\n";
    const output = roundtrip(input);
    assert.ok(output.includes("Item A"));
    assert.ok(output.includes("Sub A1"));
    assert.ok(output.includes("Item B"));
  });
});
