import { DEFAULT_THEMES, preloadHighlighter } from "@pierre/diffs";
import { EnvironmentId, ThreadId, type ProjectReadFileResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { page, userEvent } from "vite-plus/test/browser";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import appCss from "~/index.css?inline";
import { isMacPlatform } from "~/lib/utils";
import {
  createWorkspaceFocusController,
  startWorkspaceFocus,
  workspaceAreaProps,
} from "~/lib/workspaceFocus";

const state = vi.hoisted(() => ({
  file: null as ProjectReadFileResult | null,
  optimistic: null as ProjectReadFileResult | null,
  writeFile: vi.fn(),
  smalltalk: false,
  smalltalkFileSource: true,
  assetUrl: { _tag: "Loading" } as import("~/assets/assetUrls").AssetUrlState,
  mintUrl: vi.fn<() => Promise<string | null>>(),
  browserAssetMints: 0,
  openedBrowserUrls: [] as string[],
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
  // Markdown reads the server's OS to label reveal-in-file-manager, so the fake carries it.
  const platform = { os: "linux", arch: "x64" } as const;
  const smalltalkConfig = Atom.make({
    environment: { platform, capabilities: { smalltalk: true, smalltalkFileSource: true } },
  });
  const smalltalkConfigWithoutFileSource = Atom.make({
    environment: { platform, capabilities: { smalltalk: true } },
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
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlRefresh: () => state.mintUrl,
  useAssetUrlState: () => state.assetUrl,
}));
vi.mock(import("~/browser/previewRuntime"), async (original) => ({
  ...(await original()),
  usePreviewAvailable: () => true,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentHttpBaseUrl: () => "http://environment.test",
}));
vi.mock(import("~/state/assets"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const Effect = await import("effect/Effect");
  // Like the real query family, a minted URL stays cached until the atom is refreshed.
  const createUrl = Atom.family((_key: string) =>
    Atom.make(
      Effect.sync(() => ({
        relativeUrl: `/api/assets/mint-${++state.browserAssetMints}/page.html`,
        expiresAt: Number.MAX_SAFE_INTEGER,
      })),
    ).pipe(Atom.keepAlive),
  );
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: ((target: { input: { resource: { path: string } } }) =>
        createUrl(target.input.resource.path)) as never,
    },
  };
});
vi.mock(import("~/browser/openFileInPreview"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    openFileInPreview: (async (input: Parameters<typeof actual.openFileInPreview>[0]) => {
      const result = await input.createAssetUrl({
        environmentId: input.threadRef.environmentId,
        input: {
          resource: {
            _tag: "workspace-file",
            threadId: input.threadRef.threadId,
            path: input.filePath,
          },
        },
      });
      if (result._tag === "Success") state.openedBrowserUrls.push(result.value.relativeUrl);
      return AsyncResult.success(undefined);
    }) as never,
  };
});
// The Word engine compiles a large WebAssembly bundle; these tests only need the URL it loads.
vi.mock(import("./OfficeFilePreview"), () => ({
  OfficeFilePreview: ({ src }: { src: string }) => <div data-testid="office-preview">{src}</div>,
}));
vi.mock(import("./FileBreadcrumbs"), () => ({ FileBreadcrumbs: () => <></> }));
vi.mock(import("./FileBrowserPanel"), () => ({
  default: () => (
    <div role="tree">
      <button type="button" role="treeitem" data-item-path="src/">
        src
      </button>
      <button type="button" role="treeitem" data-item-path="server.ts">
        server.ts
      </button>
    </div>
  ),
}));
vi.mock(import("../DiffWorkerPoolProvider"), () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
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
  const keys = [
    "t3code.fileExplorerOpen",
    "t3code.renderMarkdown",
    "t3code.markdownOutlineMaximizedOpen",
    "t3code.markdownOutlinePinned",
    "t3code.markdownOutlineWidth",
  ];
  const previous = keys.map((key) => localStorage.getItem(key));
  localStorage.setItem(keys[0]!, "false");
  localStorage.setItem(keys[1]!, "true");
  localStorage.removeItem(keys[2]!);
  localStorage.removeItem(keys[3]!);
  localStorage.removeItem(keys[4]!);
  state.file = null;
  state.optimistic = null;
  state.smalltalk = false;
  state.smalltalkFileSource = true;
  state.assetUrl = { _tag: "Loading" };
  state.openedBrowserUrls = [];
  let mints = 0;
  state.mintUrl.mockReset().mockImplementation(async () => `/assets/report.docx?mint=${++mints}`);
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

function markdownPreview(
  truncated: boolean,
  contents = "- [ ] Keep the rest of this file\n",
  maximized = false,
) {
  state.file = {
    relativePath: "tasks.md",
    contents,
    byteLength: truncated ? 1_200_000 : contents.length,
    truncated,
  };
  return filePreview("tasks.md", null, maximized);
}

function filePreview(
  relativePath: string,
  workspaceMutationId: string | null = null,
  maximized = false,
) {
  return (
    <FilePreviewPanel
      environmentId={environmentId}
      cwd="/workspace"
      projectName="Project"
      relativePath={relativePath}
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
      workspaceMutationId={workspaceMutationId}
      maximized={maximized}
    />
  );
}

function documentPreview(workspaceMutationId: string, fileRevision: string) {
  state.file = null;
  state.assetUrl = {
    _tag: "Success",
    url: "/assets/report.docx",
    expiresAt: Number.MAX_SAFE_INTEGER,
    fileRevision,
  };
  return filePreview("report.docx", workspaceMutationId);
}

function deepActiveElement() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

describe("source file focus", () => {
  it("hands panel focus to the file's editor, which owns mod+f", async () => {
    using _settings = setup();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };
    await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["typescript"] });
    const panel = () => (
      <div {...workspaceAreaProps("panel", 1, "Workspace panel")}>
        <div data-right-panel-surface-content>{filePreview("server.ts")}</div>
      </div>
    );
    const editorHasFocus = () => expect(deepActiveElement()?.matches("[data-content]")).toBe(true);

    await using screen = await render(panel());
    const focus = createWorkspaceFocusController(document);
    using _focus = { [Symbol.dispose]: focus.dispose };
    expect(focus.focus("panel")).toBe(true);
    state.file = {
      relativePath: "server.ts",
      contents: "const server = 1;\n",
      byteLength: 18,
      truncated: false,
    };
    await screen.rerender(panel());
    await vi.waitFor(editorHasFocus);
    await userEvent.keyboard("x");
    await vi.waitFor(() => expect(deepActiveElement()?.textContent).toContain("xconst server"));

    (deepActiveElement() as HTMLElement).blur();
    expect(focus.focus("panel", false)).toBe(true);
    await vi.waitFor(editorHasFocus);
    await userEvent.keyboard(
      isMacPlatform(navigator.platform) ? "{Meta>}f{/Meta}" : "{Control>}f{/Control}",
    );
    await vi.waitFor(() => expect(deepActiveElement()).toBeInstanceOf(HTMLInputElement));

    const findField = deepActiveElement() as HTMLInputElement;
    await userEvent.keyboard("server");
    findField.blur();
    expect(focus.focus("panel", false)).toBe(true);
    await vi.waitFor(editorHasFocus);
    const editor = deepActiveElement() as HTMLElement;
    await userEvent.keyboard("ab");
    await vi.waitFor(() => expect(editor.textContent).toContain("xabconst server"));
    expect(findField.value).toBe("server");
    editorHasFocus();
  });

  it("focuses the editor when a file row is clicked or activated with Enter", async () => {
    using _settings = setup();
    localStorage.setItem("t3code.fileExplorerOpen", "true");
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };
    await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["typescript"] });
    state.file = {
      relativePath: "server.ts",
      contents: "const server = 1;\n",
      byteLength: 18,
      truncated: false,
    };
    await using screen = await render(
      <div {...workspaceAreaProps("panel", 1, "Workspace panel")} style={{ width: 900 }}>
        <div data-right-panel-surface-content>{filePreview("server.ts")}</div>
      </div>,
    );
    using _focus = {
      [Symbol.dispose]: startWorkspaceFocus({ subscribe: () => () => {} } as never),
    };
    const editorHasFocus = () => expect(deepActiveElement()?.matches("[data-content]")).toBe(true);
    // The explorer measures its parent row; a wrapper without a box would cap it at the minimum.
    await expect
      .element(screen.getByRole("separator", { name: "Resize file explorer" }))
      .toHaveAttribute("aria-valuemax", "560");
    const folderRow = screen.getByRole("treeitem", { name: "src" });
    const fileRow = screen.getByRole("treeitem", { name: "server.ts" });

    (folderRow.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(folderRow.element());

    await userEvent.click(fileRow);
    await vi.waitFor(editorHasFocus);

    (fileRow.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(editorHasFocus);
  });
});

