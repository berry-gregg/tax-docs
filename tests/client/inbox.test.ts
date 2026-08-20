import { describe, expect, test } from "bun:test";
import { inboxPage, renderInbox, type InboxData } from "../../src/client/app/pages/inbox.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { inboxEntrySchema } from "../../src/shared/schemas/api.ts";

const now = new Date("2026-08-19T20:00:00.000Z");

function entry(overrides: Record<string, unknown> = {}) {
  return inboxEntrySchema.parse({
    id: "act-1",
    engagementId: "eng-1",
    actor: "cpa",
    action: "request-sent",
    detail: "3 items requested",
    direction: "outbound",
    createdAt: "2026-08-19T18:00:00.000Z",
    clientName: "Northwind Partners LLC",
    portalToken: "portal-token-abc",
    unread: false,
    ...overrides,
  });
}

function data(overrides: Partial<InboxData> = {}): InboxData {
  return { entries: [], now, ...overrides };
}

describe("inbox page", () => {
  test("request-sent entries use a non-navigating list-row with copy and open portal controls", () => {
    const html = renderInbox(
      data({
        entries: [entry({ id: "act-sent", action: "request-sent", direction: "outbound" })],
      }),
    );

    expect(html).toContain('class="list-row"');
    expect(html).not.toMatch(/<a[^>]*class="list-row"/);
    expect(html).not.toMatch(/<a class="list-row"[^>]*>[\s\S]*<(?:input|button|a)\b/);
    expect(html).not.toContain("inbox-entry-outbound");
    expect(html).toContain("Request sent · 3 items");
    expect(html).toContain('value="/portal/portal-token-abc"');
    expect(html).toContain('data-portal-open="/portal/portal-token-abc"');
    expect(html).toContain("Open portal");
    expect(html).toContain("Copy portal link");
    expect(html).toContain('data-copy-portal-link="/portal/portal-token-abc"');
    expect(html).toContain("readonly");
  });

  test("unread dot appears only on unread inbound entries", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({
            id: "act-unread",
            action: "document-uploaded",
            direction: "inbound",
            detail: "w2.pdf uploaded",
            unread: true,
          }),
          entry({
            id: "act-read",
            action: "document-uploaded",
            direction: "inbound",
            detail: "k1.pdf uploaded",
            unread: false,
            readAt: "2026-08-19T19:00:00.000Z",
          }),
        ],
      }),
    );

    const unreadRow = html.slice(html.indexOf("act-unread") - 200, html.indexOf("act-unread") + 200);
    const readRow = html.slice(html.indexOf("act-read") - 200, html.indexOf("act-read") + 200);

    expect(unreadRow).toContain('class="unread-dot"');
    expect(readRow).not.toContain('class="unread-dot"');
  });

  test("document-extracted entries deep-link via stored documentId, not activity id shape", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({
            id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            action: "document-extracted",
            direction: "inbound",
            documentId: "doc-1",
            detail: "northwind-w2.pdf — 12 fields extracted, 0 not found",
            unread: false,
          }),
        ],
      }),
    );

    expect(html).toContain('href="/engagements/eng-1/review/doc-1"');
    expect(html).not.toContain("/review/f47ac10b");
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("2h ago");
  });

  test("document entries without documentId fall back to the engagement workspace", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({
            id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            action: "document-extracted",
            direction: "inbound",
            detail: "orphan activity",
            unread: false,
          }),
        ],
      }),
    );

    expect(html).toContain('href="/engagements/eng-1"');
    expect(html).not.toContain("/review/");
  });

  test("header shows Inbox title and unread count", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({
            id: "act-a",
            action: "document-uploaded",
            direction: "inbound",
            unread: true,
          }),
          entry({
            id: "act-b",
            action: "document-extracted",
            direction: "inbound",
            unread: true,
          }),
        ],
      }),
    );

    expect(html).toContain("Inbox");
    expect(html).toContain('<span class="count">2</span>');
  });

  test("polls on the shared interval", () => {
    expect(inboxPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
