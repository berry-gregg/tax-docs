import { describe, expect, test } from "bun:test";
import { searchPalette } from "../../src/client/app/command-palette.ts";

describe("command palette search", () => {
  test("empty query lists Actions then Pages, using Ramp path labels", () => {
    const groups = searchPalette("");

    expect(groups.map((group) => group.id)).toEqual(["Actions", "Pages"]);
    expect(groups[0]?.items.map((item) => item.label)).toContain(
      "Documents / Request documents",
    );
    expect(groups[1]?.items.map((item) => item.label)).toEqual([
      "Inbox",
      "Home",
      "Documents",
      "Review",
      "Clients",
      "Settings",
    ]);
  });

  test("a query matches pages, actions, documents, and clients", () => {
    const groups = searchPalette("northwind");

    expect(groups.map((group) => group.id)).toContain("Documents");
    expect(groups.map((group) => group.id)).toContain("Clients");
    expect(groups.flatMap((group) => group.items).map((item) => item.label).join(" ")).toMatch(
      /Northwind/,
    );
  });

  test("a query with no hits returns no groups", () => {
    expect(searchPalette("zzzzzz")).toEqual([]);
  });
});
