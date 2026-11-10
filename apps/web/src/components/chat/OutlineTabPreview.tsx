import type { ScopedThreadRef } from "@t3tools/contracts";
import { useActiveOutline } from "./useActiveOutline";

const PREVIEW_HEADING_LIMIT = 8;

export function OutlineTabPreview({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const outline = useActiveOutline(threadRef);
  if (outline.status === "streaming" || outline.status === "working") {
    return (
      <span className="text-muted-foreground">
        Generating. The outline appears when this reply finishes.
      </span>
    );
  }
  if (outline.status === "reading") {
    return <span className="text-muted-foreground">Reading outline…</span>;
  }
  if (outline.status === "no-headings") {
    return <span className="text-muted-foreground">This reply has no headings.</span>;
  }
  if (outline.status !== "ready") {
    return <span className="text-muted-foreground">Scroll to an AI reply to see its outline.</span>;
  }
  const topLevel = Math.min(...outline.headings.map((heading) => heading.level));
  const topHeadings = outline.headings.filter((heading) => heading.level === topLevel);
  const visibleHeadings = topHeadings.slice(0, PREVIEW_HEADING_LIMIT);
  return (
    <div className="flex max-w-64 flex-col gap-1">
      <span className="font-medium text-foreground">Reply outline</span>
      <ul className="flex flex-col gap-0.5">
        {visibleHeadings.map((heading) => (
          <li key={heading.index} className="truncate text-muted-foreground">
            {heading.text}
          </li>
        ))}
      </ul>
      {topHeadings.length > visibleHeadings.length ? (
        <span className="text-muted-foreground">
          +{topHeadings.length - visibleHeadings.length} more
        </span>
      ) : null}
    </div>
  );
}