describe("source file scroll", () => {
  it("returns a file tab to where it was scrolled after another file was shown", async () => {
    using _settings = setup();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };
    await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["typescript"] });
    const sourceFile = (relativePath: string, lines: number) => {
      const contents = Array.from({ length: lines }, (_, i) => `const line${i} = ${i};`).join("\n");
      state.file = { relativePath, contents, byteLength: contents.length, truncated: false };
      // The app mounts under StrictMode, whose remount must not wipe the saved offset.
      return (
        <StrictMode>
          <div style={{ height: 400, display: "flex", flexDirection: "column" }}>
            {filePreview(relativePath)}
          </div>
        </StrictMode>
      );
    };
    const scroller = () => document.querySelector<HTMLElement>(".file-preview-virtualizer");

    await using screen = await render(sourceFile("a.ts", 2000));
    await vi.waitFor(() => expect(scroller()?.scrollHeight).toBeGreaterThan(5000));
    scroller()!.scrollTop = 4200;
    await vi.waitFor(() => expect(scroller()?.scrollTop).toBe(4200));

    await screen.rerender(sourceFile("b.ts", 1500));
    await vi.waitFor(() => expect(scroller()?.scrollTop).toBe(0));
    await screen.rerender(sourceFile("a.ts", 2000));

    await vi.waitFor(() => expect(scroller()?.scrollTop).toBe(4200));
  });
});

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

