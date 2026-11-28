import { describe, expect, it } from "vite-plus/test";
import type { MessageOutlineHeading } from "../chat/messageOutline";
import {
  MARKDOWN_OUTLINE_DOCK_MIN_WIDTH,
  filterOutlineHeadings,
  resolveActiveHeadingIndex,
  resolveMarkdownOutlineLayout,
  resolveOutlineTopLevel,
  resolveVisibleActiveHeadingIndex,
  resolveVisualOutlineDepth,
  sameOutlineHeadings,
  selectVisibleOutlineHeadings,
} from "./markdownOutline.logic";

const SAMPLE_HEADINGS: readonly MessageOutlineHeading[] = [
  { index: 0, level: 2, text: "Overview" },
  { index: 1, level: 3, text: "Architecture Details" },
  { index: 2, level: 2, text: "API Reference" },
  { index: 3, level: 4, text: "Edge Cases" },
];

describe("sameOutlineHeadings", () => {
  it("returns true for equal heading lists and false when index, level, text, or length differ", () => {
    expect(sameOutlineHeadings(SAMPLE_HEADINGS, [...SAMPLE_HEADINGS])).toBe(true);
    expect(
      sameOutlineHeadings(
        SAMPLE_HEADINGS,
        SAMPLE_HEADINGS.map((heading) => ({ ...heading })),
      ),
    ).toBe(true);
    expect(sameOutlineHeadings(SAMPLE_HEADINGS, SAMPLE_HEADINGS.slice(0, 3))).toBe(false);
    expect(
      sameOutlineHeadings(SAMPLE_HEADINGS, [
        SAMPLE_HEADINGS[0]!,
        { ...SAMPLE_HEADINGS[1]!, level: 2 },
        ...SAMPLE_HEADINGS.slice(2),
      ]),
    ).toBe(false);
    expect(
      sameOutlineHeadings(SAMPLE_HEADINGS, [
        SAMPLE_HEADINGS[0]!,
        { ...SAMPLE_HEADINGS[1]!, text: "Changed" },
        ...SAMPLE_HEADINGS.slice(2),
      ]),
    ).toBe(false);
  });
});

describe("resolveOutlineTopLevel", () => {
  it("normalizes to the shallowest heading level in the document", () => {
    expect(resolveOutlineTopLevel([])).toBe(1);
    expect(resolveOutlineTopLevel(SAMPLE_HEADINGS)).toBe(2);
    expect(
      resolveOutlineTopLevel([
        { index: 0, level: 3, text: "Sub" },
        { index: 1, level: 1, text: "Title" },
      ]),
    ).toBe(1);
  });
});

describe("filterOutlineHeadings", () => {
  it("filters headings case-insensitively and ignores surrounding whitespace", () => {
    expect(filterOutlineHeadings(SAMPLE_HEADINGS, "   ")).toBe(SAMPLE_HEADINGS);
    expect(filterOutlineHeadings(SAMPLE_HEADINGS, " api ")).toEqual([SAMPLE_HEADINGS[2]]);
    expect(filterOutlineHeadings(SAMPLE_HEADINGS, "missing")).toEqual([]);
  });
});

describe("resolveActiveHeadingIndex", () => {
  const tops = [
    { index: 0, top: 20 },
    { index: 1, top: 240 },
    { index: 2, top: 520 },
    { index: 3, top: 900 },
  ];

  it("returns null for empty headings", () => {
    expect(
      resolveActiveHeadingIndex({
        headingTops: [],
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 1200,
      }),
    ).toBeNull();
  });

  it("pins to the first heading at the top of the scroll viewport", () => {
    expect(
      resolveActiveHeadingIndex({
        headingTops: [
          { index: 0, top: 80 },
          { index: 1, top: 240 },
        ],
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 1200,
      }),
    ).toBe(0);
  });

  it("picks the last heading past the activation offset while scrolling through the middle", () => {
    expect(
      resolveActiveHeadingIndex({
        headingTops: [
          { index: 0, top: -220 },
          { index: 1, top: 18 },
          { index: 2, top: 290 },
          { index: 3, top: 680 },
        ],
        scrollTop: 260,
        clientHeight: 400,
        scrollHeight: 1200,
      }),
    ).toBe(1);
  });

  it("activates the final heading when scrolled to the bottom of the document", () => {
    expect(
      resolveActiveHeadingIndex({
        headingTops: tops.map((entry) => ({ ...entry, top: entry.top - 500 })),
        scrollTop: 800,
        clientHeight: 400,
        scrollHeight: 1200,
      }),
    ).toBe(3);
  });
});

