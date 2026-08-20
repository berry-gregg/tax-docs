import { describe, expect, test } from "bun:test";
import {
  emptyPaletteIndex,
  searchPalette,
  type PaletteIndex,
} from "../../src/client/app/command-palette.ts";

const index: PaletteIndex = {
  documents: [
    {
      id: "doc-1",
      label: "W-2 · Northwind Partners LLC",
      href: "/engagements/eng-1/review/doc-1",
    },
  ],
  clients: [{ id: "client-1", label: "Northwind Partners LLC", href: "/clients/client-1" }],
};

describe("command palette search", () => {
  test("empty query lists Actions then Pages, using Ramp path labels", () => {
    const groups = searchPalette("", index);

    expect(groups.map((group) => group.id)).toEqual(["Actions", "Pages"]);
    expect(groups[0]?.items.map((item) => item.label)).toContain(
      "Engagements / New engagement",
    );
    expect(groups[1]?.items.map((item) => item.label)).toEqual([
      "Inbox",
      "Home",
      "Documents",
      "Engagements",
      "Clients",
      "Settings",
    ]);
  });

  test("a query matches the live document and client index", () => {
    const groups = searchPalette("northwind", index);

    expect(groups.map((group) => group.id)).toContain("Documents");
    expect(groups.map((group) => group.id)).toContain("Clients");
    expect(groups.flatMap((group) => group.items).map((item) => item.href)).toContain(
      "/engagements/eng-1/review/doc-1",
    );
  });

  test("without a live index there is nothing to match beyond actions and pages", () => {
    expect(searchPalette("northwind", emptyPaletteIndex)).toEqual([]);
    expect(searchPalette("", emptyPaletteIndex).map((group) => group.id)).toEqual([
      "Actions",
      "Pages",
    ]);
  });

  test("a query with no hits returns no groups", () => {
    expect(searchPalette("zzzzzz", index)).toEqual([]);
  });

  test("palette actions point at routes the router actually knows", () => {
    const hrefs = searchPalette("", index)
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toContain("/engagements?new=1");
    expect(hrefs).toContain("/documents?tab=needs-review");
    expect(hrefs).not.toContain("/review");
  });
});
