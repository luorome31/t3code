import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import {
  resolveAssistantCitationRange,
  type AssistantTextSelector,
} from "~/lib/assistantTextSelection";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { MarkdownFileHighlightPainter } from "./MarkdownFileHighlightPainter";
import { MarkdownFileHighlightToolbar } from "./MarkdownFileHighlightToolbar";

export interface MarkdownFileHighlightReveal {
  readonly id: number;
  readonly selector: AssistantTextSelector;
}

const NOOP = () => undefined;

export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceMutationId: string | null;
  readonly revealHighlight?: MarkdownFileHighlightReveal | null;
  readonly onHighlightRevealHandled?: ((id: number) => void) | undefined;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const viewport = container
    ? (container.closest<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? container)
    : null;
  const reveal = props.revealHighlight ?? null;
  const onRevealHandled = useStableCallback(props.onHighlightRevealHandled ?? NOOP);
  const lastSeparator = Math.max(
    props.relativePath.lastIndexOf("/"),
    props.relativePath.lastIndexOf("\\"),
  );
  const imageBaseDir =
    lastSeparator >= 0
      ? resolvePathLinkTarget(props.relativePath.slice(0, lastSeparator), props.cwd)
      : props.cwd;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the rendered Markdown DOM to a highlight requested from the Highlights panel
  useEffect(() => {
    if (container === null || reveal === null) return;
    const range = resolveAssistantCitationRange(container, reveal.selector);
    if (range === null) {
      toastManager.add({
        type: "warning",
        title: "Highlight not found",
        description: "The Markdown file changed, so this highlight can no longer be located.",
      });
    } else {
      const start = range.startContainer;
      const element =
        start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      element?.scrollIntoView({ block: "center" });
    }
    onRevealHandled(reveal.id);
  }, [container, onRevealHandled, reveal]);

  return (
    <div ref={setContainer}>
      <ChatMarkdown
        text={maskMarkdownFrontmatter(props.text)}
        cwd={props.cwd}
        imageBaseDir={imageBaseDir}
        threadRef={props.threadRef}
        workspaceMutationId={props.workspaceMutationId}
        className="mx-auto max-w-4xl px-6 py-5"
        onTaskListChange={props.onTaskListChange}
      />
      <MarkdownFileHighlightPainter
        container={container}
        threadRef={props.threadRef}
        workspaceRoot={props.cwd}
        relativePath={props.relativePath}
      />
      <MarkdownFileHighlightToolbar
        viewport={viewport}
        threadRef={props.threadRef}
        workspaceRoot={props.cwd}
        relativePath={props.relativePath}
      />
    </div>
  );
}
