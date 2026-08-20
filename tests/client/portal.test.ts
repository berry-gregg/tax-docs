import { afterEach, describe, expect, test } from "bun:test";
import { ApiError } from "../../src/client/app/api.ts";
import { portalPage, renderPortal, type PortalData } from "../../src/client/app/pages/portal.ts";
import { FIRM_NAME, POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { portalStateSchema, type PortalState } from "../../src/shared/schemas/api.ts";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function portalState(overrides: Partial<PortalState> = {}): PortalState {
  return portalStateSchema.parse({
    firmName: FIRM_NAME,
    clientName: "Northwind Partners LLC",
    taxYear: 2025,
    filingType: "1120-S",
    items: [
      {
        id: "item-wait",
        title: "2025 W-2s",
        description: "Every W-2 issued by the entity.",
        required: true,
        portalStatus: "waiting",
      },
      {
        id: "item-proc",
        title: "Trial balance",
        description: "Year-end trial balance.",
        required: true,
        portalStatus: "processing",
      },
      {
        id: "item-recv",
        title: "Balance sheet",
        description: "Year-end balance sheet.",
        required: true,
        portalStatus: "received",
      },
      {
        id: "item-attn",
        title: "Bank statements",
        description: "December closing statements.",
        required: false,
        portalStatus: "needs-attention",
      },
    ],
    ...overrides,
  });
}

function validData(state: PortalState = portalState(), token = "portal-tok"): PortalData {
  return { kind: "valid", token, state };
}

describe("portal page", () => {
  test("intro line names the firm, client, year, and filing type", () => {
    const html = renderPortal(validData());

    expect(html).toContain(FIRM_NAME);
    expect(html).toContain(
      `${FIRM_NAME} requested the following for Northwind Partners LLC's 2025 1120-S filing`,
    );
  });

  test("waiting items render an item-scoped dropzone", () => {
    const html = renderPortal(validData());

    expect(html).toContain('data-request-item-id="item-wait"');
    expect(html).toContain('data-portal-dropzone');
    expect(html).toContain('accept="application/pdf,.pdf"');
  });

  test("processing items render an ash spinner and Processing copy", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-spinner");
    expect(html).toContain("Processing…");
  });

  test("received items render a success check and Received copy", () => {
    const html = renderPortal(validData());

    expect(html).toContain('data-icon="check"');
    expect(html).toContain("Received");
    expect(html).toContain("portal-status-received");
  });

  test("needs-attention items stay coarse with warning tone only", () => {
    const html = renderPortal(validData());

    expect(html).toContain('data-icon="alert-triangle"');
    expect(html).toContain("Needs attention — we'll follow up shortly");
    expect(html).toContain("portal-status-attention");
    expect(html).not.toContain("rejected");
    expect(html).not.toContain("reason");
  });

  test("renders a general dropzone without a request item id", () => {
    const html = renderPortal(validData());

    expect(html).toContain("Something else to send?");
    expect(html).toContain('data-portal-dropzone="general"');
    expect(html).not.toContain('data-request-item-id=""');
  });

  test("never surfaces confidence or extraction strings in rendered HTML", () => {
    const html = renderPortal(
      validData(
        portalState({
          items: [
            {
              id: "item-1",
              title: "Profit and loss",
              description: "Year-end P&amp;L.",
              required: true,
              portalStatus: "waiting",
            },
          ],
        }),
      ),
    );

    expect(html.toLowerCase()).not.toContain("confidence");
    expect(html.toLowerCase()).not.toContain("extraction");
  });

  test("invalid token renders the plain expired-link page", () => {
    const html = renderPortal({ kind: "invalid" });

    expect(html).toContain("This link is no longer valid");
    expect(html).not.toContain("load-error");
    expect(html).not.toContain("Retry");
  });

  test("load maps a 404 ApiError to the invalid-token state", async () => {
    globalThis.fetch = ((() =>
      Promise.resolve(jsonResponse({ error: "Not found" }, 404))) as unknown) as typeof fetch;

    const data = await portalPage.load({ page: "portal", token: "missing" });

    expect(data).toEqual({ kind: "invalid" });
  });

  test("load rethrows non-404 ApiError for the shell load-error path", async () => {
    globalThis.fetch = ((() =>
      Promise.resolve(jsonResponse({ error: "Server exploded" }, 500))) as unknown) as typeof fetch;

    const error = await portalPage
      .load({ page: "portal", token: "tok" })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  test("polls on the shared interval", () => {
    expect(portalPage.pollMs).toBe(POLL_INTERVAL_MS);
  });

  test("client-facing copy is escaped, not injected", () => {
    const html = renderPortal(
      validData(
        portalState({
          clientName: '<img onerror="x">',
          items: [
            {
              id: "item-x",
              title: "<script>title</script>",
              description: "<script>desc</script>",
              required: true,
              portalStatus: "waiting",
            },
          ],
        }),
      ),
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;title&lt;/script&gt;");
  });

  test("uses product chrome only — no marketing band or highlighter", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-card");
    expect(html).not.toContain("surface-inverted");
    expect(html).not.toContain("highlighter");
    expect(html).not.toContain("#e4f222");
    expect(html).not.toMatch(/text-transform:\s*uppercase/i);
  });
});
