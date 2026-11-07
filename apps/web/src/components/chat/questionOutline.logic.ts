import { isAttachmentOnlyBootstrapPrompt } from "@t3tools/shared/composerContextReferences";
import type { OrchestrationV2Question } from "@t3tools/contracts";
import type { ChatMessage } from "../../types";
import * as DateTime from "effect/DateTime";
import type { Nodes } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm).freeze();

function previewText(node: Nodes): string {
  if (node.type === "html") return "";
  if (node.type === "break") return "\n";
  if ("value" in node) return node.value;
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (!("children" in node)) return "";
  return node.children
    .map(previewText)
    .join(node.type === "root" || node.type === "list" || node.type === "listItem" ? "\n" : "");
}

export function questionPreview(question: Pick<OrchestrationV2Question, "text" | "attachments">) {
  const text = isAttachmentOnlyBootstrapPrompt(question.text)
    ? ""
    : previewText(parser.parse(question.text)).trim();
  return (
    text || question.attachments.map((attachment) => attachment.name).join(", ") || "User input"
  );
}

export function isQuestionMessage(message: ChatMessage) {
  return (
    message.role === "user" &&
    (message.createdBy === undefined || message.createdBy === "user") &&
    message.scheduledTaskId === undefined &&
    message.senderThreadId === undefined
  );
}

export function questionNavigationTargets(
  questions: ReadonlyArray<OrchestrationV2Question>,
  currentMessageId: string | null,
  currentTimestamp: string | null = null,
) {
  const current = currentQuestionIndex(questions, currentMessageId, currentTimestamp);
  return {
    previous: current > 0 ? questions[current - 1] : undefined,
    next: questions[current + 1],
  };
}

export function currentQuestionIndex(
  questions: ReadonlyArray<OrchestrationV2Question>,
  messageId: string | null,
  timestamp: string | null,
) {
  const current = questions.findIndex((question) => question.messageId === messageId);
  if (current >= 0 || timestamp === null) return current;
  const anchor = new Date(timestamp).getTime();
  return questions.findLastIndex(
    (question) => DateTime.toEpochMillis(question.createdAt) <= anchor,
  );
}
