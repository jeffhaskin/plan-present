import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { ThemeToggle } from "./App";
import type {
  BrowseResponse,
  DocSummary,
  OpenResponse,
  TreeResponse,
} from "../shared/types";
import "./style.css";

const ICON_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const HomeIcon = () => (
  <svg {...ICON_PROPS} width={20} height={20}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const HierarchyIcon = () => (
  <svg {...ICON_PROPS} width={20} height={20}>
    <line x1="3" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="13" y1="18" x2="20" y2="18" />
  </svg>
);

const TrashIcon = () => (
  <svg {...ICON_PROPS} width={15} height={15}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const CopyIcon = () => (
  <svg {...ICON_PROPS} width={15} height={15}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const CheckIcon = () => (
  <svg {...ICON_PROPS} width={15} height={15} strokeWidth={2.5}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronIcon = () => (
  <svg {...ICON_PROPS} width={14} height={14}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const FolderIcon = () => (
  <svg {...ICON_PROPS} width={16} height={16}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const SearchIcon = () => (
  <svg {...ICON_PROPS} width={16} height={16}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const RefreshIcon = () => (
  <svg {...ICON_PROPS} width={18} height={18}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const PinIcon = () => (
  <svg {...ICON_PROPS} width={14} height={14}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

type FolderState = "up" | "right" | "down";

function isDescendant(parentRel: string, candidateRel: string): boolean {
  if (candidateRel === "" || candidateRel === parentRel) return false;
  if (parentRel === "") return true;
  return candidateRel.startsWith(parentRel + "/");
}

function isDirectChild(parentRel: string, candidateRel: string): boolean {
  if (candidateRel === "" || candidateRel === parentRel) return false;
  if (parentRel === "") return !candidateRel.includes("/");
  if (!candidateRel.startsWith(parentRel + "/")) return false;
  return candidateRel.split("/").length === parentRel.split("/").length + 1;
}

function joinPath(base: string, rel: string, file: string): string {
  if (!rel) return `${base}/${file}`;
  return `${base}/${rel}/${file}`;
}

// Last path segment of an absolute path. "/foo/bar" → "bar", "/foo/bar/" → "bar",
// "/" → "/", "" → "".
function basename(absPath: string): string {
  const trimmed = absPath.replace(/\/+$/, "");
  if (!trimmed) return absPath ? "/" : "";
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1) || "/";
}

function nextFolderState(
  cur: FolderState,
  hasSub: boolean,
  hasFiles: boolean,
): FolderState {
  if (!hasSub && !hasFiles) return cur;
  if (cur === "up") return hasSub ? "right" : "down";
  if (cur === "right") return hasFiles ? "down" : "up";
  return "up";
}

interface DirectoryPickerProps {
  initialPath: string;
  onSelect: (absPath: string) => void;
  onCancel: () => void;
}

function DirectoryPicker({ initialPath, onSelect, onCancel }: DirectoryPickerProps) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(target)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Error ${res.status}`);
      }
      const body: BrowseResponse = await res.json();
      setData(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to browse";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    browse(initialPath);
    // Initial path is captured from props on mount; subsequent navigation is
    // driven by user clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function navigateTo(target: string) {
    browse(target);
  }

  function joinChild(parent: string, child: string): string {
    return parent.endsWith("/") ? parent + child : `${parent}/${child}`;
  }

  return (
    <div className="picker-overlay" onClick={onCancel}>
      <div
        className="picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Select directory"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="picker-header">
          <h2>Select a root directory</h2>
          <button
            type="button"
            className="picker-close"
            onClick={onCancel}
            aria-label="Cancel"
          >
            ×
          </button>
        </header>
        <div className="picker-path" title={data?.absolute}>
          {data?.absolute ?? (loading ? "Loading…" : "—")}
        </div>
        {error && <div className="picker-error">{error}</div>}
        <ul className="picker-list">
          {data?.parent && (
            <li>
              <button
                type="button"
                className="picker-item picker-item--up"
                onClick={() => navigateTo(data.parent!)}
                title={data.parent}
              >
                <span className="picker-item-glyph">↑</span>
                <span>.. (parent)</span>
              </button>
            </li>
          )}
          {data && data.directories.length === 0 && (
            <li className="picker-empty">No subdirectories.</li>
          )}
          {data?.directories.map((d) => (
            <li key={d}>
              <button
                type="button"
                className="picker-item"
                onClick={() => navigateTo(joinChild(data.absolute, d))}
              >
                <span className="picker-item-glyph">
                  <FolderIcon />
                </span>
                <span className="picker-item-name">{d}</span>
              </button>
            </li>
          ))}
        </ul>
        <footer className="picker-footer">
          <button type="button" className="picker-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="picker-btn picker-btn--primary"
            onClick={() => data && onSelect(data.absolute)}
            disabled={!data || loading}
          >
            Select this folder
          </button>
        </footer>
      </div>
    </div>
  );
}

interface TreePaneProps {
  paneId: string;
  storageKey: string;
  docs: DocSummary[];
  refreshDocs: () => Promise<void>;
  refreshTick: number;
}

function TreePane({ paneId, storageKey, docs, refreshDocs, refreshTick }: TreePaneProps) {
  const STATES_KEY = `plan-present-tree-folder-states-${paneId}`;
  const LAST_ROOT_KEY = `plan-present-tree-last-root-${paneId}`;

  const [pathInput, setPathInput] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [tree, setTree] = useState<TreeResponse | null>(null);
  // Restore expanded/collapsed folder state from localStorage so going to a doc
  // and coming back leaves the tree in the same shape.
  const [folderStates, setFolderStates] = useState<Map<string, FolderState>>(() => {
    try {
      const raw = localStorage.getItem(STATES_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string>;
        const m = new Map<string, FolderState>();
        for (const [k, v] of Object.entries(obj)) {
          if (v === "up" || v === "right" || v === "down") {
            m.set(k, v);
          }
        }
        if (m.size > 0) return m;
      }
    } catch {
      // fall through to default
    }
    return new Map([["", "right" as FolderState]]);
  });

  // Persist folder state on every change.
  useEffect(() => {
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of folderStates) obj[k] = v;
      localStorage.setItem(STATES_KEY, JSON.stringify(obj));
    } catch {
      // quota / disabled — not fatal
    }
  }, [folderStates, STATES_KEY]);
  const [loading, setLoading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const docByPath = new Map(docs.map((d) => [d.absolutePath, d]));

  const loadTree = useCallback(
    async (rawPath: string) => {
      const trimmed = rawPath.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      try {
        const [treeRes] = await Promise.all([
          fetch(`/api/tree?path=${encodeURIComponent(trimmed)}`),
          refreshDocs(),
        ]);
        if (!treeRes.ok) {
          const data = (await treeRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error || `Error ${treeRes.status}`);
        }
        const data: TreeResponse = await treeRes.json();
        setTree(data);

        // Only reset folder states when the rootPath actually changes (i.e.
        // user typed a new path or browsed to a different one). Reloading the
        // same path — or returning from a doc view — keeps what was expanded.
        let lastRoot = "";
        try {
          lastRoot = localStorage.getItem(LAST_ROOT_KEY) ?? "";
        } catch {
          /* ignore */
        }
        if (lastRoot !== data.rootPath) {
          const rootFolder = data.folders.find((f) => f.relPath === "");
          const rootHasSub = data.folders.some((f) => isDescendant("", f.relPath));
          const rootHasFiles = !!rootFolder && rootFolder.files.length > 0;
          const rootState: FolderState = rootHasSub
            ? "right"
            : rootHasFiles
            ? "down"
            : "up";
          setFolderStates(new Map([["", rootState]]));
        }
        try {
          localStorage.setItem(LAST_ROOT_KEY, data.rootPath);
          localStorage.setItem(storageKey, data.rootPath);
        } catch {
          /* ignore */
        }
        setPathInput(data.rootPath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load directory";
        setError(msg);
        setTree(null);
      } finally {
        setLoading(false);
      }
    },
    [refreshDocs, storageKey],
  );

  useEffect(() => {
    if (pathInput.trim()) loadTree(pathInput.trim());
    // Auto-load only on mount if a saved path exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BFCache restore: when the user navigates to a doc and presses back, the
  // browser may resurrect this page from cache with frozen state — busyPath
  // still set from openFile (which never gets to clear it before navigating),
  // and `loading` stuck true if a fetch was aborted mid-flight. Both wedge the
  // UI. Reset transient state and re-fetch on restore.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      setBusyPath(null);
      setLoading(false);
      if (pathInput.trim()) loadTree(pathInput.trim());
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [loadTree, pathInput]);

  // Parent-driven refresh: re-load the current tree (if any) when the tick
  // increments. Skipped on first render (tick === 0) so it doesn't clash with
  // the mount-time auto-load above.
  useEffect(() => {
    if (refreshTick === 0) return;
    if (pathInput.trim()) loadTree(pathInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  function getFolderState(relPath: string): FolderState {
    return folderStates.get(relPath) ?? "up";
  }

  function isFolderHidden(relPath: string): boolean {
    if (relPath === "") return false;
    const parts = relPath.split("/");
    for (let i = 0; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      const state = folderStates.get(ancestor) ?? "up";
      if (state === "up") return true;
    }
    return false;
  }

  function folderHasSubfolders(relPath: string): boolean {
    if (!tree) return false;
    return tree.folders.some((f) => isDescendant(relPath, f.relPath));
  }

  function cycleFolder(relPath: string) {
    if (!tree) return;
    const folder = tree.folders.find((f) => f.relPath === relPath);
    if (!folder) return;
    const hasSub = folderHasSubfolders(relPath);
    const hasFiles = folder.files.length > 0;
    if (!hasSub && !hasFiles) return;
    const cur = folderStates.get(relPath) ?? "up";
    const next = nextFolderState(cur, hasSub, hasFiles);
    if (next === cur) return;
    setFolderStates((prev) => {
      const m = new Map(prev);
      m.set(relPath, next);
      if (next === "right") {
        for (const f of tree.folders) {
          if (isDirectChild(relPath, f.relPath)) m.set(f.relPath, "up");
        }
      }
      return m;
    });
  }

  async function openFile(absPath: string) {
    if (busyPath) return;
    setBusyPath(absPath);
    setError(null);
    try {
      const res = await fetch("/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: absPath }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Error ${res.status}`);
      }
      const data: OpenResponse = await res.json();
      // Commit the cleared busy state synchronously before navigating, so the
      // BFCache snapshot doesn't capture a stuck `busyPath` that would freeze
      // every click guard when the user presses back.
      flushSync(() => setBusyPath(null));
      window.location.href = `/doc/${data.slug}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to open file";
      setError(msg);
      setBusyPath(null);
    }
  }

  // Cycle the pin button through three states based on the file's registry status:
  //   dimmed     (not registered)        — click registers via POST /open
  //   registered (in registry, unpinned) — click pins via POST /api/doc/:slug/pin
  //   pinned     (in registry, pinned)   — click deregisters via DELETE /api/doc/:slug
  async function cyclePin(absPath: string) {
    if (busyPath) return;
    setBusyPath(absPath);
    setError(null);
    try {
      const existing = docByPath.get(absPath);
      if (!existing) {
        // dimmed → registered: register the file
        const res = await fetch("/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: absPath }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `Error ${res.status}`);
        }
      } else if (!existing.pinned) {
        // registered → pinned: pin to priority list
        const res = await fetch(`/api/doc/${existing.slug}/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: true }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `Error ${res.status}`);
        }
      } else {
        // pinned → dimmed: deregister entirely
        const res = await fetch(`/api/doc/${existing.slug}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `Error ${res.status}`);
        }
      }
      await refreshDocs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update pin state";
      setError(msg);
    } finally {
      setBusyPath(null);
    }
  }

  // Collect every .md file under a folder (including descendants), as absolute paths.
  function collectAllFilesUnder(folderRelPath: string): string[] {
    if (!tree) return [];
    const out: string[] = [];
    for (const f of tree.folders) {
      if (f.relPath !== folderRelPath && !isDescendant(folderRelPath, f.relPath)) continue;
      for (const file of f.files) {
        out.push(joinPath(tree.rootPath, f.relPath, file));
      }
    }
    return out;
  }

  // Folder pin state is the lowest common denominator across all files under it:
  //   any file unregistered → dimmed
  //   all registered, but at least one not pinned → registered
  //   all pinned → pinned
  function folderPinStateFor(absFiles: string[]): "dimmed" | "registered" | "pinned" {
    if (absFiles.length === 0) return "dimmed";
    let allPinned = true;
    for (const p of absFiles) {
      const d = docByPath.get(p);
      if (!d) return "dimmed";
      if (!d.pinned) allPinned = false;
    }
    return allPinned ? "pinned" : "registered";
  }

  function folderBusyKey(folderRelPath: string): string {
    return `folder:${folderRelPath || "__root__"}`;
  }

  // Click cycle on a folder's pin button:
  //   dimmed     → registered : POST /open for each unregistered file
  //   registered → pinned     : pin every still-unpinned registered file
  //   pinned     → dimmed     : DELETE /api/doc/:slug for each registered file
  // Operations run in parallel via Promise.allSettled so a single failure
  // doesn't abort the rest; partial-failure count is surfaced via setError.
  async function cycleFolderPin(folderRelPath: string) {
    if (!tree || busyPath) return;
    const absFiles = collectAllFilesUnder(folderRelPath);
    if (absFiles.length === 0) return;
    const state = folderPinStateFor(absFiles);
    setBusyPath(folderBusyKey(folderRelPath));
    setError(null);
    try {
      const promises: Promise<Response>[] = [];
      if (state === "dimmed") {
        for (const p of absFiles) {
          if (docByPath.get(p)) continue;
          promises.push(
            fetch("/open", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: p }),
            }),
          );
        }
      } else if (state === "registered") {
        for (const p of absFiles) {
          const d = docByPath.get(p);
          if (!d || d.pinned) continue;
          promises.push(
            fetch(`/api/doc/${d.slug}/pin`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pinned: true }),
            }),
          );
        }
      } else {
        for (const p of absFiles) {
          const d = docByPath.get(p);
          if (!d) continue;
          promises.push(fetch(`/api/doc/${d.slug}`, { method: "DELETE" }));
        }
      }
      const results = await Promise.allSettled(promises);
      const failures = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
      ).length;
      if (failures > 0) {
        setError(`${failures} of ${promises.length} bulk operations failed`);
      }
      await refreshDocs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update folder pin state";
      setError(msg);
    } finally {
      setBusyPath(null);
    }
  }

  async function deleteFile(absPath: string) {
    if (busyPath) return;
    if (!window.confirm(`Permanently delete "${absPath}" from disk?`)) return;
    setBusyPath(absPath);
    setError(null);
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(absPath)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Error ${res.status}`);
      }
      await Promise.all([loadTree(pathInput), refreshDocs()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete file";
      setError(msg);
    } finally {
      setBusyPath(null);
    }
  }

  async function copyPath(absPath: string) {
    const ok = await copyText(absPath);
    if (ok) {
      setCopiedPath(absPath);
      setTimeout(() => setCopiedPath((cur) => (cur === absPath ? null : cur)), 1200);
    }
  }

  const inputId = `tree-root-input-${paneId}`;

  return (
    <div className="tree-pane">
      <section className="tree-controls">
        <label htmlFor={inputId} className="tree-input-label">
          Root directory
        </label>
        <div className="tree-input-row">
          <input
            id={inputId}
            type="text"
            className="tree-input"
            placeholder="/absolute/path/to/directory"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadTree(pathInput);
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="tree-load-btn"
            onClick={() => setPickerOpen(true)}
            title="Browse for a directory"
            aria-label="Browse for a directory"
          >
            <FolderIcon />
          </button>
          <button
            type="button"
            className={loading ? "tree-load-btn tree-load-btn--loading" : "tree-load-btn"}
            onClick={() => loadTree(pathInput)}
            disabled={loading || !pathInput.trim()}
            title={loading ? "Scanning…" : "Load tree"}
            aria-label="Load tree"
          >
            <SearchIcon />
          </button>
        </div>
        {pickerOpen && (
          <DirectoryPicker
            initialPath={pathInput.trim()}
            onSelect={(absPath) => {
              setPathInput(absPath);
              setPickerOpen(false);
              loadTree(absPath);
            }}
            onCancel={() => setPickerOpen(false)}
          />
        )}
        {error && <div className="tree-error">{error}</div>}
      </section>

      {tree && (
        <section className="tree-results">
          {tree.folders.length === 0 ? (
            <p className="tree-empty">No markdown files found under this directory.</p>
          ) : (
            tree.folders.map((folder) => {
              if (isFolderHidden(folder.relPath)) return null;
              const isRoot = folder.relPath === "";
              const segments = isRoot ? [] : folder.relPath.split("/");
              const heading = isRoot
                ? basename(tree.rootPath) || tree.rootPath
                : segments[segments.length - 1];
              const state = getFolderState(folder.relPath);
              const depth = segments.length;
              const folderStyle = {
                "--folder-depth": String(depth),
              } as CSSProperties;
              const hasSub = folderHasSubfolders(folder.relPath);
              const hasFiles = folder.files.length > 0;
              const isEmpty = !hasSub && !hasFiles;
              const cycleable = !isEmpty;
              const toggleClass =
                state === "up"
                  ? "tree-folder-toggle tree-folder-toggle--up"
                  : state === "down"
                  ? "tree-folder-toggle tree-folder-toggle--down"
                  : "tree-folder-toggle tree-folder-toggle--right";
              const finalToggleClass = isEmpty
                ? "tree-folder-toggle tree-folder-toggle--inert"
                : toggleClass;
              const toggleTitle = isEmpty
                ? "Empty folder"
                : state === "up"
                ? hasSub
                  ? "Click to reveal subfolders"
                  : "Click to show files"
                : state === "right"
                ? hasFiles
                  ? "Click to also show files"
                  : "Click to collapse"
                : "Click to collapse all";
              const folderAbsPath = folder.relPath
                ? `${tree.rootPath}/${folder.relPath}`
                : tree.rootPath;
              const folderCopied = copiedPath === folderAbsPath;
              const folderFiles = collectAllFilesUnder(folder.relPath);
              const folderPinState = folderPinStateFor(folderFiles);
              const folderBusy = busyPath === folderBusyKey(folder.relPath);
              const folderPinClass =
                "tree-row-icon tree-row-icon--pin " +
                (folderPinState === "pinned"
                  ? "tree-row-icon--pin-pinned"
                  : folderPinState === "registered"
                  ? "tree-row-icon--pin-registered"
                  : "tree-row-icon--pin-dimmed");
              const folderPinTitle =
                folderFiles.length === 0
                  ? "No files to pin"
                  : folderPinState === "dimmed"
                  ? `Click to register all ${folderFiles.length} file(s) below this folder`
                  : folderPinState === "registered"
                  ? `Click to pin all ${folderFiles.length} file(s) to home`
                  : `Click to deregister all ${folderFiles.length} file(s)`;
              return (
                <div
                  className="tree-folder"
                  style={folderStyle}
                  key={folder.relPath || "__root__"}
                >
                  <div className="tree-folder-row">
                    {folderFiles.length > 0 && (
                      <button
                        type="button"
                        className={folderPinClass}
                        onClick={() => cycleFolderPin(folder.relPath)}
                        disabled={folderBusy || !!busyPath}
                        title={folderPinTitle}
                        aria-label={folderPinTitle}
                      >
                        <PinIcon />
                      </button>
                    )}
                    <button
                      type="button"
                      className={finalToggleClass}
                      onClick={cycleable ? () => cycleFolder(folder.relPath) : undefined}
                      aria-expanded={cycleable ? state !== "up" : undefined}
                      aria-disabled={isEmpty}
                      title={toggleTitle}
                    >
                      {cycleable ? (
                        <span className="tree-folder-chevron" aria-hidden>
                          <ChevronIcon />
                        </span>
                      ) : (
                        <span
                          className="tree-folder-chevron tree-folder-chevron--blank"
                          aria-hidden
                        />
                      )}
                      <span
                        className="tree-folder-name"
                        title={isRoot ? tree.rootPath : folder.relPath}
                      >
                        {heading}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={
                        folderCopied
                          ? "tree-row-icon tree-row-icon--copy tree-row-icon--copied"
                          : "tree-row-icon tree-row-icon--copy"
                      }
                      onClick={() => copyPath(folderAbsPath)}
                      title="Copy folder path"
                      aria-label="Copy folder path"
                    >
                      {folderCopied ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    {folder.files.length > 0 && (
                      <span className="tree-folder-count">{folder.files.length}</span>
                    )}
                  </div>
                  {state === "down" && folder.files.length > 0 && (
                    <ul className="tree-file-list">
                      {folder.files.map((file) => {
                        const fullPath = joinPath(tree.rootPath, folder.relPath, file);
                        const reg = docByPath.get(fullPath);
                        const busy = busyPath === fullPath;
                        const copied = copiedPath === fullPath;
                        return (
                          <li className="tree-file-row" key={file}>
                            {(() => {
                              const pinState: "dimmed" | "registered" | "pinned" =
                                !reg ? "dimmed" : reg.pinned ? "pinned" : "registered";
                              const pinClass =
                                "tree-row-icon tree-row-icon--pin " +
                                (pinState === "pinned"
                                  ? "tree-row-icon--pin-pinned"
                                  : pinState === "registered"
                                  ? "tree-row-icon--pin-registered"
                                  : "tree-row-icon--pin-dimmed");
                              const pinTitle =
                                pinState === "dimmed"
                                  ? "Not on home — click to register"
                                  : pinState === "registered"
                                  ? "On home — click to pin to top"
                                  : "Pinned — click to remove from home";
                              return (
                                <button
                                  type="button"
                                  className={pinClass}
                                  onClick={() => cyclePin(fullPath)}
                                  disabled={busy}
                                  title={pinTitle}
                                  aria-label={pinTitle}
                                >
                                  <PinIcon />
                                </button>
                              );
                            })()}
                            <button
                              type="button"
                              className="tree-row-icon tree-row-icon--delete"
                              onClick={() => deleteFile(fullPath)}
                              disabled={busy}
                              title="Delete file from disk"
                              aria-label="Delete file"
                            >
                              <TrashIcon />
                            </button>
                            <button
                              type="button"
                              className="tree-file-link"
                              onClick={() => openFile(fullPath)}
                              disabled={busy}
                              title={fullPath}
                            >
                              {busy && busyPath === fullPath ? `${file} ...` : file}
                            </button>
                            <button
                              type="button"
                              className={
                                copied
                                  ? "tree-row-icon tree-row-icon--copy tree-row-icon--copied"
                                  : "tree-row-icon tree-row-icon--copy"
                              }
                              onClick={() => copyPath(fullPath)}
                              disabled={busy}
                              title="Copy full pathname"
                              aria-label="Copy full pathname"
                            >
                              {copied ? <CheckIcon /> : <CopyIcon />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })
          )}
          {tree.truncated && (
            <p className="tree-truncated">
              Result truncated (folder is very large or deeply nested).
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export default function TreeHome() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const refreshDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/docs");
      if (!res.ok) return;
      const data: DocSummary[] = await res.json();
      setDocs(data);
    } catch {
      /* non-fatal */
    }
  }, []);

  const handleRefreshAll = useCallback(() => {
    refreshDocs();
    setRefreshTick((n) => n + 1);
  }, [refreshDocs]);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs]);

  // BFCache restore: re-pull the registry so a doc that was just registered
  // via openFile shows its updated pin/registration state when the user lands
  // back here from /doc/:slug.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) refreshDocs();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [refreshDocs]);

  return (
    <>
      <header className="app-top-bar">
        <h1 className="app-brand">
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
        </h1>
        <nav className="home-switcher" aria-label="Home view">
          <button
            type="button"
            className="home-switch home-switch--home"
            onClick={() => (window.location.href = "/")}
            title="Document list"
            aria-label="Document list home"
          >
            <HomeIcon />
          </button>
          <button
            type="button"
            className="home-switch home-switch--tree home-switch--active"
            disabled
            title="Directory tree (current view)"
            aria-label="Directory tree (current view)"
          >
            <HierarchyIcon />
          </button>
        </nav>
        <button
          type="button"
          className="home-switch"
          onClick={handleRefreshAll}
          title="Refresh trees and registry"
          aria-label="Refresh"
        >
          <RefreshIcon />
        </button>
        <span className="tree-spacer" />
        <ThemeToggle compact />
      </header>

      <div className="tree-multi">
        <TreePane
          paneId="left"
          storageKey="plan-present-tree-root-left"
          docs={docs}
          refreshDocs={refreshDocs}
          refreshTick={refreshTick}
        />
        <TreePane
          paneId="middle"
          storageKey="plan-present-tree-root-middle"
          docs={docs}
          refreshDocs={refreshDocs}
          refreshTick={refreshTick}
        />
        <TreePane
          paneId="right"
          storageKey="plan-present-tree-root-right"
          docs={docs}
          refreshDocs={refreshDocs}
          refreshTick={refreshTick}
        />
      </div>
    </>
  );
}