describe("workspace document previews", () => {
  it("keeps an unchanged document loaded when another workspace change lands", async () => {
    using _settings = setup();
    await using screen = await render(documentPreview("mutation-1", "revision-1"));
    const preview = screen.getByTestId("office-preview");
    await expect.element(preview).toHaveTextContent("/assets/report.docx?mint=1");
    const loaded = preview.element();

    await screen.rerender(documentPreview("mutation-2", "revision-1"));

    expect(state.mintUrl, "an unchanged document re-minted its URL").toHaveBeenCalledOnce();
    expect(screen.container.contains(loaded), "an unchanged document was remounted").toBe(true);
  });

  it("keeps an unchanged document mounted while its revision check reloads", async () => {
    using _settings = setup();
    await using screen = await render(documentPreview("mutation-1", "revision-1"));
    const preview = screen.getByTestId("office-preview");
    await expect.element(preview).toHaveTextContent("/assets/report.docx?mint=1");
    const loaded = preview.element();

    state.assetUrl = { _tag: "Loading" };
    await screen.rerender(filePreview("report.docx", "mutation-1"));
    await screen.rerender(documentPreview("mutation-1", "revision-1"));

    expect(
      state.mintUrl,
      "a reloading revision check re-minted the document URL",
    ).toHaveBeenCalledOnce();
    expect(
      screen.container.contains(loaded),
      "a reloading revision check remounted the document",
    ).toBe(true);
  });

  it("reloads the document when its URL can no longer be minted", async () => {
    using _settings = setup();
    await using screen = await render(documentPreview("mutation-1", "revision-1"));
    const preview = screen.getByTestId("office-preview");
    await expect.element(preview).toHaveTextContent("/assets/report.docx?mint=1");

    state.assetUrl = { _tag: "Failure" };
    await screen.rerender(filePreview("report.docx", "mutation-2"));

    await expect.element(preview).toHaveTextContent("/assets/report.docx?mint=2");
  });

  it("loads the new bytes when the document itself changes", async () => {
    using _settings = setup();
    await using screen = await render(documentPreview("mutation-1", "revision-1"));
    const preview = screen.getByTestId("office-preview");
    await expect.element(preview).toHaveTextContent("/assets/report.docx?mint=1");

    await screen.rerender(documentPreview("mutation-2", "revision-2"));

    await expect.element(preview).toHaveTextContent("/assets/report.docx?mint=2");
  });
});

