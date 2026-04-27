import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
interface HeadingItem {
  marker: string; // outline marker (incl. its terminator), e.g. "1.0", "1.1.1)", "I.", "" if none
  body: string;   // the rest of the heading text (or the whole thing when no marker)
}

// Split a heading into its outline marker and body. Recognized markers (each
// followed by `.` or `)` and a space):
//   pure decimal: 1.0, 1.1, 1.1.1
//   number:       1., 1)
//   letter:       A., a., A), a)
//   Roman:        I., II., iv., IX., I), ii)  (chars from IVXLCDM / ivxlcdm)
function parseOutlineMarker(text: string): HeadingItem {
  const trimmed = text.trim();
  if (!trimmed) return { marker: "", body: "" };

  const decimalMatch = trimmed.match(/^(\d+(?:\.\d+)+[.)]?)\s+(.*)$/);
  if (decimalMatch) return { marker: decimalMatch[1], body: decimalMatch[2] };

  const stdMatch = trimmed.match(
    /^((?:[IVXLCDM]+|[ivxlcdm]+|[A-Z]|[a-z]|\d+)[.)])\s+(.*)$/,
  );
  if (stdMatch) return { marker: stdMatch[1], body: stdMatch[2] };

  return { marker: "", body: trimmed };
}

const NAV_COLLAPSED_STORAGE_KEY = "plan-present-nav-collapsed";

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
  const [externalChangesPending, setExternalChangesPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, String(navCollapsed));
    } catch {
      // ignore quota / disabled storage
    }
  }, [navCollapsed]);

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

  const refreshHeadings = useCallback(() => {
    if (!editor) return;
    const items: HeadingItem[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading") {
        if (node.attrs.level === 2) {
          items.push(parseOutlineMarker(node.textContent));
        }
        return false; // headings are flat — don't descend further
      }
      return true;
    });
    setHeadings(items);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", refreshHeadings);
    return () => {
      editor.off("update", refreshHeadings);
    };
  }, [editor, refreshHeadings]);

  const navigateToHeading = useCallback(
    (index: number) => {
      if (!editor) return;
      const dom = editor.view.dom as HTMLElement;
      const allHeadings = Array.from(dom.querySelectorAll("h2"));
      const target = allHeadings[index] as HTMLElement | undefined;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [editor],
  );

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
          refreshHeadings();
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
  }, [slug, editor, refreshHeadings]);

  const { markClean, isDirty } = autosave;

  const applyFromServer = useCallback(
    async (force: boolean) => {
      if (!editor) return;
      if (baseMtimeRef.current === 0) return; // initial load hasn't completed
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        const res = await fetch(`/api/doc/${slug}`);
        if (!res.ok) return;
        const data: DocResponse = await res.json();
        if (data.mtime === baseMtimeRef.current) {
          setExternalChangesPending(false);
          return;
        }
        if (!force && isDirty()) {
          setExternalChangesPending(true);
          return;
        }
        editor.commands.setContent(data.content, { emitUpdate: false, contentType: "markdown" });
        markClean((editor as any).getMarkdown());
        baseMtimeRef.current = data.mtime;
        setExternalChangesPending(false);
        refreshHeadings();
      } catch {
        // Swallow network errors; the save path's conflict detection is the safety net.
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [editor, slug, isDirty, markClean, refreshHeadings],
  );

  useEffect(() => {
    if (!editor) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") applyFromServer(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [editor, applyFromServer]);

  const handleRefreshClick = useCallback(async () => {
    if (isDirty()) {
      if (!window.confirm("Discard your unsaved changes and reload this document from disk?")) {
        return;
      }
    }
    await applyFromServer(true);
  }, [applyFromServer, isDirty]);

  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [plainMode, setPlainMode] = useState<"off" | "view" | "edit">("off");
  const [plainText, setPlainText] = useState("");

  // Push pending plain-text edits back into the rich editor and exit plain-text-edit
  // mode. Other actions call this first so they always operate on the latest content.
  function commitPlainTextEditIfActive() {
    if (!editor) return;
    if (plainMode === "edit") {
      editor.commands.setContent(plainText, { emitUpdate: true, contentType: "markdown" });
      setPlainMode("off");
    }
  }

  function togglePlainView() {
    if (!editor) return;
    if (plainMode === "view") {
      setPlainMode("off");
      return;
    }
    if (plainMode === "edit") {
      // Commit pending edits, then switch to read-only plain text view.
      editor.commands.setContent(plainText, { emitUpdate: true, contentType: "markdown" });
      setPlainMode("view");
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
    if (plainMode === "view") {
      // Re-seed plainText from editor in case external refresh changed it,
      // then become editable.
      setPlainText((editor as any).getMarkdown());
      setPlainMode("edit");
      return;
    }
    setPlainText((editor as any).getMarkdown());
    setPlainMode("edit");
  }

  function handlePadlockToggle() {
    commitPlainTextEditIfActive();
    setReadOnly((v) => !v);
  }

  function handleHome() {
    commitPlainTextEditIfActive();
    window.location.href = "/";
  }

  // Try to go back to wherever the user came from. Uses history.back() when
  // the referrer is from this same origin (i.e., they navigated here from /
  // or /tree); otherwise falls back to the list home so the button is never
  // a no-op.
  function handleBack() {
    commitPlainTextEditIfActive();
    let internal = false;
    if (document.referrer) {
      try {
        internal = new URL(document.referrer).origin === window.location.origin;
      } catch {
        /* ignore */
      }
    }
    if (internal && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  }

  async function handleDeregister() {
    if (closing) return;
    commitPlainTextEditIfActive();
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
    commitPlainTextEditIfActive();
    setDeleting(true);
    setActionError(null);
    try {
      await fetch(`/api/doc/${slug}/file`, { method: "DELETE" });
    } finally {
      window.location.href = "/";
    }
  }

  // The doc is "editable" any time edits are accepted in any mode.
  const docEditable = plainMode === "edit" || (plainMode === "off" && !readOnly);

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
    <div
      style={
        {
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          "--content-max-width": `${contentWidthRem}rem`,
        } as CSSProperties
      }
    >
      {absolutePath && (
        <div className="app-top-bar">
          <span className="app-brand" aria-label="plan-present">
            <img
              src="/icon_dark.png"
              className="theme-icon-dark"
              style={{ height: "1em", marginRight: "0.35em" }}
              alt=""
            />
            <img
              src="/icon_light.png"
              className="theme-icon-light"
              style={{ height: "1em", marginRight: "0.35em" }}
              alt=""
            />
            plan-present
          </span>
          <button
            type="button"
            className="home-switch"
            onClick={handleBack}
            title="Back to previous view"
            aria-label="Back"
          >
            <IconArrowLeft />
          </button>
          <nav className="home-switcher" aria-label="Home view">
            <button
              type="button"
              className="home-switch home-switch--home"
              onClick={handleHome}
              title="Document list"
              aria-label="Document list"
            >
              <IconHome />
            </button>
            <button
              type="button"
              className="home-switch home-switch--tree"
              onClick={() => {
                commitPlainTextEditIfActive();
                window.location.href = "/tree";
              }}
              title="Markdown tree"
              aria-label="Markdown tree"
            >
              <IconHierarchy />
            </button>
          </nav>
          <RefreshButton
            onClick={handleRefreshClick}
            disabled={refreshing}
            pending={externalChangesPending}
          />
          <span className="path-bar-flex" style={{ flex: 1 }} />
          <span className="editor-path-text" title={absolutePath}>
            {absolutePath}
          </span>
          <PathCopyButton path={absolutePath} />
          <span
            className={
              docEditable
                ? "doc-state-icon doc-state-icon--editing"
                : "doc-state-icon doc-state-icon--locked"
            }
            role="img"
            aria-label={docEditable ? "Edit mode" : "Read-only"}
            title={docEditable ? "Edit mode" : "Read-only"}
          >
            {docEditable ? <IconLockOpen /> : <IconLockClosed />}
          </span>
          <span className="path-bar-flex" style={{ flex: 1 }} />
          <div className="path-actions">
            <IconButton
              onClick={handlePadlockToggle}
              active={plainMode === "off" && !readOnly}
              title={readOnly ? "Enable editing" : "Lock to read-only"}
            >
              <IconPencil />
            </IconButton>
            <IconButton
              onClick={togglePlainEdit}
              disabled={!editor}
              active={plainMode === "edit"}
              title={plainMode === "edit" ? "Done editing as plain text" : "Edit as plain text"}
            >
              <IconPlainEdit />
            </IconButton>
            <IconButton
              onClick={togglePlainView}
              disabled={!editor}
              active={plainMode === "view"}
              title={plainMode === "view" ? "Show WYSIWYG" : "Show as plain text"}
            >
              <IconPlainView />
            </IconButton>
            <IconButton
              onClick={handleDeregister}
              disabled={closing || deleting || autosave.isSaving}
              variant="warn"
              title={closing ? "Closing..." : "Deregister (remove from list; file stays on disk)"}
            >
              <IconReset />
            </IconButton>
            <IconButton
              onClick={handleDelete}
              disabled={closing || deleting || autosave.isSaving}
              variant="danger"
              title={deleting ? "Deleting..." : "Delete file from disk"}
            >
              <IconTrash />
            </IconButton>
          </div>
          <span className="path-bar-flex" style={{ flex: 1 }} />
          <ThemeToggle compact />
        </div>
      )}
      {actionError && <div className="editor-action-error">{actionError}</div>}
      <div className="editor-body">
        {plainMode === "off" && headings.length > 0 && (
          <nav
            className={navCollapsed ? "doc-nav doc-nav--collapsed" : "doc-nav"}
            aria-label="Document outline"
          >
            <div className="doc-nav-toolbar">
              <span className="doc-nav-header">Outline</span>
              <button
                type="button"
                className="doc-nav-toggle"
                onClick={() => setNavCollapsed((v) => !v)}
                title={navCollapsed ? "Expand outline" : "Collapse outline"}
                aria-label={navCollapsed ? "Expand outline" : "Collapse outline"}
                aria-expanded={!navCollapsed}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
            <div className="doc-nav-list">
              {headings.map((h, i) => {
                const fullText = h.marker ? `${h.marker} ${h.body}` : h.body;
                return (
                  <button
                    key={i}
                    type="button"
                    className="doc-nav-item"
                    onClick={() => navigateToHeading(i)}
                    title={fullText || "(empty heading)"}
                  >
                    <span className="doc-nav-marker">{h.marker}</span>
                    <span className="doc-nav-text">
                      {h.body || (h.marker ? "" : "(empty heading)")}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
        {plainMode === "off" ? (
          <EditorContent
            editor={editor}
            style={{ flex: 1, overflow: "auto" }}
          />
        ) : (
          <div className="plain-text-wrapper">
            {plainMode === "view" && (
              <div className="plain-copy-overlay" aria-hidden="false">
                <div className="plain-copy-overlay-inner">
                  {/* plainText is set from editor.getMarkdown() — raw markdown,
                      not JSON or HTML. */}
                  <PlainTextCopyButton text={plainText} />
                </div>
              </div>
            )}
            <div className="editor-content-scroll">
              <textarea
                className={
                  plainMode === "view"
                    ? "editor-plain-text editor-plain-text--view"
                    : "editor-plain-text"
                }
                value={plainText}
                readOnly={plainMode === "view"}
                onChange={(e) => setPlainText(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        )}
      </div>
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
        width: 32,
        height: 32,
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
          width="20"
          height="20"
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
          width="20"
          height="20"
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

function PlainTextCopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function onClick() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "error");
    setTimeout(() => setState("idle"), 1200);
  }
  const cls =
    state === "copied"
      ? "plain-copy-btn plain-copy-btn--copied"
      : state === "error"
      ? "plain-copy-btn plain-copy-btn--error"
      : "plain-copy-btn";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={cls}
      title="Copy entire document to clipboard"
      aria-label="Copy entire document to clipboard"
    >
      {state === "copied" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="18"
          height="18"
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
          width="18"
          height="18"
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

function RefreshButton({
  onClick,
  disabled,
  pending,
}: {
  onClick: () => void;
  disabled: boolean;
  pending: boolean;
}) {
  const palette = pending
    ? { bg: "#fff8e6", fg: "#b36b00", border: "#e0b060" }
    : { bg: "transparent", fg: "#666", border: "transparent" };
  const title = pending
    ? "External changes detected — click to reload"
    : "Reload document from disk";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        position: "relative",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 4,
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
        lineHeight: 0,
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      {pending && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 7,
            height: 7,
            background: "#cc7700",
            border: "1px solid var(--bg, #fff)",
            borderRadius: "50%",
          }}
        />
      )}
    </button>
  );
}

const ICON_SVG_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconHome = () => (
  <svg {...ICON_SVG_PROPS}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const IconHierarchy = () => (
  <svg {...ICON_SVG_PROPS}>
    <line x1="3" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="13" y1="18" x2="20" y2="18" />
  </svg>
);

const IconArrowLeft = () => (
  <svg {...ICON_SVG_PROPS}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const IconPencil = () => (
  <svg {...ICON_SVG_PROPS}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

const IconLockClosed = () => (
  <svg {...ICON_SVG_PROPS}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const IconLockOpen = () => (
  <svg {...ICON_SVG_PROPS}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

const IconPlainEdit = () => (
  <svg {...ICON_SVG_PROPS}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const IconPlainView = () => (
  <svg {...ICON_SVG_PROPS}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const IconReset = () => (
  <svg {...ICON_SVG_PROPS}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const IconTrash = () => (
  <svg {...ICON_SVG_PROPS}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

function IconButton({
  onClick,
  disabled,
  title,
  active,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  variant?: "default" | "danger" | "home" | "warn" | "outline";
  children: ReactNode;
}) {
  const classes = ["path-icon-btn"];
  if (active) classes.push("path-icon-btn--active");
  if (variant === "danger") classes.push("path-icon-btn--danger");
  if (variant === "home") classes.push("path-icon-btn--home");
  if (variant === "warn") classes.push("path-icon-btn--warn");
  if (variant === "outline") classes.push("path-icon-btn--outline");
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      className={classes.join(" ")}
      title={title}
      aria-label={title}
    >
      {children}
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
