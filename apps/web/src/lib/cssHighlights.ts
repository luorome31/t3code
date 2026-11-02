export function setHighlightPriority(highlight: Highlight, priority: number): void {
  (highlight as Highlight & { priority?: number }).priority = priority;
}
