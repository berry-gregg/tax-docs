import { afterEach, describe, expect, test } from "bun:test";
import {
  inboxPage,
  openThreadIds,
  renderInbox,
  type InboxData,
} from "../../src/client/app/pages/inbox.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import {
  inboxThreadItemSchema,
  inboxThreadSchema,
  type InboxThreadItem,
} from "../../src/shared/schemas/inbox.ts";

const now = new Date("2026-08-19T20:00:00.000Z");

function item(overrides: Record<string, unknown> = {}): InboxThreadItem {
  return inboxThreadItemSchema.parse({
    id: "item-1",
    title: "W-2 forms",
    status: "open",
    lastUpdateAt: "2026-08-19T18:00:00.000Z",
    ...overrides,
  });
}

function thread(overrides: Record<string, unknown> = {}) {
  return inboxThreadSchema.parse({
    engagementId: "eng-1",
    clientName: "Northwind Partners LLC",
    engagementLabel: "1120-S · 2026",
    portalToken: "portal-token-abc",
    requestSentAt: "2026-08-19T18:00:00.000Z",
    unread: false,
    unreadCount: 0,
    items: [],
    ...overrides,
  });
}

function data(overrides: Partial<InboxData> = {}): InboxData {
  return { threads: [], now, ...overrides };
}

afterEach(() => {
  openThreadIds.clear();
});

describe("inbox thread page", () => {
  test("thread header carries client, engagement label, request summary, and portal control", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            unread: true,
            unreadCount: 2,
            items: [
              item({ id: "item-1", status: "received", documentFilename: "w2-final.pdf", documentId: "doc-1" }),
              item({ id: "item-2", title: "Balance sheet", status: "open" }),
              item({ id: "item-3", title: "Bank statements", status: "open" }),
            ],
          }),
        ],
      }),
    );

    expect(html).toContain('data-thread data-engagement-id="eng-1"');
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("1120-S · 2026");
    expect(html).toContain("Request sent 2h ago · 1 of 3 items received");
    expect(html).toContain('<span class="unread-dot" aria-hidden="true"></span>');
    expect(html).toContain('data-unread="true"');
    expect(html).toMatch(/class="inbox-thread-head[^"]*is-unread/);
    expect(html).toContain('data-icon="chevron-down"');

    // The one shared portal control recipe, not a forked field + buttons.
    expect(html).toContain("data-portal-link-control");
    expect(html).toContain('data-copy-portal-link="/portal/portal-token-abc"');
    expect(html).toMatch(
      /<a class="portal-link-open" href="\/portal\/portal-token-abc" data-nav-link>Open<\/a>/,
    );
  });

  test("collapsed by default; openThreadIds drives expanded markup across repaints", () => {
    const collapsed = renderInbox(data({ threads: [thread()] }));
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toMatch(/<div class="inbox-thread-body" data-thread-body hidden>/);
    expect(collapsed).not.toContain("is-open");

    openThreadIds.add("eng-1");
    const expanded = renderInbox(data({ threads: [thread()] }));
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toMatch(/<div class="inbox-thread-body" data-thread-body>/);
    expect(expanded).toMatch(/class="inbox-thread[^"]*is-open/);
  });

  test("one line per request item — multiple uploads on one item never add rows", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            items: [
              // Two files were uploaded against this item; the thread still shows one line.
              item({ id: "item-1", status: "received", documentId: "doc-2", documentFilename: "w2-final.pdf" }),
              item({ id: "item-2", title: "Balance sheet", status: "open" }),
            ],
          }),
        ],
      }),
    );

    expect(html.match(/inbox-item-row/g)?.length).toBe(2);
    expect(html.match(/w2-final\.pdf/g)?.length).toBe(1);
    expect(html).not.toContain("document-uploaded");
    expect(html).toContain("Received · w2-final.pdf");
  });

  test("item lines render status chips, waive notes, and phrases from the shared chip recipe", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            items: [
              item({ id: "item-open", title: "Bank statements", status: "open" }),
              item({
                id: "item-waived",
                title: "Vehicle log",
                status: "waived",
                waiveNote: "Sold the truck in March",
              }),
              item({
                id: "item-attn",
                title: "Balance sheet",
                status: "needs-attention",
                documentId: "doc-bs",
                documentFilename: "balance-sheet.pdf",
              }),
            ],
          }),
        ],
      }),
    );

    expect(html).toContain('<span class="chip chip-processing">Open</span>');
    expect(html).toContain('<span class="chip chip-processing">Waived</span>');
    expect(html).toContain('<span class="chip chip-warning">Needs attention</span>');
    expect(html).toContain("Waived by client — Sold the truck in March");
    expect(html).toContain("Needs attention · balance-sheet.pdf");
    expect(html).toContain("Waiting on client");
  });

  test("items order needs-attention, received, open, waived regardless of payload order", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            items: [
              item({ id: "i-waived", title: "Waived item", status: "waived" }),
              item({ id: "i-open", title: "Open item", status: "open" }),
              item({ id: "i-received", title: "Received item", status: "received" }),
              item({ id: "i-attn", title: "Attention item", status: "needs-attention" }),
            ],
          }),
        ],
      }),
    );

    const order = ["Attention item", "Received item", "Open item", "Waived item"].map((title) =>
      html.indexOf(title),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("items with a document deep-link to /documents/:id; items without stay plain rows", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            items: [
              item({ id: "item-1", status: "received", documentId: "doc-1", documentFilename: "w2.pdf" }),
              item({ id: "item-2", title: "Balance sheet", status: "open" }),
            ],
          }),
        ],
      }),
    );

    expect(html).toMatch(/<a class="inbox-item-row" href="\/documents\/doc-1" data-nav-link>/);
    expect(html).not.toContain("/review/");
    expect(html).toMatch(/<div class="inbox-item-row">/);
  });

  test("thread footer reports the engine send when one happened", () => {
    const withEngine = renderInbox(
      data({
        threads: [thread({ sentToEngineAt: "2026-08-19T18:00:00.000Z" })],
      }),
    );
    expect(withEngine).toContain("Sent to tax engine 2h ago");

    const withoutEngine = renderInbox(data({ threads: [thread()] }));
    expect(withoutEngine).not.toContain("Sent to tax engine");
  });

  test("page header counts unread threads and the empty state is honest", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({ unread: true, unreadCount: 3 }),
          thread({ engagementId: "eng-2", clientName: "Acme Manufacturing", portalToken: "portal-2" }),
        ],
      }),
    );
    expect(html).toContain("Inbox");
    expect(html).toContain('<span class="count">1</span>');

    const empty = renderInbox(data());
    expect(empty).toContain("No document requests yet");
  });

  test("polls on the shared interval", () => {
    expect(inboxPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