describe("resolveMarkdownOutlineLayout", () => {
  it("disables docking and toggles when disabled or headingless", () => {
    expect(
      resolveMarkdownOutlineLayout({
        enabled: false,
        headingCount: 5,
        surfaceWidth: 900,
        maximized: true,
        maximizedOpen: true,
        pinned: true,
      }),
    ).toEqual({
      hasHeadings: false,
      canDock: false,
      usesDockedToggle: false,
      dockedOpen: false,
      canPinInPopover: false,
      canUnpinInSidebar: false,
    });
    expect(
      resolveMarkdownOutlineLayout({
        enabled: true,
        headingCount: 0,
        surfaceWidth: 900,
        maximized: true,
        maximizedOpen: true,
        pinned: true,
      }),
    ).toEqual({
      hasHeadings: false,
      canDock: false,
      usesDockedToggle: false,
      dockedOpen: false,
      canPinInPopover: false,
      canUnpinInSidebar: false,
    });
  });

  it("uses popover mode on narrow panels even if pinned or maximized", () => {
    expect(
      resolveMarkdownOutlineLayout({
        enabled: true,
        headingCount: 4,
        surfaceWidth: MARKDOWN_OUTLINE_DOCK_MIN_WIDTH - 1,
        maximized: true,
        maximizedOpen: true,
        pinned: true,
      }),
    ).toEqual({
      hasHeadings: true,
      canDock: false,
      usesDockedToggle: false,
      dockedOpen: false,
      canPinInPopover: false,
      canUnpinInSidebar: false,
    });
  });

  it("allows pinning on wide non-maximized panels and unpinning when docked", () => {
    expect(
      resolveMarkdownOutlineLayout({
        enabled: true,
        headingCount: 4,
        surfaceWidth: MARKDOWN_OUTLINE_DOCK_MIN_WIDTH,
        maximized: false,
        maximizedOpen: true,
        pinned: false,
      }),
    ).toEqual({
      hasHeadings: true,
      canDock: true,
      usesDockedToggle: false,
      dockedOpen: false,
      canPinInPopover: true,
      canUnpinInSidebar: false,
    });

    expect(
      resolveMarkdownOutlineLayout({
        enabled: true,
        headingCount: 4,
        surfaceWidth: MARKDOWN_OUTLINE_DOCK_MIN_WIDTH,
        maximized: false,
        maximizedOpen: true,
        pinned: true,
      }),
    ).toEqual({
      hasHeadings: true,
      canDock: true,
      usesDockedToggle: false,
      dockedOpen: true,
      canPinInPopover: false,
      canUnpinInSidebar: true,
    });
  });

  it("defaults to left-docked sidebar when maximized and wide, and allows toggling closed", () => {
    expect(
      resolveMarkdownOutlineLayout({
        enabled: true,
        headingCount: 4,
        surfaceWidth: MARKDOWN_OUTLINE_DOCK_MIN_WIDTH,
        maximized: true,
        maximizedOpen: true,
        pinned: false,
      }),
    ).toEqual({
      hasHeadings: true,
      canDock: true,
      usesDockedToggle: true,
      dockedOpen: true,
      canPinInPopover: false,
      canUnpinInSidebar: false,
    });

    expect(
      resolveMarkdownOutlineLayout({
        enabled: true,
        headingCount: 4,
        surfaceWidth: MARKDOWN_OUTLINE_DOCK_MIN_WIDTH,
        maximized: true,
        maximizedOpen: false,
        pinned: false,
      }),
    ).toEqual({
      hasHeadings: true,
      canDock: true,
      usesDockedToggle: true,
      dockedOpen: false,
      canPinInPopover: false,
      canUnpinInSidebar: false,
    });
  });
});

describe("selectVisibleOutlineHeadings", () => {
  const deepHeadings: readonly MessageOutlineHeading[] = [
    { index: 0, level: 1, text: "Title" },
    { index: 1, level: 2, text: "Section" },
    { index: 2, level: 3, text: "Subsection" },
    { index: 3, level: 4, text: "Detail" },
    { index: 4, level: 5, text: "Leaf" },
    { index: 5, level: 6, text: "Deepest" },
  ];

  it("shows top 3 relative levels by default for H1-H6 documents", () => {
    expect(selectVisibleOutlineHeadings(deepHeadings, false)).toEqual({
      topLevel: 1,
      visibleHeadings: deepHeadings.slice(0, 3),
      hasDeeperHeadings: true,
      hiddenCount: 3,
    });
  });

  it("shows H2-H4 by default when the document starts at H2", () => {
    const h2Start: readonly MessageOutlineHeading[] = [
      { index: 0, level: 2, text: "Part A" },
      { index: 1, level: 3, text: "Topic 1" },
      { index: 2, level: 4, text: "Subtopic" },
      { index: 3, level: 5, text: "Nested" },
    ];
    expect(selectVisibleOutlineHeadings(h2Start, false)).toEqual({
      topLevel: 2,
      visibleHeadings: h2Start.slice(0, 3),
      hasDeeperHeadings: true,
      hiddenCount: 1,
    });
  });

  it("reveals all headings when expanded and reports no hidden deeper headings when shallow", () => {
    expect(selectVisibleOutlineHeadings(deepHeadings, true)).toEqual({
      topLevel: 1,
      visibleHeadings: deepHeadings,
      hasDeeperHeadings: true,
      hiddenCount: 0,
    });
    expect(selectVisibleOutlineHeadings(deepHeadings.slice(0, 3), false)).toEqual({
      topLevel: 1,
      visibleHeadings: deepHeadings.slice(0, 3),
      hasDeeperHeadings: false,
      hiddenCount: 0,
    });
  });
});

describe("resolveVisibleActiveHeadingIndex", () => {
  it("rolls up a hidden deep heading to its nearest preceding visible heading", () => {
    const visible: readonly MessageOutlineHeading[] = [
      { index: 0, level: 1, text: "Title" },
      { index: 1, level: 2, text: "Section" },
      { index: 2, level: 3, text: "Subsection" },
      { index: 5, level: 2, text: "Next" },
    ];
    expect(resolveVisibleActiveHeadingIndex(visible, null)).toBeNull();
    expect(resolveVisibleActiveHeadingIndex([], 2)).toBeNull();
    expect(resolveVisibleActiveHeadingIndex(visible, 4)).toBe(2);
    expect(resolveVisibleActiveHeadingIndex(visible, 5)).toBe(5);
  });
});

describe("resolveVisualOutlineDepth", () => {
  it("caps visual indentation depth at 3 levels", () => {
    expect(resolveVisualOutlineDepth(1, 1)).toBe(0);
    expect(resolveVisualOutlineDepth(3, 1)).toBe(2);
    expect(resolveVisualOutlineDepth(4, 1)).toBe(3);
    expect(resolveVisualOutlineDepth(6, 1)).toBe(3);
  });
});