describe("open file in preview browser", () => {
  it("mints a fresh asset URL on every click so the browser cannot reuse cached bytes", async () => {
    using _settings = setup();
    state.file = {
      relativePath: "page.html",
      contents: "<h1>page</h1>",
      byteLength: 13,
      truncated: false,
    };
    await using screen = await render(filePreview("page.html"));
    const button = screen.getByRole("button", { name: "Open file in preview browser" });

    await userEvent.click(button);
    await vi.waitFor(() => expect(state.openedBrowserUrls).toHaveLength(1));
    await userEvent.click(button);
    await vi.waitFor(() => expect(state.openedBrowserUrls).toHaveLength(2));

    expect(state.openedBrowserUrls[1], "the second click reused the first signed URL").not.toBe(
      state.openedBrowserUrls[0],
    );
  });
});

describe("rendered Markdown select all", () => {
  it("selects only the rendered file, including after a task toggle", async () => {
    using _settings = setup();
    await using screen = await render(
      <>
        <p>Transcript text from the chat thread.</p>
        {markdownPreview(false, "- [ ] Task item\n\nRendered file body.\n")}
      </>,
    );
    const expectFileOnlySelection = async () => {
      await userEvent.keyboard(
        isMacPlatform(navigator.platform) ? "{Meta>}a{/Meta}" : "{Control>}a{/Control}",
      );
      const selection = window.getSelection()?.toString() ?? "";
      expect(selection).toContain("Rendered file body.");
      expect(selection).not.toContain("Transcript text from the chat thread.");
    };

    await userEvent.click(screen.getByText("Rendered file body."));
    await expectFileOnlySelection();
    // A toggled checkbox keeps focus on an input inside the preview.
    await userEvent.click(screen.getByRole("checkbox"));
    await expectFileOnlySelection();
  });
});

function buildLongMarkdown(sectionCount: number): string {
  return Array.from({ length: sectionCount }, (_, index) => {
    const n = index + 1;
    const filler = Array.from(
      { length: 6 },
      (__, p) => `Paragraph ${n}.${p + 1} with enough vertical content to require scrolling.`,
    ).join("\n\n");
    return `## Section ${n}\n\n${filler}`;
  }).join("\n\n");
}

