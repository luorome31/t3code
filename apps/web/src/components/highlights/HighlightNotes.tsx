import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { EllipsisIcon, PlusIcon, QuoteIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import {
  MAX_HIGHLIGHT_NOTE_LENGTH,
  useHighlightStore,
  readThreadHighlights,
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
  inlineEditor,
  onRequestDeleteNote,
  renderNoteText,
}: {
  threadRef: ScopedThreadRef;
  highlight: ThreadHighlight;
  onInsert?: ((note: HighlightNote) => void) | undefined;
  onExplain?: ((note: HighlightNote) => void) | undefined;
  explainBusy?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  inlineEditor?: {
    active: boolean;
    position: number;
    start: () => boolean;
    finish: (saved: boolean) => void;
  };
  onRequestDeleteNote?: (note: HighlightNote) => boolean;
  renderNoteText?: (text: string) => ReactNode;
}) {
  const gt = useGT();
  const notes = highlight.notes ?? [];
  const [editorState, setEditor] = useState<{ original?: HighlightNote; draft: string } | null>(
    () => (!inlineEditor && notes.length === 0 ? { draft: "" } : null),
  );
  const editor = inlineEditor && !inlineEditor.active ? null : editorState;
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const noteTooLong = (editor?.draft.length ?? 0) > MAX_HIGHLIGHT_NOTE_LENGTH;
  const openEditor = (original?: HighlightNote) => {
    if (inlineEditor && !inlineEditor.start()) return;
    setEditor(original ? { original, draft: original.text } : { draft: "" });
  };
  const closeEditor = (savedId?: string) => {
    setEditor(null);
    onDirtyChange?.(false);
    inlineEditor?.finish(savedId !== undefined);
  };
  const cancel = () => {
    const originalId = editor?.original?.id;
    flushSync(() => closeEditor());
    const trigger =
      originalId &&
      root.current?.querySelector<HTMLElement>(`[data-note-actions="${CSS.escape(originalId)}"]`);
    (trigger || addButton.current)?.focus({ preventScroll: true });
  };
  const save = () => {
    if (!editor || noteTooLong || !editor.draft.trim()) return;
    let savedId: string | undefined;
    flushSync(() => {
      if (
        !useHighlightStore
          .getState()
          .saveHighlightNote(threadRef, highlight.id, editor.draft, editor.original?.id)
      )
        return;
      savedId =
        editor.original?.id ??
        readThreadHighlights(threadRef)
          .find((item) => item.id === highlight.id)
          ?.notes?.at(-1)?.id;
      closeEditor(savedId);
    });
    if (!savedId) {
      toastManager.add({ type: "warning", title: gt("Could not save this note") });
      return;
    }
    const insert = root.current?.querySelector<HTMLElement>(
      `[data-note-insert="${CSS.escape(savedId)}"]`,
    );
    (insert ?? addButton.current)?.focus({ preventScroll: true });
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
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
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
              cancel();
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
          <Button size="sm" variant="ghost" onClick={cancel}>
            {gt("Cancel")}
          </Button>
          <Button size="sm" onClick={save} disabled={noteTooLong || !editor.draft.trim()}>
            {gt("Save note")}
          </Button>
        </div>
      </div>
    );

  return (
    <div ref={root} className="flex flex-col gap-2">
      {notes.length > 0 ? (
        <ul className={inlineEditor ? "flex flex-col gap-2" : "divide-y divide-border/60"}>
          {notes.map((note) => (
            <li
              key={note.id}
              className={
                inlineEditor
                  ? "rounded-md border border-border/60 bg-muted/40 p-2.5"
                  : "py-2 first:pt-0 last:pb-0"
              }
            >
              {editor?.original?.id === note.id ? (
                renderEditor()
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="whitespace-pre-wrap wrap-anywhere text-sm text-foreground">
                    {renderNoteText?.(note.text) ?? note.text}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    {onInsert ? (
                      <Button
                        size="sm"
                        variant={inlineEditor ? "outline" : "ghost"}
                        data-note-insert={note.id}
                        className="group/draft-insert"
                        disabled={editor !== null}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229)
                          )
                            event.preventDefault();
                        }}
                        onClick={() => onInsert(note)}
                      >
                        <QuoteIcon aria-hidden />
                        {gt("Add to chat draft")}
                        {inlineEditor && (
                          <kbd
                            aria-hidden
                            className="text-muted-foreground opacity-0 group-focus-visible/draft-insert:opacity-100"
                          >
                            ↵
                          </kbd>
                        )}
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
                            data-note-actions={note.id}
                            disabled={editor !== null}
                          />
                        }
                      >
                        <EllipsisIcon aria-hidden />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => openEditor(note)}>{gt("Edit note")}</MenuItem>
                        {onExplain ? (
                          <MenuItem disabled={explainBusy} onClick={() => onExplain(note)}>
                            {gt("Explain note in plain language")}
                          </MenuItem>
                        ) : null}
                        <MenuItem
                          variant="destructive"
                          onClick={() => {
                            if (
                              !(onRequestDeleteNote
                                ? onRequestDeleteNote(note)
                                : useHighlightStore
                                    .getState()
                                    .removeHighlightNote(threadRef, highlight.id, note.id))
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
        <Button
          ref={addButton}
          size="sm"
          variant="ghost"
          data-highlight-add-note=""
          aria-label={
            inlineEditor
              ? gt("Add note for highlight {position}", { position: inlineEditor.position })
              : undefined
          }
          onClick={() => openEditor()}
        >
          <PlusIcon aria-hidden />
          {inlineEditor && notes.length > 0 ? gt("Add another note") : gt("Add note")}
        </Button>
      </div>
    </div>
  );
}
