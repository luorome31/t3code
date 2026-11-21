import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { MessageId, ThreadId } from "./baseSchemas.ts";
import { SmalltalkMutation, SmalltalkSummary } from "./smalltalk.ts";

const decodeMutation = Schema.decodeUnknownSync(SmalltalkMutation);
const encodeMutation = Schema.encodeSync(SmalltalkMutation);
const decodeSummary = Schema.decodeUnknownSync(SmalltalkSummary);

const threadId = ThreadId.make("thread");
const messageId = MessageId.make("answer");

describe("Smalltalk contracts", () => {
  it("round-trips the legacy flat create shape shipped by older clients", () => {
    const legacy = { action: "create", threadId, sourceThreadId: threadId, messageId } as const;
    const decoded = decodeMutation(legacy);
    expect(decoded).toEqual(legacy);
    expect(encodeMutation(decoded)).toEqual(legacy);
  });

  it("decodes message and Markdown sources", () => {
    expect(
      decodeMutation({
        action: "create",
        threadId,
        source: { kind: "message", sourceThreadId: threadId, messageId },
      }),
    ).toMatchObject({ source: { kind: "message", messageId } });
    expect(
      decodeMutation({
        action: "create",
        threadId,
        source: { kind: "markdown-file", relativePath: "docs/guide.md", text: "# Guide" },
      }),
    ).toMatchObject({ source: { kind: "markdown-file", relativePath: "docs/guide.md" } });
  });

  it("rejects a create without any source", () => {
    expect(() => decodeMutation({ action: "create", threadId })).toThrow();
  });

  it("decodes an excerpt and rejects a range that ends before it starts", () => {
    expect(
      decodeMutation({
        action: "create",
        threadId,
        source: {
          kind: "excerpt",
          messageId,
          text: "hi",
          start: 0,
          end: 5,
          prefix: "",
          suffix: "",
        },
      }),
    ).toMatchObject({ source: { kind: "excerpt", messageId, start: 0, end: 5 } });
    expect(() =>
      decodeMutation({
        action: "create",
        threadId,
        source: {
          kind: "excerpt",
          messageId,
          text: "hi",
          start: 500,
          end: 5,
          prefix: "",
          suffix: "",
        },
      }),
    ).toThrow();
  });

  it("decodes summaries written before file sources as message sources", () => {
    const legacy = {
      id: "smalltalk",
      threadId,
      sourceThreadId: threadId,
      messageId,
      title: "Answer",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      streamingText: "",
    } as const;
    expect(decodeSummary(legacy).filePath).toBeNull();
    expect(decodeSummary({ ...legacy, filePath: "docs/guide.md" }).filePath).toBe("docs/guide.md");
  });
});
