import { afterEach, describe, expect, test } from "bun:test";
import {
  composeDrafts,
  inboxPage,
  openThreadIds,
  renderInbox,
  type InboxData,
} from "../../src/client/app/pages/inbox.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import {
  inboxEventEntrySchema,
  inboxMessageEntrySchema,
  inboxThreadSchema,
  type InboxEventEntry,
  type InboxMessageEntry,
} from "../../src/shared/schemas/inbox.ts";

const now = new Date("2026-08-19T20:00:00.000Z");
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function msg(overrides: Record<string, unknown> = {}): InboxMessageEntry {
  return inboxMessageEntrySchema.parse({
    kind: "message",
    id: "msg-1",
    sender: "cpa",
    body: "Hi Maya — we've opened your 2026 1120-S engagement and requested 4 documents.",
    createdAt: "2026-08-19T16:00:00.000Z",
    ...overrides,
  });
}

function evt(overrides: Record<string, unknown> = {}): InboxEventEntry {
  return inboxEventEntrySchema.parse({
    kind: "event",
    id: "act-1",
    text: "Request sent",
    createdAt: "2026-08-19T15:00:00.000Z",
    ...overrides,
  });
}

function thread(overrides: Record<string, unknown> = {}) {
  return inboxThreadSchema.parse({
    engagementId: "eng-1",
    clientName: "Northwind Partners LLC",
    taxYear: 2026,
    filingType: "1120-S",
    portalToken: "portal-token-abc",
    unread: false,
    unreadCount: 0,
    timeline: [],
    ...overrides,
  });
}

function data(overrides: Partial<InboxData> = {}): InboxData {
  return { threads: [], now, ...overrides };
}

afterEach(() => {
  openThreadIds.clear();
  composeDrafts.clear();
  globalThis.fetch = originalFetch;
});

type FakeEvent = { preventDefault(): void; key?: string };

class FakeNode {
  hidden = false;
  textContent = "";
  value = "";
  disabled = false;
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(private readonly children: Record<string, FakeNode | FakeNode[]> = {}) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector: string): FakeNode | null {
    const child = this.children[selector];
    if (Array.isArray(child)) {
      return child[0] ?? null;
    }
    return child ?? null;
  }

  querySelectorAll(selector: string): FakeNode[] {
    const child = this.children[selector];
    if (child === undefined) {
      return [];
    }
    return Array.isArray(child) ? child : [child];
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, extra: Partial<FakeEvent> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault() {}, ...extra });
    }
  }
}

function makeInboxRoot() {
  const input = new FakeNode();
  const errorSlot = new FakeNode();
  errorSlot.hidden = true;
  const sendButton = new FakeNode();
  const form = new FakeNode({
    "[data-compose-input]": input,
    "[data-compose-error]": errorSlot,
    "[data-compose-send]": sendButton,
  });
  form.attributes.set("data-engagement-id", "eng-1");

  const root = new FakeNode({
    "[data-copy-portal-link]": [],
    "[data-compose]": form,
  });

  return { root, form, input, errorSlot, sendButton };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Bun.sleep(0);
  }
}

