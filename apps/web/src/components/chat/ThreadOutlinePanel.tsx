import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ListTreeIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { requestOutlineNavigation, useOutlineStore } from "./outlineStore";
import { useActiveOutline } from "./useActiveOutline";

function OutlineStatus(props: { readonly title: string; readonly description: string }) {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center"
    >
      <ListTreeIcon aria-hidden className="size-7 text-muted-foreground/60" />
      <p className="text-sm font-medium">{props.title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{props.description}</p>
    </div>
  );
}

export function ThreadOutlinePanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const outline = useActiveOutline(threadRef);
  const threadKey = scopedThreadKey(threadRef);
  const request = useOutlineStore((state) => state.byThreadKey[threadKey]?.request ?? null);
  const pendingHeadingIndex =
    request !== null && request.messageId === outline.messageId ? request.headingIndex : null;
  const topLevel =
    outline.status === "ready" ? Math.min(...outline.headings.map((heading) => heading.level)) : 0;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-thread-outline-panel
      data-outline-status={outline.status}
      data-outline-message-id={outline.messageId ?? undefined}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Reply outline</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sections in the reply you're reading.
          </p>
        </div>
        {outline.status === "ready" ? (
          <span className="shrink-0 rounded-md bg-muted/60 px-2 py-1 font-mono text-xs tabular-nums text-muted-foreground">
            {outline.headings.length}
          </span>
        ) : null}
      </div>
      {outline.status === "ready" ? (
        <div key={outline.messageId} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {outline.headings.map((heading) => {
            const depth = heading.level - topLevel;
            const pending = pendingHeadingIndex === heading.index;
            return (
              <button
                key={heading.index}
                type="button"
                aria-label={`Jump to ${heading.text}`}
                aria-busy={pending || undefined}
                onClick={() =>
                  requestOutlineNavigation(threadKey, outline.messageId, heading.index)
                }
                className={cn(
                  "flex w-full cursor-pointer items-start gap-2 rounded-md py-1.5 pr-2 text-left text-sm leading-5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  pending && "bg-primary/7 hover:bg-primary/10",
                )}
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                <span
                  aria-hidden
                  className="mt-0.5 shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/60"
                >
                  H{heading.level}
                </span>
                <span className="min-w-0 flex-1 break-words">{heading.text}</span>
              </button>
            );
          })}
        </div>
      ) : outline.status === "streaming" || outline.status === "working" ? (
        <OutlineStatus
          title="Generating outline…"
          description="The outline appears when this reply finishes."
        />
      ) : outline.status === "reading" ? (
        <OutlineStatus title="Reading outline…" description="The reply's sections are loading." />
      ) : outline.status === "no-headings" ? (
        <OutlineStatus
          title="This reply has no headings"
          description="Try a reply that uses Markdown headings."
        />
      ) : (
        <OutlineStatus title="Scroll to an AI reply" description="Its sections will appear here." />
      )}
    </div>
  );
}
