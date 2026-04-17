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
const DEFAULT_CONTENT_WIDTH_REM = 48;
const MIN_CONTENT_WIDTH_REM = 36;
const MAX_CONTENT_WIDTH_REM = 80;
const CONTENT_WIDTH_STORAGE_KEY = "plan-present-content-width-rem";

export default function Editor({ slug }: { slug: string }) {
  const [fileName, setFileName] = useState("");
  const [absolutePath, setAbsolutePath] = useState("");
  const baseMtimeRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [contentWidthRem, setContentWidthRem] = useState(DEFAULT_CONTENT_WIDTH_REM);
  const [readOnly, setReadOnly] = useState(true);

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
    editable: false,
  });

  const autosave = useAutosave(editor, slug, baseMtimeRef);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  useEffect(() => {
    const savedWidth = window.localStorage.getItem(CONTENT_WIDTH_STORAGE_KEY);
    if (!savedWidth) return;

    const parsed = Number(savedWidth);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(MAX_CONTENT_WIDTH_REM, Math.max(MIN_CONTENT_WIDTH_REM, parsed));
      setContentWidthRem(clamped);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CONTENT_WIDTH_STORAGE_KEY, String(contentWidthRem));
  }, [contentWidthRem]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/doc/${slug}`);
        if (!res.ok) {
          if (res.status === 404) {
            // File gone — server already removed it from registry; go back to list
            window.location.href = "/";
            return;
          }
          setError(`Error ${res.status}`);
          setLoading(false);
          return;
        }
        const data: DocResponse = await res.json();
        if (cancelled) return;

        setFileName(data.fileName);
        setAbsolutePath(data.absolutePath);
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
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function handleHome() {
    window.location.href = "/";
  }

  async function handleDeregister() {
    if (closing) return;
    setClosing(true);
    setActionError(null);

    let saved: boolean;
    try {
      saved = await autosave.save();
    } catch {
      saved = false;
    }

    if (!saved) {
      setClosing(false);
      setActionError("Save failed — your changes have NOT been lost. Please try again.");
      return;
    }

    try {
      const res = await fetch(`/api/doc/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        setActionError("Document saved, but failed to unregister.");
      }
    } finally {
      window.location.href = "/";
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm(`Permanently delete "${fileName}" from disk?`)) return;
    setDeleting(true);
    setActionError(null);
    try {
      await fetch(`/api/doc/${slug}/file`, { method: "DELETE" });
    } finally {
      window.location.href = "/";
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
      {absolutePath && (
        <div
          style={{
            padding: "4px 16px",
            background: "#f4f4f4",
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#555",
            borderBottom: "1px solid #e0e0e0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={absolutePath}
        >
          {absolutePath}
        </div>
      )}
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
        <span>
          {fileName}
          {readOnly && <span className="read-only-badge">Read-only</span>}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {actionError && (
            <span style={{ color: "#cc3300", fontSize: "13px" }}>{actionError}</span>
          )}
          <button
            className={readOnly ? "btn-toggle-edit" : "btn-toggle-edit btn-toggle-edit--active"}
            onClick={() => setReadOnly((v) => !v)}
            title={readOnly ? "Enable editing" : "Lock to read-only"}
          >
            {readOnly ? "Edit" : "Editing"}
          </button>
          <button
            className="btn-save"
            onClick={handleHome}
          >
            Home
          </button>
          <button
            className="btn-done"
            onClick={handleDeregister}
            disabled={closing || deleting || autosave.isSaving}
          >
            {closing ? "Closing..." : "Deregister"}
          </button>
          <button
            className="btn-delete"
            onClick={handleDelete}
            disabled={closing || deleting || autosave.isSaving}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </header>
      <EditorContent
        editor={editor}
        style={
          {
            flex: 1,
            overflow: "auto",
            "--content-max-width": `${contentWidthRem}rem`,
          } as CSSProperties
        }
      />
      <div className="width-slider">
        <label htmlFor="content-width-slider">Width</label>
        <input
          id="content-width-slider"
          type="range"
          min={MIN_CONTENT_WIDTH_REM}
          max={MAX_CONTENT_WIDTH_REM}
          step={1}
          value={contentWidthRem}
          onChange={(e) => setContentWidthRem(Number(e.target.value))}
        />
        <output htmlFor="content-width-slider">{contentWidthRem}rem</output>
      </div>
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