describe("rendered Markdown outline", () => {
  it("disables the outline toggle when the Markdown file has no headings", async () => {
    using _settings = setup();
    await using screen = await render(
      <div style={{ width: 480, height: 360, display: "flex", flexDirection: "column" }}>
        {markdownPreview(false, "Just a plain paragraph without headings.\n")}
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "No headings in this file" }))
      .toBeDisabled();
  });

  it("opens a searchable outline popover on narrow panels, jumps to headings, and closes", async () => {
    using _settings = setup();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };

    const longMarkdown = buildLongMarkdown(10);
    await using screen = await render(
      <div style={{ width: 480, height: 360, display: "flex", flexDirection: "column" }}>
        {markdownPreview(false, longMarkdown)}
      </div>,
    );

    const toggle = screen.getByRole("button", { name: "Show outline" });
    await expect.element(toggle).toBeEnabled();
    await userEvent.click(toggle);

    const filterInput = page.getByRole("searchbox", { name: "Filter headings" });
    await expect.element(filterInput).toBeVisible();
    await userEvent.type(filterInput, "Section 9");

    const section9 = page.getByRole("button", { name: "Section 9" });
    await expect.element(section9).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Section 1", exact: true }))
      .not.toBeInTheDocument();

    await userEvent.click(section9);

    const viewport = screen.container.querySelector<HTMLElement>(
      '[data-markdown-scroll-area] [data-slot="scroll-area-viewport"]',
    )!;
    await vi.waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(100));
    await expect.element(filterInput).not.toBeInTheDocument();
  });

  it("docks a Typora-style left outline sidebar by default when maximized on wide panels and toggles cleanly", async () => {
    using _settings = setup();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };

    const markdown = "# Overview\n\nIntro\n\n## Details\n\nBody\n";
    const renderView = (width: number, maximized: boolean) => (
      <div style={{ width, height: 480, display: "flex", flexDirection: "column" }}>
        {markdownPreview(false, markdown, maximized)}
      </div>
    );

    await using screen = await render(renderView(820, true));
    const sidebar = screen.getByRole("complementary", { name: "Document outline" });
    await expect.element(sidebar).toBeVisible();

    const sidebarRect = sidebar.element().getBoundingClientRect();
    const viewportRect = screen.container
      .querySelector<HTMLElement>('[data-markdown-scroll-area] [data-slot="scroll-area-viewport"]')!
      .getBoundingClientRect();
    expect(sidebarRect.right).toBeLessThanOrEqual(viewportRect.left + 1);

    await userEvent.click(screen.getByRole("button", { name: "Hide outline" }).first());
    await expect.element(sidebar).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show outline" }));
    await expect
      .element(screen.getByRole("complementary", { name: "Document outline" }))
      .toBeVisible();

    await screen.rerender(renderView(480, false));
    await expect
      .element(screen.getByRole("complementary", { name: "Document outline" }))
      .not.toBeInTheDocument();
  });

  it("allows pinning and unpinning the left outline sidebar on wide non-maximized panels", async () => {
    using _settings = setup();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };

    const markdown = "# Overview\n\nIntro\n\n## Details\n\nBody\n";
    await using screen = await render(
      <div style={{ width: 820, height: 480, display: "flex", flexDirection: "column" }}>
        {markdownPreview(false, markdown, false)}
      </div>,
    );

    expect(screen.container.querySelector("[data-markdown-outline-sidebar]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show outline" }));

    const pinButton = page.getByRole("button", { name: "Pin outline" });
    await expect.element(pinButton).toBeVisible();
    await userEvent.click(pinButton);

    const sidebar = screen.getByRole("complementary", { name: "Document outline" });
    await expect.element(sidebar).toBeVisible();
    await expect.element(pinButton).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Unpin outline" }));
    await expect.element(sidebar).not.toBeInTheDocument();
  });

  it("shows top 3 relative heading levels by default, expands deeper levels with capped indentation, and collapses back", async () => {
    using _settings = setup();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    using _style = { [Symbol.dispose]: () => style.remove() };

    const deepMarkdown = [
      "# Level 1",
      "## Level 2",
      "### Level 3",
      "#### Level 4",
      "##### Level 5",
    ].join("\n\n");
    await using screen = await render(
      <div style={{ width: 820, height: 480, display: "flex", flexDirection: "column" }}>
        {markdownPreview(false, deepMarkdown, true)}
      </div>,
    );

    const sidebar = screen.getByRole("complementary", { name: "Document outline" });
    await expect.element(sidebar).toBeVisible();
    await expect.element(sidebar.getByRole("button", { name: "Level 1" })).toBeVisible();
    await expect.element(sidebar.getByRole("button", { name: "Level 3" })).toBeVisible();
    await expect.element(sidebar.getByRole("button", { name: "Level 4" })).not.toBeInTheDocument();
    await expect.element(sidebar.getByRole("button", { name: "Level 5" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all heading levels" }));
    const level4 = sidebar.getByRole("button", { name: "Level 4" });
    const level5 = sidebar.getByRole("button", { name: "Level 5" });
    await expect.element(level4).toBeVisible();
    await expect.element(level5).toBeVisible();
    expect((level5.element() as HTMLElement).style.paddingLeft).toBe("46px");

    await userEvent.click(screen.getByRole("button", { name: "Show top 3 levels" }));
    await expect.element(sidebar.getByRole("button", { name: "Level 4" })).not.toBeInTheDocument();
    await expect.element(sidebar.getByRole("button", { name: "Level 5" })).not.toBeInTheDocument();
  });
});
