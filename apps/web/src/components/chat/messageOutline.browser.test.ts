import { describe, expect, it } from "vite-plus/test";
import { readMessageOutline } from "./messageOutline";

const MESSAGE_ID = "message-1";

function mountMessage(html: string) {
  const row = document.createElement("div");
  row.dataset.messageId = MESSAGE_ID;
  row.innerHTML = html;
  document.body.append(row);
  return Object.assign(row, { [Symbol.dispose]: () => row.remove() });
}

describe("readMessageOutline", () => {
  it("reads rendered headings in order with their levels and text", () => {
    using _row = mountMessage(`
      <div class="chat-markdown">
        <h2>Overview <code>v2</code></h2>
        <h3>  Details\n  here </h3>
        <h1>Appendix</h1>
        <h4></h4>
      </div>
    `);
    const outline = readMessageOutline(MESSAGE_ID);
    expect(outline).toEqual([
      { index: 0, level: 2, text: "Overview v2" },
      { index: 1, level: 3, text: "Details here" },
      { index: 2, level: 1, text: "Appendix" },
      { index: 3, level: 4, text: "Untitled section" },
    ]);
  });

  it("ignores headings from a nested Markdown document", () => {
    using _row = mountMessage(`
      <div class="chat-markdown">
        <h2>Reply</h2>
        <div class="chat-markdown"><h1>Embedded</h1></div>
      </div>
    `);
    expect(readMessageOutline(MESSAGE_ID)).toEqual([{ index: 0, level: 2, text: "Reply" }]);
  });

  it("uses a formula's source instead of its duplicated rendered and MathML text", () => {
    using _row = mountMessage(`
      <div class="chat-markdown">
        <h2>
          Speed
          <span data-markdown-math="inline" data-markdown-copy="\\(O(n)\\)">
            <span class="katex">
              <span class="katex-mathml"><math><annotation>O(n)</annotation></math></span>
              <span class="katex-html">O(n)</span>
            </span>
          </span>
        </h2>
      </div>
    `);
    expect(readMessageOutline(MESSAGE_ID)).toEqual([
      { index: 0, level: 2, text: "Speed \\(O(n)\\)" },
    ]);
  });

  it("returns null when the reply is not mounted", () => {
    expect(readMessageOutline("message-missing")).toBeNull();
  });
});
