import { describe, expect, it } from "vite-plus/test";
import { MessageId, TurnItemId, type OrchestrationV2Question } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import {
  isQuestionMessage,
  questionNavigationTargets,
  questionPreview,
} from "./questionOutline.logic";
import {
  attachQuestionTimeline,
  reportQuestionPosition,
  requestQuestionNavigation,
  settleQuestionNavigation,
  useQuestionOutlineStore,
} from "./questionOutlineStore";

const question = (id: string): OrchestrationV2Question => ({
  messageId: MessageId.make(id),
  entryId: TurnItemId.make(`entry-${id}`),
  position: 0,
  text: id,
  createdAt: DateTime.makeUnsafe("2026-11-06T00:00:00Z"),
  attachments: [],
});

describe("question outline", () => {
  it("uses original Markdown text and attachment names for recognizable previews", () => {
    expect(
      questionPreview({
        text: "# Please **fix** [the sidebar](https://example.com)\n\nKeep `Enter` working.",
        attachments: [],
      }),
    ).toBe("Please fix the sidebar\nKeep Enter working.");
    expect(
      questionPreview({
        text: ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
        attachments: [{ type: "image", name: "sidebar.png" }],
      }),
    ).toBe("sidebar.png");
    expect(questionPreview({ text: "<script>hidden</script>\n\nVisible", attachments: [] })).toBe(
      "Visible",
    );
  });

  it("navigates relative to the current question and respects both ends", () => {
    const items = [question("one"), question("two"), question("three")];
    expect(questionNavigationTargets(items, null)).toEqual({ previous: undefined, next: items[0] });
    expect(questionNavigationTargets(items, "one")).toEqual({
      previous: undefined,
      next: items[1],
    });
    expect(questionNavigationTargets(items, "two")).toEqual({ previous: items[0], next: items[2] });
    expect(questionNavigationTargets(items, "three")).toEqual({
      previous: items[1],
      next: undefined,
    });
    expect(questionNavigationTargets([], null)).toEqual({ previous: undefined, next: undefined });
    const outsideWindow = items.map((item, index) => ({
      ...item,
      createdAt: DateTime.makeUnsafe(`2026-11-06T00:0${index}:00Z`),
    }));
    expect(questionNavigationTargets(outsideWindow, null, "2026-11-06T00:01:30Z")).toEqual({
      previous: outsideWindow[0],
      next: outsideWindow[2],
    });
    expect(questionNavigationTargets(outsideWindow, null, "2026-11-06T01:00:00Z")).toEqual({
      previous: outsideWindow[1],
      next: undefined,
    });
  });

  it("keeps human follow-ups while excluding automated user-role inputs", () => {
    const message = {
      id: MessageId.make("message"),
      role: "user" as const,
      text: "follow up",
      runId: null,
      streaming: false,
      createdAt: "2026-11-06T00:00:00Z",
      updatedAt: "2026-11-06T00:00:00Z",
    };
    expect(isQuestionMessage(message)).toBe(true);
    expect(isQuestionMessage({ ...message, createdBy: "user", text: "/compact" })).toBe(true);
    expect(isQuestionMessage({ ...message, createdBy: "agent" })).toBe(false);
    expect(isQuestionMessage({ ...message, createdBy: "system" })).toBe(false);
    expect(isQuestionMessage({ ...message, role: "assistant" })).toBe(false);
  });

  it("isolates thread requests and ignores the completion of a superseded jump", () => {
    useQuestionOutlineStore.setState({ byThreadKey: {} });
    let releases = 0;
    const detachA = attachQuestionTimeline("environment:a", () => {
      releases += 1;
    });
    const detachB = attachQuestionTimeline("environment:b", () => {});
    reportQuestionPosition("environment:a", "one");
    requestQuestionNavigation("environment:a", question("two"));
    const first = useQuestionOutlineStore.getState().byThreadKey["environment:a"]!.request!;
    requestQuestionNavigation("environment:a", question("three"));
    settleQuestionNavigation("environment:a", first.id, "stale error");
    expect(releases).toBe(2);
    expect(
      useQuestionOutlineStore.getState().byThreadKey["environment:a"]?.request?.question.messageId,
    ).toBe("three");
    expect(useQuestionOutlineStore.getState().byThreadKey["environment:b"]).toBeUndefined();
    detachA();
    requestQuestionNavigation("environment:a", question("one"));
    expect(useQuestionOutlineStore.getState().byThreadKey["environment:a"]).toBeUndefined();
    detachB();
  });
});
