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

/** The inbound anchors are leaf rows — no nested anchors — so a lazy match isolates one row. */
function rowFor(html: string, entryId: string): string {
  const match = html.match(
    new RegExp(`<a class="list-row inbox-row[^"]*"[^>]*data-entry-id="${entryId}"[^>]*>[\\s\\S]*?</a>`),
  );
  return match?.[0] ?? "";
}

describe("inbox page", () => {
  test("entries group under one client header row instead of repeating the name per row", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({
            id: "act-1",
            action: "document-uploaded",
            direction: "inbound",
            actor: "client",
            detail: "w2.pdf uploaded",
          }),
          entry({
            id: "act-2",
            action: "document-extracted",
            direction: "inbound",
            actor: "agent",
            documentId: "doc-1",
            detail: "w2.pdf — 12 fields extracted",
          }),
        ],
      }),
    );

    expect(html.match(/Northwind Partners LLC/g)?.length).toBe(1);
    expect(html).toMatch(
      /<a class="inbox-group-head" href="\/engagements\/eng-1" data-nav-link>Northwind Partners LLC<\/a>/,
    );
  });

  test("separate engagements get separate group headers", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({ id: "act-1", action: "document-uploaded", direction: "inbound" }),
          entry({
            id: "act-2",
            engagementId: "eng-2",
            clientName: "Acme Manufacturing",
            action: "document-uploaded",
            direction: "inbound",
          }),
        ],
      }),
    );

    expect(html.match(/class="inbox-group-head"/g)?.length).toBe(2);
    expect(html).toContain('href="/engagements/eng-1"');
    expect(html).toContain('href="/engagements/eng-2"');
    expect(html).toContain("Acme Manufacturing");
  });

  test("rows are dense single-line anchors with the unread marker inside the row", () => {
    const html = renderInbox(
      data({
        entries: [
          entry({
            id: "act-unread",
            action: "document-uploaded",
            direction: "inbound",
            actor: "client",
            detail: "w2.pdf uploaded",
            unread: true,
          }),
          entry({
            id: "act-read",
            action: "document-uploaded",
            direction: "inbound",
            actor: "client",
            detail: "k1.pdf uploaded",
            unread: false,
            readAt: "2026-08-19T19:00:00.000Z",
          }),
        ],
      }),
    );

    expect(html).not.toContain("inbox-entry-inbound");
    expect(html).not.toContain('<div class="inbox-entry');

    const unreadRow = rowFor(html, "act-unread");
    expect(unreadRow).toContain('class="list-row inbox-row is-unread"');
    expect(unreadRow).toContain('data-unread="true"');
    expect(unreadRow).toContain('<span class="unread-dot" aria-hidden="true"></span>');
    expect(unreadRow).toContain('data-icon="arrow-down-left"');
    expect(unreadRow).toContain('<span class="list-row-title">Client</span>');
    expect(unreadRow).toContain("w2.pdf uploaded");
    expect(unreadRow).toMatch(/<time class="muted inbox-time"[^>]*>2h ago<\/time>/);

    const readRow = rowFor(html, "act-read");
    expect(readRow).toContain('class="list-row inbox-row"');
    expect(readRow).not.toContain("is-unread");
    expect(readRow).not.toContain('data-unread="true"');
    expect(readRow).toContain('<span class="unread-dot" aria-hidden="true"></span>');
  });

  test("request-sent rows carry one compact portal control instead of a field and two buttons", () => {
    const html = renderInbox(
      data({
        entries: [entry({ id: "act-sent", action: "request-sent", direction: "outbound" })],
      }),
    );

    expect(html).toContain('<div class="list-row inbox-row inbox-row-outbound">');
    expect(html).not.toMatch(/<a[^>]*class="list-row inbox-row inbox-row-outbound"/);
    expect(html).toContain('data-icon="arrow-up-right"');
    expect(html).toContain("Request sent · 3 items");

    expect(html).toContain("data-portal-link-control");
    expect(html).toContain('data-copy-portal-link="/portal/portal-token-abc"');
    expect(html).toContain("Copy portal link");
    expect(html).toMatch(
      /<a class="portal-link-open" href="\/portal\/portal-token-abc" data-nav-link>Open<\/a>/,
    );

    expect(html).not.toContain("readonly");
    expect(html).not.toContain("search-field");
    expect(html).not.toContain("portal-link-row");
    expect(html).not.toContain("data-portal-open");
    expect(html).not.toContain("Open portal");
    expect(html).not.toContain("btn-secondary");
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
