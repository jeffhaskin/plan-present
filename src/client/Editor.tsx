import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
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
import type { DocResponse } from "../shared/types";

const lowlight = createLowlight(common);

export default function Editor({ slug }: { slug: string }) {
  const [fileName, setFileName] = useState("");
  const [baseMtime, setBaseMtime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const editor = useEditor({
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
    content: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/doc/${slug}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Document not found" : `Error ${res.status}`);
          setLoading(false);
          return;
        }
        const data: DocResponse = await res.json();
        if (cancelled) return;

        setFileName(data.fileName);
        setBaseMtime(data.mtime);

        if (editor) {
          editor.commands.setContent(data.content, { emitUpdate: false });
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load document");
          setLoading(false);
        }
      }
    }

    if (editor) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [slug, editor]);

  if (error) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>Error</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid #e0e0e0",
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          color: "#666",
          flexShrink: 0,
        }}
      >
        {fileName}
      </header>
      <EditorContent
        editor={editor}
        style={{ flex: 1, overflow: "auto" }}
      />
    </div>
  );
}
