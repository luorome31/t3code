import { useGT } from "gt-react";
import { EllipsisIcon, QuoteIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";

export function HighlightContextActions({
  count,
  onCite,
  onNotes,
  onRemove,
}: {
  count: number;
  onCite?: (() => boolean) | undefined;
  onNotes: (trigger: HTMLElement) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const [more, setMore] = useState(false);
  return (
    <>
      {onCite ? (
        <Button
          size="xs"
          variant="glass"
          aria-label={gt("Cite highlight in composer")}
          onClick={onCite}
        >
          <QuoteIcon aria-hidden />
          {gt("Cite", { $context: "verb, button that quotes the selected text" })}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="glass"
        aria-haspopup="dialog"
        onClick={(event) => onNotes(event.currentTarget)}
      >
        <StickyNoteIcon aria-hidden />
        {count ? gt("Notes ({count, number})", { count }) : gt("Add note")}
      </Button>
      <Button
        size="xs"
        variant="glass"
        aria-label={gt("More highlight actions")}
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        <EllipsisIcon aria-hidden />
      </Button>
      {more ? (
        <Button size="xs" variant="glass" onClick={onRemove}>
          <Trash2Icon aria-hidden />
          {gt("Remove highlight")}
        </Button>
      ) : null}
    </>
  );
}
