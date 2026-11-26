import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { EllipsisIcon, PlusIcon, QuoteIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  MAX_HIGHLIGHT_NOTE_LENGTH,
  useHighlightStore,
  type HighlightNote,
  type ThreadHighlight,
} from "~/highlightStore";
import { flushSync } from "react-dom";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";

export function HighlightNotes({
  threadRef,
  highlight,
  onInsert,
  onExplain,
  explainBusy,
  onDirtyChange,
}: {
  threadRef: ScopedThreadRef;
  highlight: ThreadHighlight;
  onInsert?: ((note: HighlightNote) => void) | undefined;
  onExplain?: ((note: HighlightNote) => void) | undefined;
  explainBusy?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const gt = useGT();
  const notes = highlight.notes ?? [];
  const [editor, setEditor] = useState<{ original?: HighlightNote; draft: string } | null>(() =>
    notes.length === 0 ? { draft: "" } : null,
  );
  const addButton = useRef<HTMLButtonElement>(null);
  const insertButtons = useRef(new Map<string, HTMLButtonElement>());
  const noteTooLong = (editor?.draft.length ?? 0) > MAX_HIGHLIGHT_NOTE_LENGTH;
  const closeEditor = (savedNoteId?: string) => {
    flushSync(() => {
      setEditor(null);
      onDirtyChange?.(false);
    });
    const insertButton = savedNoteId ? insertButtons.current.get(savedNoteId) : undefined;
    if (insertButton) insertButton.focus();
    else addButton.current?.focus({ preventScroll: true });
  };
  const save = () => {
    if (!editor || noteTooLong || !editor.draft.trim()) return;
    const savedNoteId = useHighlightStore
      .getState()
      .saveHighlightNote(threadRef, highlight.id, editor.draft, editor.original?.id);
    if (!savedNoteId) {
      toastManager.add({ type: "warning", title: gt("Could not save this note") });
      return;
    }
    closeEditor(savedNoteId);
  };

  const renderEditor = () =>
    editor && (
      <div className="flex flex-col gap-1.5">
        <textarea
          autoFocus
          aria-label={editor.original ? gt("Edit note") : gt("Add note")}
          placeholder={gt("Add a note for this highlight...")}
          rows={2}
          className="field-sizing-content max-h-40 min-h-14 w-full resize-none rounded-md border border-border bg-background/60 px-2.5 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring sm:text-sm"
          value={editor.draft}
          onChange={(event) => {
            const draft = event.currentTarget.value;
            setEditor({ ...editor, draft });
            onDirtyChange?.(draft !== (editor.original?.text ?? ""));
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              event.stopPropagation();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeEditor();
            }
          }}
        />
        {noteTooLong ? (
          <p role="status" className="text-xs text-destructive">
            {gt("Notes can contain up to {count, number} characters.", {
              count: MAX_HIGHLIGHT_NOTE_LENGTH,
            })}
          </p>
        ) : null}
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => closeEditor()}>
            {gt("Cancel")}
          </Button>
          <Button size="sm" onClick={save} disabled={noteTooLong || !editor.draft.trim()}>
            {gt("Save note")}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {notes.length > 0 ? (
        <ul className="divide-y divide-border/60">
          {notes.map((note) => (
            <li key={note.id} className="py-2 first:pt-0 last:pb-0">
              {editor?.original?.id === note.id ? (
                renderEditor()
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="whitespace-pre-wrap wrap-anywhere text-sm text-foreground">
                    {note.text}
                  </p>
                  <div className="flex items-center justify-between gap-1">
                    {onInsert ? (
                      <Button
                        ref={(button) => {
                          if (button) insertButtons.current.set(note.id, button);
                          else insertButtons.current.delete(note.id);
                        }}
                        size="sm"
                        variant="ghost"
                        disabled={editor !== null}
                        onClick={() => onInsert(note)}
                      >
                        <QuoteIcon aria-hidden />
                        {gt("Add to chat draft")}
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Menu modal={false}>
                      <MenuTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={gt("Note actions")}
                            disabled={editor !== null}
                          />
                        }
                      >
                        <EllipsisIcon aria-hidden />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => setEditor({ original: note, draft: note.text })}>
                          {gt("Edit note")}
                        </MenuItem>
                        {onExplain ? (
                          <MenuItem disabled={explainBusy} onClick={() => onExplain(note)}>
                            {gt("Explain note in plain language")}
                          </MenuItem>
                        ) : null}
                        <MenuItem
                          variant="destructive"
                          onClick={() => {
                            if (
                              !useHighlightStore
                                .getState()
                                .removeHighlightNote(threadRef, highlight.id, note.id)
                            ) {
                              toastManager.add({
                                type: "warning",
                                title: gt("Could not delete this note"),
                              });
                              return;
                            }
                            addButton.current?.focus({ preventScroll: true });
                          }}
                        >
                          {gt("Delete note")}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {editor && !editor.original ? renderEditor() : null}
      <div hidden={editor !== null}>
        <Button ref={addButton} size="sm" variant="ghost" onClick={() => setEditor({ draft: "" })}>
          <PlusIcon aria-hidden />
          {gt("Add note")}
        </Button>
      </div>
    </div>
  );
}
