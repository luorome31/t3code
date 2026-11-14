import { EnvironmentId, ThreadId, type ProjectReadFileResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { userEvent } from "vite-plus/test/browser";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

const state = vi.hoisted(() => ({
  file: null as ProjectReadFileResult | null,
  optimistic: null as ProjectReadFileResult | null,
  writeFile: vi.fn(),
  smalltalk: false,
  smalltalkFileSource: true,
}));

vi.mock(import("@t3tools/client-runtime/state/runtime"), async (original) => ({
  ...(await original()),
  runAtomCommand: ((_registry: unknown, _command: unknown, request: unknown) =>
    state.writeFile(request)) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.writeFile) as never,
}));
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  const smalltalkConfig = Atom.make({
    environment: { capabilities: { smalltalk: true, smalltalkFileSource: true } },
  });
  const smalltalkConfigWithoutFileSource = Atom.make({
    environment: { capabilities: { smalltalk: true } },
  });
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      configValueAtom: (() =>
        state.smalltalk
          ? state.smalltalkFileSource
            ? smalltalkConfig
            : smalltalkConfigWithoutFileSource
          : noConfig) as never,
    },
  };
});
vi.mock(import("~/state/smalltalk"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  return {
    ...actual,
    smalltalkEnvironment: {
      ...actual.smalltalkEnvironment,
      mutate: { ...actual.smalltalkEnvironment.mutate, permissionAtom: () => Atom.make(true) },
    },
    selectedSmalltalkAtom: (() => Atom.make<string | null>(null)) as never,
  };
});
vi.mock(import("~/remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenState: () => ({ mode: "local-exec" }) as never,
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ resolvedTheme: "dark" }) as never,
}));
vi.mock(import("~/hooks/useWorkspaceMutationRefresh"), () => ({
  useWorkspaceMutationRefresh: vi.fn(),
}));
vi.mock(import("./FileBreadcrumbs"), () => ({ FileBreadcrumbs: () => <></> }));
vi.mock(import("./projectFilesQueryState"), async (original) => ({
  ...(await original()),
  useProjectFileQuery: () => ({
    data: state.file,
    error: null,
    isPending: false,
    readError: null,
    isNotFile: false,
    isFile: true,
    refresh: vi.fn(),
  }),
  getOptimisticProjectFileQueryData: () => state.optimistic,
  getUnsavedProjectFileQueryData: () => null,
  setProjectFileQueryData: (
    _environmentId: EnvironmentId,
    _cwd: string,
    relativePath: string,
    contents: string,
  ) => {
    state.optimistic = { relativePath, contents, truncated: false, byteLength: contents.length };
  },
  confirmProjectFileQueryData: () => true,
}));

import FilePreviewPanel from "./FilePreviewPanel";
import { useRightPanelStore } from "~/rightPanelStore";

const environmentId = EnvironmentId.make("markdown-preview-test");
const threadRef = { environmentId, threadId: ThreadId.make("thread") };
function setup() {
  const keys = ["t3code.fileExplorerOpen", "t3code.renderMarkdown"];
  const previous = keys.map((key) => localStorage.getItem(key));
  localStorage.setItem(keys[0]!, "false");
  localStorage.setItem(keys[1]!, "true");
  state.optimistic = null;
  state.smalltalk = false;
  state.smalltalkFileSource = true;
  state.writeFile.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  return {
    [Symbol.dispose]() {
      useRightPanelStore.getState().removeThread(threadRef);
      for (const [index, key] of keys.entries()) {
        const value = previous[index];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    },
  };
}

function markdownPreview(truncated: boolean) {
  state.file = {
    relativePath: "tasks.md",
    contents: "- [ ] Keep the rest of this file\n",
    byteLength: truncated ? 1_200_000 : 32,
    truncated,
  };
  return (
    <FilePreviewPanel
      environmentId={environmentId}
      cwd="/workspace"
      projectName="Project"
      relativePath="tasks.md"
      threadRef={threadRef}
      composerDraftTarget={threadRef}
      keybindings={[]}
      availableEditors={[]}
      openInShortcutEnabled={false}
      revealLine={null}
      revealRequestId={0}
      onOpenFile={vi.fn()}
      onNavigateFolder={vi.fn()}
      folderTrail={undefined}
      onPendingChange={vi.fn()}
      selectedFilePending={false}
      workspaceMutationId={null}
    />
  );
}

describe("rendered Markdown task saves", () => {
  it("offers Smalltalk for the rendered Markdown file", async () => {
    using _settings = setup();
    state.smalltalk = true;
    state.writeFile.mockResolvedValue(AsyncResult.success({ id: "smalltalk-1" }));
    await using screen = await render(markdownPreview(false));
    await userEvent.click(screen.getByRole("button", { name: "说人话" }));
    await vi.waitFor(() =>
      expect(state.writeFile).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: {
          action: "create",
          threadId: threadRef.threadId,
          source: {
            kind: "markdown-file",
            relativePath: "tasks.md",
            text: "- [ ] Keep the rest of this file\n",
          },
        },
      }),
    );
    expect(
      useRightPanelStore
        .getState()
        .byThreadKey[scopedThreadKey(threadRef)]?.surfaces.some(
          (surface) => surface.kind === "smalltalk",
        ),
    ).toBe(true);
  });

  it("hides the Smalltalk action when the server cannot read file sources", async () => {
    using _settings = setup();
    state.smalltalk = true;
    state.smalltalkFileSource = false;
    await using screen = await render(markdownPreview(false));
    expect(screen.container.querySelector('button[aria-label="说人话"]')).toBeNull();
  });

  it("keeps a truncated read read-only without queuing a replacement", async () => {
    using _settings = setup();
    await using screen = await render(markdownPreview(true));
    using _timers = fakeTimers();
    const checkbox = screen.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.readOnly).toBe(true);
    await act(async () => checkbox.click());
    await vi.advanceTimersByTimeAsync(500);
    expect(checkbox.checked).toBe(false);
    expect(state.optimistic).toBeNull();
    expect(state.writeFile).not.toHaveBeenCalled();
  });

  it("still toggles and saves tasks from a complete read", async () => {
    using _settings = setup();
    await using screen = await render(markdownPreview(false));
    using _timers = fakeTimers();
    const checkbox = screen.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox.disabled).toBe(false);
    await act(async () => checkbox.click());
    await vi.advanceTimersByTimeAsync(500);
    expect(state.writeFile).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        cwd: "/workspace",
        relativePath: "tasks.md",
        contents: "- [x] Keep the rest of this file\n",
      },
    });
  });
});
