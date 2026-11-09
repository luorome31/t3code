import { MessageId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  attachOutlineTimeline,
  reportOutlineActiveMessage,
  requestOutlineNavigation,
  settleOutlineNavigation,
  useOutlineStore,
} from "./outlineStore";

const first = MessageId.make("message-first");
const second = MessageId.make("message-second");

function outlineFor(threadKey: string) {
  return useOutlineStore.getState().byThreadKey[threadKey];
}

beforeEach(() => {
  useOutlineStore.setState({ byThreadKey: {} });
});

describe("outline store", () => {
  it("reports the active reply and keeps a pending jump target", () => {
    const navigate = vi.fn();
    const detach = attachOutlineTimeline("thread-1", navigate);

    reportOutlineActiveMessage("thread-1", first);
    expect(outlineFor("thread-1")?.activeMessageId).toBe(first);

    requestOutlineNavigation("thread-1", first, 2);
    expect(navigate).toHaveBeenCalledOnce();
    expect(outlineFor("thread-1")?.request).toMatchObject({
      messageId: first,
      headingIndex: 2,
    });

    reportOutlineActiveMessage("thread-1", second);
    expect(outlineFor("thread-1")?.activeMessageId).toBe(first);

    settleOutlineNavigation("thread-1", outlineFor("thread-1")!.request!.id, null);
    expect(outlineFor("thread-1")?.request).toBeNull();
    detach();
    expect(outlineFor("thread-1")).toBeUndefined();
  });

  it("increments jump ids and ignores a stale settlement", () => {
    const navigate = vi.fn();
    const detach = attachOutlineTimeline("thread-2", navigate);

    requestOutlineNavigation("thread-2", first, 0);
    const firstRequest = outlineFor("thread-2")!.request!;
    requestOutlineNavigation("thread-2", second, 3);
    const secondRequest = outlineFor("thread-2")!.request!;
    expect(secondRequest.id).toBe(firstRequest.id + 1);

    settleOutlineNavigation("thread-2", firstRequest.id, null);
    expect(outlineFor("thread-2")?.request).toEqual(secondRequest);
    settleOutlineNavigation("thread-2", secondRequest.id, null);
    expect(outlineFor("thread-2")?.request).toBeNull();
    detach();
  });

  it("does nothing when no timeline is attached", () => {
    requestOutlineNavigation("thread-3", first, 0);
    expect(outlineFor("thread-3")).toBeUndefined();
  });
});
