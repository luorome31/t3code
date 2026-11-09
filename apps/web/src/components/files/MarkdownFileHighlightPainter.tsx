import type { ScopedThreadRef } from "@t3tools/contracts";

import { useThreadHighlights } from "~/highlightStore";
import { useMarkdownFileHighlights } from "./useMarkdownFileHighlights";

export function MarkdownFileHighlightPainter({
  container,
  threadRef,
  workspaceRoot,
  relativePath,
}: {
  readonly container: HTMLElement | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string;
  readonly relativePath: string;
}) {
  const highlights = useThreadHighlights(threadRef);
  useMarkdownFileHighlights({ container, threadRef, workspaceRoot, relativePath, highlights });
  return null;
}
