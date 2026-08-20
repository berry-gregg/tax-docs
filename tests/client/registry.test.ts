import { describe, expect, test } from "bun:test";
import { moduleFor } from "../../src/client/app/pages/registry.ts";
import type { Route } from "../../src/client/app/router.ts";

const routes: Route[] = [
  { page: "home" },
  { page: "inbox" },
  { page: "documents" },
  { page: "engagements" },
  { page: "engagement", id: "eng-1" },
  { page: "review", engagementId: "eng-1", documentId: "doc-1" },
  { page: "export", engagementId: "eng-1" },
  { page: "clients" },
  { page: "client", id: "client-1" },
  { page: "settings" },
  { page: "portal", token: "tok" },
  { page: "not-found" },
];

describe("page registry", () => {
  test("every route resolves to a module with load and render", () => {
    for (const route of routes) {
      const module = moduleFor(route);

      expect(typeof module.load).toBe("function");
      expect(typeof module.render).toBe("function");
    }
  });

  test("placeholder pages render a titled body without touching the network", async () => {
    const placeholders: [Route, string][] = [
      [{ page: "inbox" }, "Inbox"],
      [{ page: "documents" }, "Documents"],
      [{ page: "engagements" }, "Engagements"],
      [{ page: "engagement", id: "eng-1" }, "Engagement"],
      [{ page: "review", engagementId: "eng-1", documentId: "doc-1" }, "Review"],
      [{ page: "export", engagementId: "eng-1" }, "Export"],
      [{ page: "clients" }, "Clients"],
      [{ page: "client", id: "client-1" }, "Client"],
      [{ page: "settings" }, "Settings"],
      [{ page: "portal", token: "tok" }, "Tax Docs LLP"],
    ];

    for (const [route, expected] of placeholders) {
      const module = moduleFor(route);
      const data = await module.load(route);

      expect(module.render(data)).toContain(expected);
    }
  });

  test("an unknown route renders the inline not-found state", async () => {
    const module = moduleFor({ page: "not-found" });
    const data = await module.load({ page: "not-found" });

    expect(module.render(data)).toContain("Page not found");
  });
});
