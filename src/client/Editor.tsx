import { useEffect, useRef, useState, type CSSProperties } from "react";
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
import { useAutosave } from "./useAutosave";
import type { DocResponse } from "../shared/types";
import "./style.css";

const lowlight = createLowlight(common);

export default function Editor({ slug }: { slug: string }) {
  const [fileName, setFileName] = useState("");
  const baseMtimeRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

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

  const autosave = useAutosave(editor, slug, baseMtimeRef);

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
        baseMtimeRef.current = data.mtime;

        if (editor) {
          editor.commands.setContent(data.content, { emitUpdate: false, contentType: 'markdown' });
        }
        setLoading(false);
      } catch {
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

  const [closing, setClosing] = useState(false);

  function handleSaveAndClose() {
    if (closing) return;
    setClosing(true);

    const doClose = () => {
      fetch(`/api/doc/${slug}`, { method: "DELETE" })
        .finally(() => setClosed(true));
    };

    try {
      autosave.save().then(doClose).catch(doClose);
    } catch {
      doClose();
    }
  }

  if (closed) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <h1>Done</h1>
        <p><strong>{fileName}</strong> has been saved and closed.</p>
        <p style={{ color: "#666", fontSize: "14px" }}>You can close this tab.</p>
      </main>
    );
  }

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
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{fileName}</span>
        <button
          className="btn-done"
          onClick={handleSaveAndClose}
          disabled={closing || autosave.isSaving}
        >
          {closing ? "Closing..." : "Save & Done"}
        </button>
      </header>
      <EditorContent
        editor={editor}
        style={{ flex: 1, overflow: "auto" }}
      />
      <SaveIndicator status={autosave.status} message={autosave.message} />
    </div>
  );
}

function SaveIndicator({ status, message }: { status: string; message: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === "idle") return;
    setVisible(true);

    if (status === "saved") {
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [status, message]);

  if (!visible || status === "idle") return null;

  const colorMap: Record<string, string> = {
    saving: "#999",
    saved: "#339933",
    conflict: "#cc7700",
    error: "#cc3300",
  };

  const style: CSSProperties = {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    padding: "6px 12px",
    borderRadius: "4px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    color: "#fff",
    background: colorMap[status] ?? "#999",
    zIndex: 1000,
    transition: "opacity 0.3s",
    opacity: visible ? 1 : 0,
  };

  return <div style={style}>{message}</div>;
}
