import type { ScopedThreadRef } from "@t3tools/contracts";

import { useThreadHighlights } from "~/highlightStore";
import { useAssistantHighlights } from "./useAssistantHighlights";

export function AssistantHighlightPainter({
  container,
  threadRef,
}: {
  readonly container: HTMLElement | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const highlights = useThreadHighlights(threadRef);
  useAssistantHighlights({ container, threadRef, highlights });
  return null;
}