describe("inbox thread list", () => {
  test("thread row carries client, engagement label, latest message preview, time, and portal control", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            unread: true,
            unreadCount: 1,
            timeline: [
              msg(),
              msg({
                id: "msg-2",
                sender: "client",
                body: "Quick question — do you need Q4 bank statements too?",
                createdAt: "2026-08-19T18:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    expect(html).toContain('data-thread data-engagement-id="eng-1"');
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("1120-S · 2026");
    // Latest message wins the preview; the client's own words, no "You:" prefix.
    expect(html).toContain("Quick question — do you need Q4 bank statements too?");
    expect(html).toContain("2h ago");
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

  test("a cpa-latest preview reads You: and long previews truncate", () => {
    const longBody = `We reviewed everything and ${"still need a few more documents ".repeat(5)}thanks.`;
    const html = renderInbox(
      data({
        threads: [
          thread({ timeline: [msg({ body: longBody, createdAt: "2026-08-19T18:00:00.000Z" })] }),
        ],
      }),
    );

    const preview = html.match(/inbox-thread-preview">([^<]*)</)?.[1] ?? "";
    expect(preview).toStartWith("You: We reviewed everything and");
    expect(preview).toEndWith("…");
    expect(preview).not.toContain("thanks.");
  });

  test("an event-only thread previews the latest event line", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            timeline: [evt({ text: "Client uploaded w2-final.pdf", documentId: "doc-1" })],
          }),
        ],
      }),
    );

    expect(html).toContain("Client uploaded w2-final.pdf");
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
    expect(empty).toContain("No conversations yet");
  });

  test("polls on the shared interval", () => {
    expect(inboxPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});

describe("inbox conversation", () => {
  test("messages render as You/client rows and events as quiet system lines, in timeline order", () => {
    openThreadIds.add("eng-1");
    const html = renderInbox(
      data({
        threads: [
          thread({
            timeline: [
              evt({ id: "act-request", text: "Request sent", createdAt: "2026-08-19T15:00:00.000Z" }),
              msg({ id: "msg-cpa", createdAt: "2026-08-19T15:00:30.000Z" }),
              evt({
                id: "act-upload",
                text: "Client uploaded w2-final.pdf",
                documentId: "doc-1",
                createdAt: "2026-08-19T16:30:00.000Z",
              }),
              msg({
                id: "msg-client",
                sender: "client",
                body: "Uploaded — let me know if anything is missing.",
                createdAt: "2026-08-19T17:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    expect(html).toMatch(/class="inbox-msg inbox-msg-cpa"/);
    expect(html).toMatch(/class="inbox-msg inbox-msg-client"/);
    expect(html).toContain(">You<");
    // The client's messages are attributed to the client by name.
    expect(html).toMatch(/inbox-msg-client[\s\S]*?Northwind Partners LLC/);
    expect(html).toContain("Uploaded — let me know if anything is missing.");

    // Events are quiet single lines — no chips — and deep-link their document.
    expect(html).toContain('class="inbox-event"');
    expect(html).toMatch(
      /<a class="inbox-event-link" href="\/documents\/doc-1" data-nav-link>Client uploaded w2-final\.pdf<\/a>/,
    );
    expect(html).not.toContain("chip");

    // Chronological: request event, cpa message, upload event, client message. Scoped to the
    // conversation so the head preview (which repeats the latest message) cannot match first.
    const conversation = html.slice(html.indexOf('class="inbox-conversation"'));
    const order = [
      conversation.indexOf("Request sent"),
      conversation.indexOf("we've opened your 2026"),
      conversation.indexOf("Client uploaded w2-final.pdf"),
      conversation.indexOf("Uploaded — let me know"),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("message bodies are escaped, never injected as markup", () => {
    openThreadIds.add("eng-1");
    const html = renderInbox(
      data({
        threads: [
          thread({
            timeline: [msg({ sender: "client", body: '<script>alert("x")</script>' })],
          }),
        ],
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("inbox compose", () => {
  test("an open thread renders a focus-preserving compose form with a Send button", () => {
    openThreadIds.add("eng-1");
    const html = renderInbox(data({ threads: [thread({ timeline: [msg()] })] }));

    expect(html).toMatch(
      /<form class="inbox-compose" data-preserve-focus data-compose data-engagement-id="eng-1"/,
    );
    expect(html).toContain("data-compose-input");
    expect(html).toContain("data-compose-send");
    expect(html).toContain(">Send</button>");

    // Collapsed threads keep the form out of the accordion body only via [hidden]; the
    // markup still exists so a toggle needs no repaint.
    const collapsed = renderInbox(data({ threads: [thread({ timeline: [msg()] })] }));
    expect(collapsed).toContain("data-compose");
  });

  test("drafts restore into the textarea across repaints, escaped", () => {
    openThreadIds.add("eng-1");
    composeDrafts.set("eng-1", 'Draft with <script> & "quotes"');

    const html = renderInbox(data({ threads: [thread({ timeline: [msg()] })] }));

    expect(html).toContain('Draft with &lt;script&gt; &amp; &quot;quotes&quot;</textarea>');
  });

  test("typing stores a draft keyed by engagement", () => {
    const { root, input } = makeInboxRoot();
    inboxPage.bind?.(root as unknown as HTMLElement, data(), () => {});

    input.value = "Working on it";
    input.dispatch("input");

    expect(composeDrafts.get("eng-1")).toBe("Working on it");
  });

  test("send posts the message, clears the draft, and repaints from a fresh load", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return jsonResponse(
        {
          message: {
            id: "msg-new",
            engagementId: "eng-1",
            sender: "cpa",
            body: "We do — December statements please.",
            createdAt: "2026-08-19T19:00:00.000Z",
          },
        },
        201,
      );
    }) as typeof fetch;

    let repaints = 0;
    const { root, input } = makeInboxRoot();
    inboxPage.bind?.(root as unknown as HTMLElement, data(), () => {
      repaints += 1;
    });

    composeDrafts.set("eng-1", "We do — December statements please.");
    input.value = "We do — December statements please.";
    root.querySelector("[data-compose]")?.dispatch("submit");

    await waitUntil(() => repaints > 0);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/inbox/threads/eng-1/messages");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      body: "We do — December statements please.",
    });
    expect(composeDrafts.has("eng-1")).toBe(false);
    expect(input.value).toBe("");
    expect(repaints).toBe(1);
  });

  test("a blank message never posts", async () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const { root, input } = makeInboxRoot();
    inboxPage.bind?.(root as unknown as HTMLElement, data(), () => {});

    input.value = "   ";
    root.querySelector("[data-compose]")?.dispatch("submit");
    await Bun.sleep(0);

    expect(fetched).toBe(0);
  });

  test("a send failure surfaces the server's message verbatim and keeps the draft", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "Not found" }, 404)) as unknown as typeof fetch;

    const { root, input, errorSlot, sendButton } = makeInboxRoot();
    inboxPage.bind?.(root as unknown as HTMLElement, data(), () => {});

    composeDrafts.set("eng-1", "Hello?");
    input.value = "Hello?";
    root.querySelector("[data-compose]")?.dispatch("submit");

    await waitUntil(() => !errorSlot.hidden);

    expect(errorSlot.textContent).toBe("Not found");
    expect(errorSlot.hidden).toBe(false);
    expect(sendButton.disabled).toBe(false);
    expect(composeDrafts.get("eng-1")).toBe("Hello?");
    expect(input.value).toBe("Hello?");
  });
});
