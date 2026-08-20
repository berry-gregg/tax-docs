import { describe, expect, test } from "bun:test";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { moduleFor } from "../../src/client/app/pages/registry.ts";
import { reviewPage } from "../../src/client/app/pages/review.ts";
import type { Route } from "../../src/client/app/router.ts";

const routes: Route[] = [
  { page: "home" },
  { page: "inbox" },
  { page: "documents" },
  { page: "engagements" },
  { page: "engagement", id: "eng-1" },
  { page: "review", documentId: "doc-1" },
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

  test("the review route resolves to the field-level review workspace", () => {
    const route: Route = { page: "review", documentId: "doc-1" };

    expect(moduleFor(route)).toBe(reviewPage);
    expect(reviewPage.pollMs).toBe(POLL_INTERVAL_MS);
  });

  test("no route resolves to an unbuilt placeholder any more", () => {
    for (const route of routes) {
      const module = moduleFor(route);

      expect(module.render).not.toBe(undefined);
      expect(String(module.render)).not.toContain("is not built yet");
    }
  });

  test("an unknown route renders the inline not-found state", async () => {
    const module = moduleFor({ page: "not-found" });
    const data = await module.load({ page: "not-found" });

    expect(module.render(data)).toContain("Page not found");
  });
});
