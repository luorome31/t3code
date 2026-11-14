import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { providerModelKey, sortProviderModelItems } from "./modelOrdering";

describe("sortProviderModelItems", () => {
  it("interleaves favorite models across providers independently of provider and model order", () => {
    const codex = ProviderInstanceId.make("codex");
    const claude = ProviderInstanceId.make("claudeAgent");
    const items = [
      { instanceId: codex, slug: "first" },
      { instanceId: codex, slug: "second" },
      { instanceId: claude, slug: "first" },
      { instanceId: claude, slug: "new" },
    ];
    const options = {
      instanceOrder: [claude, codex],
      favoriteModelOrder: [
        providerModelKey(codex, "second"),
        providerModelKey(claude, "first"),
        providerModelKey(codex, "first"),
        providerModelKey(claude, "removed"),
      ],
    };
    expect(sortProviderModelItems(items, options)).toEqual([
      items[1],
      items[2],
      items[0],
      items[3],
    ]);
    expect(sortProviderModelItems(items, { ...options, favoriteModelOrder: [] })).toEqual([
      items[2],
      items[3],
      items[0],
      items[1],
    ]);
    expect(items.map((item) => item.slug)).toEqual(["first", "second", "first", "new"]);
  });
});
