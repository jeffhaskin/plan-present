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
import { ThemeToggle } from "./App";
import "./style.css";

const lowlight = createLowlight(common);

const COPY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  // Legacy fallback: hidden textarea + execCommand('copy'). Works over plain HTTP.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.padding = "0";
  ta.style.border = "none";
  ta.style.outline = "none";
  ta.style.boxShadow = "none";
  ta.style.background = "transparent";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const selection = document.getSelection();
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  if (savedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  return ok;
}
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
    if (!editor) return;
    const root = editor.view.dom as HTMLElement;
    let frame = 0;

    function inject() {
      const pres = root.querySelectorAll("pre");
      pres.forEach((pre) => {
        if (pre.querySelector(":scope > .copy-btn")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "copy-btn";
        btn.contentEditable = "false";
        btn.setAttribute("aria-label", "Copy");
        btn.title = "Copy";
        btn.innerHTML = COPY_SVG;
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const code = pre.querySelector("code");
          const text = code?.textContent ?? pre.textContent ?? "";
          const ok = await copyText(text);
          if (ok) {
            btn.classList.add("copied");
            btn.innerHTML = CHECK_SVG;
            setTimeout(() => {
              btn.classList.remove("copied");
              btn.innerHTML = COPY_SVG;
            }, 1200);
          } else {
            btn.classList.add("error");
            setTimeout(() => btn.classList.remove("error"), 1200);
          }
        });
        pre.appendChild(btn);
      });
    }

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        inject();
      });
    }

    inject();
    const obs = new MutationObserver(schedule);
    obs.observe(root, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);

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
          // Seed the autosave baseline with the editor's own re-serialization of
          // the loaded content, so phantom "update" events from DOM widget
          // injection (copy buttons in <pre>) don't flag the doc as dirty.
          autosave.markClean((editor as any).getMarkdown());
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
  const [plainMode, setPlainMode] = useState<"off" | "view" | "edit">("off");
  const [plainText, setPlainText] = useState("");

  function togglePlainView() {
    if (!editor) return;
    if (plainMode === "view") {
      setPlainMode("off");
      return;
    }
    setPlainText((editor as any).getMarkdown());
    setPlainMode("view");
  }

  function togglePlainEdit() {
    if (!editor) return;
    if (plainMode === "edit") {
      editor.commands.setContent(plainText, { emitUpdate: true, contentType: "markdown" });
      setPlainMode("off");
      return;
    }
    setPlainText((editor as any).getMarkdown());
    setPlainMode("edit");
  }

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
        <div className="editor-path-bar">
          <span className="editor-path-text" title={absolutePath}>
            {absolutePath}
          </span>
          <PathCopyButton path={absolutePath} />
          <ThemeToggle compact />
        </div>
      )}
      <header className="editor-header">
        <span>
          {fileName}
          {readOnly && <span className="read-only-badge">Read-only</span>}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {actionError && (
            <span style={{ color: "#cc3300", fontSize: "13px" }}>{actionError}</span>
          )}
          <button
            className="btn-save btn-home"
            onClick={handleHome}
          >
            Home
          </button>
          <button
            className={readOnly ? "btn-toggle-edit" : "btn-toggle-edit btn-toggle-edit--active"}
            onClick={() => setReadOnly((v) => !v)}
            title={readOnly ? "Enable editing" : "Lock to read-only"}
          >
            {readOnly ? "Edit" : "Editing"}
          </button>
          <button
            className="btn-save"
            onClick={togglePlainEdit}
            disabled={!editor || plainMode === "view"}
            title="Edit the document as raw markdown"
          >
            {plainMode === "edit" ? "Done editing" : "Edit as plain text"}
          </button>
          <button
            className="btn-save"
            onClick={togglePlainView}
            disabled={!editor || plainMode === "edit"}
            title="Render the document as plain-text markdown"
          >
            {plainMode === "view" ? "Show WYSIWYG" : "Show as plain text"}
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
      {plainMode === "off" ? (
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
      ) : (
        <textarea
          value={plainText}
          readOnly={plainMode === "view"}
          onChange={(e) => setPlainText(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            overflow: "auto",
            width: "100%",
            boxSizing: "border-box",
            padding: "1rem",
            border: "none",
            outline: "none",
            resize: "none",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "14px",
            lineHeight: 1.5,
            background: plainMode === "view" ? "#fafafa" : "#fff",
            color: "#222",
            whiteSpace: "pre",
          }}
        />
      )}
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

function PathCopyButton({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function onClick() {
    const ok = await copyText(path);
    setState(ok ? "copied" : "error");
    setTimeout(() => setState("idle"), 1200);
  }
  const palette =
    state === "copied"
      ? { bg: "#f1f9f1", fg: "#2a7a2a", border: "#7ab77a" }
      : state === "error"
      ? { bg: "#fdf1ee", fg: "#cc3300", border: "#e0a090" }
      : { bg: "transparent", fg: "#666", border: "transparent" };
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title="Copy full pathname"
      aria-label="Copy full pathname"
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        padding: 0,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 4,
        cursor: "pointer",
        lineHeight: 0,
      }}
    >
      {state === "copied" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
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
