import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { MessageId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { readThreadHighlights, useHighlightStore } from "~/highlightStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act, render } from "../../../test/render";
import { startMainAppLocationTracking } from "../sidebar/mainAppLocation";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

it("guards a dirty note, handles IME and double Enter, and restores deletions without sending", async () => {
  await page.viewport(1250, 850);
  const current = threadWithHistory("workbench-current", 1);
  const older = threadWithHistory("workbench-older", 1);
  using _environment = installFakeEnvironment([current, older]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const currentRef = scopeThreadRef(ENVIRONMENT_ID, current.id);
  const olderRef = scopeThreadRef(ENVIRONMENT_ID, older.id);
  const store = useHighlightStore.getState();
  using _cleanup = {
    [Symbol.dispose]: () => {
      store.clearThread(currentRef);
      store.clearThread(olderRef);
    },
  };
  for (const ref of [currentRef, olderRef]) {
    const text = `Answer 0 for ${ref.threadId}.`;
    expect(
      store.addHighlight(ref, {
        source: {
          kind: "assistant-message",
          messageId: MessageId.make(`${ref.threadId}-assistant-0`),
        },
        selector: { text, start: 0, end: text.length, prefix: "", suffix: "\n\n- checked" },
      }).ok,
    ).toBe(true);
  }
  const path = `/${ENVIRONMENT_ID}/${current.id}`;
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  await using screen = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  using _tracking = { [Symbol.dispose]: startMainAppLocationTracking(router) };
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(router) };
  const composer = screen.getByTestId("composer-editor");
  await expect.element(composer).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Highlights", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Highlights and notes" });
  const currentScope = dialog.getByRole("button", { name: "Current thread" });
  const projectScope = dialog.getByRole("button", { name: "Current project" });
  await expect.element(projectScope).toHaveAttribute("aria-pressed", "true");
  const historic = dialog.getByRole("article").filter({ hasText: `Answer 0 for ${older.id}.` });
  await userEvent.click(currentScope);
  await expect.element(historic).not.toBeInTheDocument();
  await userEvent.click(projectScope);
  await expect.element(historic).toBeVisible();

  await userEvent.click(historic.getByRole("button", { name: /Add note for highlight/ }));
  const editor = dialog.getByRole("textbox", { name: "Add note" });
  await userEvent.type(editor, "review this passage");
  await userEvent.click(currentScope);
  await expect.element(editor).toHaveValue("review this passage");
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).toBeVisible();
  await expect.element(editor).toHaveValue("review this passage");
  await userEvent.click(editor);
  await act(() =>
    editor.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(readThreadHighlights(olderRef)[0]?.notes).toBeUndefined();
  const commandCount = dispatchedCommands().length;
  await userEvent.keyboard("{Enter}");
  const addToDraft = historic.getByRole("button", { name: "Add to chat draft" });
  await expect.element(addToDraft).toHaveFocus();
  const drafts = useComposerDraftStore.getState();
  await act(async () => {
    for (const init of [{ repeat: true }, { isComposing: true }]) {
      const enter = new KeyboardEvent("keydown", {
        ...init,
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      addToDraft.element().dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
    }
  });
  expect(drafts.getComposerDraft(currentRef)?.prompt ?? "").toBe("");
  await userEvent.keyboard("{Enter}");
  await expect.element(dialog.getByText("1 item added to draft")).toBeVisible();
  expect(
    collectAssistantCitations(drafts.getComposerDraft(currentRef)?.prompt ?? "").map(
      ({ citation }) => citation,
    ),
  ).toEqual([expect.objectContaining({ threadId: older.id, comment: "review this passage" })]);
  expect(drafts.getComposerDraft(olderRef)?.prompt ?? "").toBe("");

  await userEvent.click(dialog.getByRole("checkbox", { name: "Select all highlights" }));
  await userEvent.click(dialog.getByRole("button", { name: "Merge into draft" }));
  await expect.element(dialog.getByText("3 items added to draft")).toBeVisible();
  const before = readThreadHighlights(olderRef);
  await userEvent.click(historic.getByRole("button", { name: /Delete highlight/ }));
  await expect.element(historic).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Undo", exact: true }));
  await expect.element(historic).toBeVisible();
  expect(readThreadHighlights(olderRef)).toEqual(before);
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(composer).toHaveFocus();
  expect(router.state.location.pathname).toBe(path);
  expect(dispatchedCommands()).toHaveLength(commandCount);
});
