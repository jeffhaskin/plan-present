import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { SaveResponse } from "../shared/types";

export interface AutosaveState {
  status: "idle" | "saving" | "saved" | "conflict" | "error";
  message: string;
  isSaving: boolean;
  lastSavedAt: Date | null;
}

const DEBOUNCE_MS = 2000;

export function useAutosave(
  editor: Editor | null,
  slug: string,
  baseMtimeRef: React.MutableRefObject<number>,
): AutosaveState {
  const [state, setState] = useState<AutosaveState>({
    status: "idle",
    message: "",
    isSaving: false,
    lastSavedAt: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    if (!editor) return;

    const content = (editor.storage.markdown as any).getMarkdown();
    setState((s) => ({ ...s, status: "saving", isSaving: true, message: "Saving..." }));

    try {
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
        return;
      }

      const data: SaveResponse = await res.json();
      baseMtimeRef.current = data.mtime;

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
    } catch {
      setState((s) => ({
        ...s,
        status: "error",
        isSaving: false,
        message: "Network error — will retry on next edit",
      }));
    }
  }, [editor, slug, baseMtimeRef]);

  useEffect(() => {
    if (!editor) return;

    const handler = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, DEBOUNCE_MS);
    };

    editor.on("update", handler);

    return () => {
      editor.off("update", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, save]);

  return state;
}
