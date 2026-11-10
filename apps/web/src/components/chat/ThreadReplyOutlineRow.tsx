import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ListTreeIcon } from "lucide-react";
import { useRightPanelStore } from "../../rightPanelStore";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { OutlineTabPreview } from "./OutlineTabPreview";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadHighlightsRow } from "./ThreadHighlightsRow";
import { type ActiveOutline, useActiveOutline } from "./useActiveOutline";
import { requestOutlineNavigation } from "./outlineStore";

function ReplyOutlineHeadingsMenu({
  threadRef,
  outline,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly outline: ActiveOutline;
}) {
  const threadKey = scopedThreadKey(threadRef);
  const openPanel = () => useRightPanelStore.getState().open(threadRef, "outline");
  const topLevel =
    outline.status === "ready" ? Math.min(...outline.headings.map((heading) => heading.level)) : 0;
  const topHeadings =
    outline.status === "ready"
      ? outline.headings.filter((heading) => heading.level === topLevel)
      : [];
  const statusLabel =
    outline.status === "streaming" || outline.status === "working"
      ? "Generating outline…"
      : outline.status === "no-headings"
        ? "This reply has no headings"
        : outline.status === "reading"
          ? "Reading outline…"
          : outline.status === "unavailable"
            ? "Outline unavailable"
            : "No AI reply in view";

  return (
    <Menu>
      <MenuTrigger
        render={
          <ThreadDetailsControl
            type="button"
            size="icon"
            variant="ghost"
            part="icon"
            aria-label="Reply outline headings"
          />
        }
      >
        <ChevronDownIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" sideOffset={4} className="max-w-72">
        {outline.status === "ready" ? (
          topHeadings.map((heading) => (
            <MenuItem
              key={heading.index}
              onClick={() => requestOutlineNavigation(threadKey, outline.messageId, heading.index)}
            >
              <span className="min-w-0 truncate">{heading.text}</span>
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>{statusLabel}</MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onClick={openPanel}>Open Reply outline</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function ThreadReplyOutlineRow({
  threadRef,
  separated,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly separated: boolean;
}) {
  const outline = useActiveOutline(threadRef);
  // A row with nothing to outline only costs density in short cards, which hides git controls.
  if (outline.status === "no-replies") return null;
  const count =
    outline.status === "ready"
      ? outline.headings.length
      : outline.status === "streaming" || outline.status === "working"
        ? "…"
        : 0;
  return (
    <ThreadHighlightsRow
      title="Reply outline"
      icon={ListTreeIcon}
      count={count}
      separated={separated}
      onOpen={() => useRightPanelStore.getState().open(threadRef, "outline")}
      tooltip={<OutlineTabPreview threadRef={threadRef} />}
      trailing={<ReplyOutlineHeadingsMenu threadRef={threadRef} outline={outline} />}
    />
  );
}
