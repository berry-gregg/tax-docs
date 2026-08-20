import { describe, expect, test } from "bun:test";
import { navIdForRoute } from "../../src/client/app/nav.ts";
import { parseRoute } from "../../src/client/app/router.ts";

describe("parseRoute", () => {
  test("maps the flat product paths", () => {
    expect(parseRoute("/")).toEqual({ page: "home" });
    expect(parseRoute("/home")).toEqual({ page: "home" });
    expect(parseRoute("/inbox")).toEqual({ page: "inbox" });
    expect(parseRoute("/documents")).toEqual({ page: "documents" });
    expect(parseRoute("/engagements")).toEqual({ page: "engagements" });
    expect(parseRoute("/clients")).toEqual({ page: "clients" });
    expect(parseRoute("/settings")).toEqual({ page: "settings" });
  });

  test("maps the parameterised paths", () => {
    expect(parseRoute("/engagements/e1")).toEqual({ page: "engagement", id: "e1" });
    expect(parseRoute("/engagements/e1/review/d1")).toEqual({
      page: "review",
      engagementId: "e1",
      documentId: "d1",
    });
    expect(parseRoute("/engagements/e1/export")).toEqual({ page: "export", engagementId: "e1" });
    expect(parseRoute("/clients/c1")).toEqual({ page: "client", id: "c1" });
    expect(parseRoute("/portal/tok")).toEqual({ page: "portal", token: "tok" });
  });

  test("normalises trailing slashes and an empty pathname", () => {
    expect(parseRoute("/documents/")).toEqual({ page: "documents" });
    expect(parseRoute("/engagements/e1///")).toEqual({ page: "engagement", id: "e1" });
    expect(parseRoute("/engagements/e1/review/d1/")).toEqual({
      page: "review",
      engagementId: "e1",
      documentId: "d1",
    });
    expect(parseRoute("")).toEqual({ page: "home" });
  });

  test("decodes percent-encoded params", () => {
    expect(parseRoute("/portal/a%20b")).toEqual({ page: "portal", token: "a b" });
  });

  test("unknown shapes are not-found rather than a wrong page", () => {
    expect(parseRoute("/nope")).toEqual({ page: "not-found" });
    expect(parseRoute("/portal")).toEqual({ page: "not-found" });
    expect(parseRoute("/engagements/e1/review")).toEqual({ page: "not-found" });
    expect(parseRoute("/engagements/e1/review/d1/extra")).toEqual({ page: "not-found" });
    expect(parseRoute("/engagements/e1/unknown")).toEqual({ page: "not-found" });
    expect(parseRoute("/clients/c1/extra")).toEqual({ page: "not-found" });
    expect(parseRoute("/review")).toEqual({ page: "not-found" });
  });
});

describe("navIdForRoute", () => {
  test("engagement, review, and export all highlight the engagements group", () => {
    expect(navIdForRoute({ page: "engagements" })).toBe("engagements");
    expect(navIdForRoute({ page: "engagement", id: "e1" })).toBe("engagements");
    expect(navIdForRoute({ page: "review", engagementId: "e1", documentId: "d1" })).toBe(
      "engagements",
    );
    expect(navIdForRoute({ page: "export", engagementId: "e1" })).toBe("engagements");
  });

  test("client detail highlights clients, and chromeless routes highlight nothing", () => {
    expect(navIdForRoute({ page: "client", id: "c1" })).toBe("clients");
    expect(navIdForRoute({ page: "portal", token: "tok" })).toBeNull();
    expect(navIdForRoute({ page: "not-found" })).toBeNull();
  });
});
