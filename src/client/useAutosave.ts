import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { SaveResponse } from "../shared/types";

export interface AutosaveStatus {
  status: "idle" | "saving" | "saved" | "conflict" | "error";
  message: string;
  isSaving: boolean;
  lastSavedAt: Date | null;
}

export interface AutosaveState extends AutosaveStatus {
  save: () => Promise<boolean>;
  markClean: (content: string) => void;
}

const DEBOUNCE_MS = 2000;

export function useAutosave(
  editor: Editor | null,
  slug: string,
  baseMtimeRef: React.MutableRefObject<number>,
): AutosaveState {
  const [state, setState] = useState<AutosaveStatus>({
    status: "idle",
    message: "",
    isSaving: false,
    lastSavedAt: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Last content known to match what's on disk. Phantom "update" events
  // (e.g. DOM mutations from widget injection) produce no markdown change,
  // so we compare against this baseline before flagging the doc as dirty.
  const cleanContentRef = useRef<string | null>(null);

  const markClean = useCallback((content: string) => {
    cleanContentRef.current = content;
    dirtyRef.current = false;
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!editor) {
      setState((s) => ({ ...s, status: "error", isSaving: false, message: "Editor not ready" }));
      return false;
    }

    setState((s) => ({ ...s, status: "saving", isSaving: true, message: "Saving..." }));

    try {
      const content = (editor as any).getMarkdown();

      const res = await fetch(`/api/doc/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseMtime: baseMtimeRef.current }),
      });

      if (!res.ok) {
        setState((s) => ({
          ...s,
          status: "error",
          isSaving: false,
          message: `Save failed (${res.status})`,
        }));
        return false;
      }

      const data: SaveResponse = await res.json();
      baseMtimeRef.current = data.mtime;

      dirtyRef.current = false;
      cleanContentRef.current = content;

      if (data.conflict) {
        setState({
          status: "conflict",
          isSaving: false,
          message: `Conflict — original saved to ${data.conflictPath}`,
          lastSavedAt: new Date(),
        });
      } else {
        setState({
          status: "saved",
          isSaving: false,
          message: "Saved",
          lastSavedAt: new Date(),
        });
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setState((s) => ({
        ...s,
        status: "error",
        isSaving: false,
        message: `Save error: ${msg}`,
      }));
      return false;
    }
  }, [editor, slug, baseMtimeRef]);

  useEffect(() => {
    if (!editor) return;

    const handler = () => {
      // Guard against phantom updates: only flag dirty if the markdown
      // has actually diverged from the last known-clean content.
      const current = (editor as any).getMarkdown();
      if (cleanContentRef.current !== null && current === cleanContentRef.current) {
        return;
      }
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, DEBOUNCE_MS);
    };

    editor.on("update", handler);

    return () => {
      editor.off("update", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, save]);

  // beforeunload: fire sendBeacon to save unsaved changes on page close
  useEffect(() => {
    if (!editor) return;

    const handleUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;

      const content = (editor as any).getMarkdown();
      const payload = JSON.stringify({ content, baseMtime: baseMtimeRef.current });
      navigator.sendBeacon(`/api/doc/${slug}`, new Blob([payload], { type: "application/json" }));

      e.preventDefault();
      e.returnValue = "You have unsaved changes.";
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [editor, slug, baseMtimeRef]);

  return { ...state, save, markClean };
}
