import { readFileSync } from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

type Status = "PASS" | "NORMALIZED" | "FAIL";

type CheckResult = {
  name: string;
  status: Status;
  detail?: string;
};

const lowlight = createLowlight(common);

const samplePath = path.resolve(process.cwd(), "spike/sample.md");
const input = readFileSync(samplePath, "utf8");

const editor = new Editor({
  content: input,
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
    Markdown
  ]
});

const output = editor.getMarkdown();
editor.destroy();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function classifyBySnippet(
  name: string,
  snippet: string,
  semanticOk: boolean,
  detail?: string
): CheckResult {
  if (output.includes(snippet)) {
    return { name, status: "PASS" };
  }
  if (semanticOk) {
    return { name, status: "NORMALIZED", detail };
  }
  return { name, status: "FAIL", detail };
}

function hasHeading(level: number, text: string): boolean {
  const pattern = new RegExp(`^${"#".repeat(level)}\\s+${escapeRegExp(text)}$`, "m");
  return pattern.test(output);
}

function extractTableBlocks(markdown: string): Array<{ block: string; rows: string[][] }> {
  const lines = markdown.split(/\r?\n/);
  const tables: Array<{ block: string; rows: string[][] }> = [];

  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i];
    const separator = lines[i + 1];

    if (!header.includes("|") || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(separator)) {
      continue;
    }

    const rows: string[][] = [parseRow(header)];
    let blockLines = [header, separator];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.includes("|")) {
        break;
      }
      if (line.trim() === "") {
        break;
      }
      rows.push(parseRow(line));
      blockLines.push(line);
    }

    tables.push({ block: blockLines.join("\n"), rows });
    i = j;
  }

  return tables;
}

function rowsMatch(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].length !== b[i].length) {
      return false;
    }
    for (let j = 0; j < a[i].length; j += 1) {
      if (a[i][j] !== b[i][j]) {
        return false;
      }
    }
  }
  return true;
}

function tableCheck(name: string, inputBlock: { block: string; rows: string[][] }): CheckResult {
  const outputTables = extractTableBlocks(output);
  if (output.includes(inputBlock.block)) {
    return { name, status: "PASS" };
  }

  const matched = outputTables.some((table) => rowsMatch(inputBlock.rows, table.rows));
  if (matched) {
    return { name, status: "NORMALIZED", detail: "Table content preserved but formatting changed." };
  }

  return { name, status: "FAIL", detail: "Table structure/content not preserved." };
}

const checks: CheckResult[] = [];

checks.push(
  classifyBySnippet(
    "H1 heading",
    "# Plan Present — Spike Fixture",
    hasHeading(1, "Plan Present — Spike Fixture"),
    "H1 text missing or altered."
  )
);

checks.push(
  classifyBySnippet(
    "H2 heading",
    "## 1. Overview",
    hasHeading(2, "1. Overview"),
    "H2 text missing or altered."
  )
);

checks.push(
  classifyBySnippet(
    "H3 heading",
    "### 1.1 Success Criteria",
    hasHeading(3, "1.1 Success Criteria"),
    "H3 text missing or altered."
  )
);

checks.push(
  classifyBySnippet(
    "Inline formatting",
    "**realistic implementation plan**",
    output.includes("realistic implementation plan"),
    "Bold/italic/inline code formatting not preserved."
  )
);

checks.push(
  classifyBySnippet(
    "Links",
    "[Tailscale](https://tailscale.com/)",
    output.includes("https://tailscale.com/") && output.includes("https://openai.com/"),
    "Link URLs missing after serialization."
  )
);

checks.push(
  classifyBySnippet(
    "Task list",
    "- [ ] Implement debounce (2s).",
    output.includes("- [ ]") && output.includes("- [x]"),
    "Task list markers missing."
  )
);

checks.push(
  classifyBySnippet(
    "Code block",
    "```bash",
    output.includes("```bash") && output.includes("curl -s -X POST"),
    "Code block missing or language tag stripped."
  )
);

checks.push(
  classifyBySnippet(
    "Blockquote",
    "> **Note:**",
    output.includes("> **Note:**") || output.includes("> **Note**"),
    "Blockquote content missing."
  )
);

checks.push(
  classifyBySnippet(
    "Horizontal rule",
    "---",
    /\n---\n/.test(output),
    "Horizontal rule missing."
  )
);

const inputTables = extractTableBlocks(input);
if (inputTables[0]) {
  checks.push(tableCheck("Requirements table", inputTables[0]));
}
if (inputTables[1]) {
  checks.push(tableCheck("Mixed-sequence table", inputTables[1]));
}

const codeBlockIndex = output.indexOf("```bash");
const headingAfterCodeIndex = output.indexOf("### 4.1 Heading After Code Block");
const headingAfterCodeOk = codeBlockIndex !== -1 && headingAfterCodeIndex > codeBlockIndex;
checks.push({
  name: "Heading after code block",
  status: headingAfterCodeOk ? "PASS" : "FAIL",
  ...(headingAfterCodeOk
    ? {}
    : {
        detail:
          codeBlockIndex === -1 ? "Missing code block." : "Heading not found after code block."
      })
});

const summary = checks.reduce(
  (acc, check) => {
    acc[check.status] += 1;
    return acc;
  },
  { PASS: 0, NORMALIZED: 0, FAIL: 0 }
);

const report = {
  inputBytes: input.length,
  outputBytes: output.length,
  summary,
  checks
};

console.log(JSON.stringify(report, null, 2));
