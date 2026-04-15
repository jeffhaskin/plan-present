#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.PLAN_PRESENT_URL || "http://flywheel.tail2a835b.ts.net:7979";

const server = new McpServer({
  name: "plan-present",
  version: "0.1.0",
});

server.tool(
  "open_document",
  "Open a markdown file for WYSIWYG editing in the browser. Returns a URL you can share with the user.",
  { path: z.string().describe("Absolute path to a .md or .markdown file") },
  async ({ path: filePath }) => {
    const res = await fetch(`${BASE_URL}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
    }
    return {
      content: [{ type: "text" as const, text: `Opened for editing:\n  URL: ${data.url}\n  Slug: ${data.slug}` }],
    };
  },
);

server.tool(
  "list_documents",
  "List all markdown documents currently registered for editing.",
  {},
  async () => {
    const res = await fetch(`${BASE_URL}/api/docs`);
    const docs = await res.json();
    if (docs.length === 0) {
      return { content: [{ type: "text" as const, text: "No documents registered." }] };
    }
    const lines = docs.map((d: any) => `  ${d.fileName} → ${d.url}`).join("\n");
    return { content: [{ type: "text" as const, text: `Registered documents:\n${lines}` }] };
  },
);

server.tool(
  "close_document",
  "Stop serving a document. Removes it from the registry so it's no longer accessible in the browser. Does not delete the file on disk.",
  { slug: z.string().describe("The document slug (from open_document or list_documents)") },
  async ({ slug }) => {
    const res = await fetch(`${BASE_URL}/api/doc/${slug}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Closed document: ${slug}` }] };
  },
);

const transport = new StdioServerTransport();

(async () => {
  await server.connect(transport);
})();
