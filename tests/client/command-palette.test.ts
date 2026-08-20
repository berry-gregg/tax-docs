import { describe, expect, test } from "bun:test";
import { searchPalette } from "../../src/client/app/command-palette.ts";
import type { SearchResult } from "../../src/shared/schemas/search.ts";

const entityResults: SearchResult[] = [
  {
    id: "doc-1",
    group: "Documents",
    label: "w-2.pdf · Northwind Partners LLC",
    href: "/documents/doc-1",
  },
  {
    id: "client-1",
    group: "Clients",
    label: "Northwind Partners LLC",
    href: "/clients/client-1",
  },
  {
    id: "eng-1",
    group: "Engagements",
    label: "Northwind Partners LLC · 2025 1065",
    href: "/engagements/eng-1",
  },
  {
    id: "type-1",
    group: "Document types",
    label: "W-2 wage statement",
    href: "/settings?tab=document-types",
  },
];

describe("command palette search", () => {
  test("empty query lists Actions then Pages, using Ramp path labels", () => {
    const groups = searchPalette("", []);

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

  test("server entity results render as grouped rows in a stable order", () => {
    const groups = searchPalette("northwind", entityResults);

    expect(groups.map((group) => group.id)).toEqual([
      "Clients",
      "Engagements",
      "Documents",
      "Document types",
    ]);
    expect(groups.flatMap((group) => group.items).map((item) => item.href)).toEqual([
      "/clients/client-1",
      "/engagements/eng-1",
      "/documents/doc-1",
      "/settings?tab=document-types",
    ]);
  });

  test("entity results are server-filtered and are not re-filtered against the label", () => {
    // An EIN query matches on a field the label does not contain — the row must still show.
    const einMatch: SearchResult[] = [
      {
        id: "client-1",
        group: "Clients",
        label: "Northwind Partners LLC",
        href: "/clients/client-1",
      },
    ];

    const groups = searchPalette("12-3456789", einMatch);

    expect(groups.map((group) => group.id)).toEqual(["Clients"]);
  });

  test("entity rows carry icons from the existing palette set", () => {
    const items = searchPalette("northwind", entityResults).flatMap((group) => group.items);
    const iconByGroup = new Map(items.map((item) => [item.group, item.icon]));

    expect(iconByGroup.get("Clients")).toBe("clients");
    expect(iconByGroup.get("Engagements")).toBe("engagements");
    expect(iconByGroup.get("Documents")).toBe("documents");
    expect(iconByGroup.get("Document types")).toBe("settings");
  });

  test("without server results there is nothing to match beyond actions and pages", () => {
    expect(searchPalette("northwind", [])).toEqual([]);
    expect(searchPalette("").map((group) => group.id)).toEqual(["Actions", "Pages"]);
  });

  test("a query with no hits returns no groups", () => {
    expect(searchPalette("zzzzzz", [])).toEqual([]);
  });

  test("palette actions point at routes the router actually knows", () => {
    const hrefs = searchPalette("")
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toContain("/engagements?new=1");
    expect(hrefs).toContain("/documents?tab=needs-review");
    expect(hrefs).not.toContain("/review");
  });
});
