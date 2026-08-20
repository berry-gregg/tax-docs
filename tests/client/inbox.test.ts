import { afterEach, describe, expect, test } from "bun:test";
import {
  composeDrafts,
  inboxPage,
  inboxSelection,
  renderInbox,
  type InboxData,
} from "../../src/client/app/pages/inbox.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import {
  inboxDocumentSchema,
  inboxEventEntrySchema,
  inboxMessageEntrySchema,
  inboxThreadSchema,
  type InboxDocument,
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

function doc(overrides: Record<string, unknown> = {}): InboxDocument {
  return inboxDocumentSchema.parse({
    id: "doc-1",
    filename: "w2-final.pdf",
    pipelineStatus: "needs-review",
    createdAt: "2026-08-19T18:00:00.000Z",
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
    documents: [],
    ...overrides,
  });
}

function data(overrides: Partial<InboxData> = {}): InboxData {
  return { threads: [], now, ...overrides };
}

afterEach(() => {
  inboxSelection.threadId = null;
  composeDrafts.clear();
  globalThis.fetch = originalFetch;
});

type FakeEvent = { preventDefault(): void; key?: string; target?: unknown };

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

/**
 * The selection handler is delegated on the workspace root and walks `event.target.closest`.
 * This stands in for a click landing inside a thread row (not on a nested link/button).
 */
function rowTarget(row: FakeNode): { closest(selector: string): FakeNode | null } {
  return {
    closest(selector: string) {
      return selector === "[data-thread-row]" ? row : null;
    },
  };
}

function makeThreadRow(engagementId: string, unread: boolean): FakeNode {
  const row = new FakeNode();
  row.attributes.set("data-engagement-id", engagementId);
  if (unread) {
    row.attributes.set("data-unread", "true");
  }
  return row;
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

describe("inbox layout", () => {
  test("renders three columns inside one shell: thread list, conversation, files panel", () => {
    const html = renderInbox(data({ threads: [thread()] }));

    expect(html).toContain('class="page-inbox"');
    expect(html).toContain('class="inbox-shell"');
    const order = [
      html.indexOf('class="inbox-list"'),
      html.indexOf('class="inbox-convo"'),
      html.indexOf('class="inbox-files"'),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("no selection by default: quiet placeholder, no conversation, empty files panel", () => {
    const html = renderInbox(data({ threads: [thread({ timeline: [msg()], documents: [doc()] })] }));

    expect(html).toContain("Select a conversation");
    expect(html).not.toContain("data-conversation");
    expect(html).not.toContain("data-files-panel");
    expect(html).not.toContain("is-selected");
    expect(html).not.toContain("data-compose");
    // Documents stay out of the DOM until their thread is selected.
    expect(html).not.toContain("w2-final.pdf");
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

describe("inbox thread rows", () => {
  test("a row carries initials avatar, client name, latest preview, relative time, and unread badge", () => {
    const html = renderInbox(
      data({
        threads: [
          thread({
            unread: true,
            unreadCount: 2,
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

    expect(html).toContain('data-thread-row data-engagement-id="eng-1"');
    expect(html).toMatch(/class="inbox-row[^"]*is-unread/);
    expect(html).toContain('data-unread="true"');
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('<span class="avatar" aria-hidden="true">NP</span>');
    expect(html).toContain("Northwind Partners LLC");
    // Latest message wins the preview; the client's own words, no "You:" prefix.
    expect(html).toContain("Quick question — do you need Q4 bank statements too?");
    expect(html).toContain("2h ago");
    expect(html).toContain('<span class="badge inbox-row-badge">2</span>');
  });

  test("a read thread shows no badge and a cpa-latest preview reads You: and truncates", () => {
    const longBody = `We reviewed everything and ${"still need a few more documents ".repeat(5)}thanks.`;
    const html = renderInbox(
      data({
        threads: [
          thread({ timeline: [msg({ body: longBody, createdAt: "2026-08-19T18:00:00.000Z" })] }),
        ],
      }),
    );

    expect(html).not.toContain("inbox-row-badge");
    const preview = html.match(/inbox-row-preview">([^<]*)</)?.[1] ?? "";
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

  test("the selected thread's row is marked and survives repaints via module state", () => {
    inboxSelection.threadId = "eng-2";
    const html = renderInbox(
      data({
        threads: [
          thread(),
          thread({ engagementId: "eng-2", clientName: "Acme Manufacturing", portalToken: "portal-2" }),
        ],
      }),
    );

    const selected = html.match(/class="inbox-row[^"]*is-selected[^"]*"[^>]*data-engagement-id="([^"]+)"/);
    expect(selected?.[1]).toBe("eng-2");
    expect(html.match(/is-selected/g)).toHaveLength(1);
  });
});

describe("inbox conversation", () => {
  test("selection renders the header, cpa/client bubbles, and event system lines in order", () => {
    inboxSelection.threadId = "eng-1";
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

    // Header: client name, filing meta, and the shared portal control.
    expect(html).toContain('data-conversation data-engagement-id="eng-1"');
    expect(html).toMatch(/inbox-convo-name">Northwind Partners LLC</);
    expect(html).toMatch(/inbox-convo-meta">1120-S · 2026</);
    expect(html).toContain("data-portal-link-control");
    expect(html).toContain('data-copy-portal-link="/portal/portal-token-abc"');

    // Bubbles: outbound right (ink), inbound left (wash) — pinned by class, sender label shown.
    expect(html).toMatch(/class="inbox-msg inbox-msg-cpa"/);
    expect(html).toMatch(/class="inbox-msg inbox-msg-client"/);
    expect(html).toContain(">You<");
    expect(html).toMatch(/inbox-msg-client[\s\S]*?Northwind Partners LLC/);
    expect(html).toContain("Uploaded — let me know if anything is missing.");

    // Events are quiet centered system lines that deep-link their document.
    expect(html).toContain('class="inbox-event"');
    expect(html).toMatch(
      /<a class="inbox-event-link" href="\/documents\/doc-1" data-nav-link>Client uploaded w2-final\.pdf<\/a>/,
    );

    // Chronological within the timeline pane.
    const conversation = html.slice(html.indexOf('class="inbox-messages"'));
    const order = [
      conversation.indexOf("Request sent"),
      conversation.indexOf("we've opened your 2026"),
      conversation.indexOf("Client uploaded w2-final.pdf"),
      conversation.indexOf("Uploaded — let me know"),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a selected thread with no timeline says so quietly", () => {
    inboxSelection.threadId = "eng-1";
    const html = renderInbox(data({ threads: [thread()] }));

    expect(html).toContain("No messages on this engagement yet.");
  });

  test("a stale selection (thread gone) falls back to the placeholder", () => {
    inboxSelection.threadId = "eng-gone";
    const html = renderInbox(data({ threads: [thread()] }));

    expect(html).toContain("Select a conversation");
    expect(html).not.toContain("data-conversation");
  });

  test("message bodies are escaped, never injected as markup", () => {
    inboxSelection.threadId = "eng-1";
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

describe("inbox files panel", () => {
  test("selection renders the engagement summary, portal link, and document rows", () => {
    inboxSelection.threadId = "eng-1";
    const html = renderInbox(
      data({
        threads: [
          thread({
            documents: [
              doc(),
              doc({
                id: "doc-2",
                filename: "balance-sheet.pdf",
                pipelineStatus: "trusted",
                createdAt: "2026-08-19T12:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    expect(html).toContain("data-files-panel");
    expect(html).toMatch(/inbox-files-client">Northwind Partners LLC</);
    expect(html).toContain("1120-S · 2026");
    expect(html).toMatch(/<a [^>]*href="\/portal\/portal-token-abc" data-nav-link>Open portal<\/a>/);

    expect(html).toContain("Documents");
    expect(html).toMatch(
      /<a class="inbox-doc-name" href="\/documents\/doc-1" data-nav-link>w2-final\.pdf<\/a>/,
    );
    expect(html).toMatch(
      /<a class="inbox-doc-name" href="\/documents\/doc-2" data-nav-link>balance-sheet\.pdf<\/a>/,
    );
    // Status chips reuse the one pipeline vocabulary.
    expect(html).toContain('<span class="chip chip-warning">Needs review</span>');
    expect(html).toContain('<span class="chip chip-success">Trusted</span>');
    // Relative upload times: 2h and 8h before the fixed "now".
    expect(html).toContain("2h ago");
    expect(html).toContain("8h ago");
  });

  test("a selected thread with no documents says so", () => {
    inboxSelection.threadId = "eng-1";
    const html = renderInbox(data({ threads: [thread()] }));

    expect(html).toContain("data-files-panel");
    expect(html).toContain("No documents yet");
  });

  test("filenames are escaped", () => {
    inboxSelection.threadId = "eng-1";
    const html = renderInbox(
      data({
        threads: [thread({ documents: [doc({ filename: '<img src=x onerror="pwn">.pdf' })] })],
      }),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("inbox selection interaction", () => {
  test("clicking a thread row selects it, marks it read, and repaints", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    let repaints = 0;
    const { root } = makeInboxRoot();
    inboxPage.bind?.(root as unknown as HTMLElement, data(), () => {
      repaints += 1;
    });

    const row = makeThreadRow("eng-1", true);
    root.dispatch("click", { target: rowTarget(row) });

    expect(inboxSelection.threadId).toBe("eng-1");
    expect(repaints).toBe(1);
    await waitUntil(() => calls.length > 0);
    expect(calls).toEqual(["/api/inbox/threads/eng-1/read"]);
  });

  test("Enter selects a row; a read thread never fires the read POST", async () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    let repaints = 0;
    const { root } = makeInboxRoot();
    inboxPage.bind?.(root as unknown as HTMLElement, data(), () => {
      repaints += 1;
    });

    const row = makeThreadRow("eng-2", false);
    root.dispatch("keydown", { key: "Enter", target: rowTarget(row) });
    await Bun.sleep(0);

    expect(inboxSelection.threadId).toBe("eng-2");
    expect(repaints).toBe(1);
    expect(fetched).toBe(0);
  });
});

describe("inbox compose", () => {
  test("the selected thread renders a focus-preserving compose form with a Send button", () => {
    inboxSelection.threadId = "eng-1";
    const html = renderInbox(data({ threads: [thread({ timeline: [msg()] })] }));

    expect(html).toMatch(
      /<form class="inbox-compose" data-preserve-focus data-compose data-engagement-id="eng-1"/,
    );
    expect(html).toContain("data-compose-input");
    expect(html).toContain("data-compose-send");
    expect(html).toContain(">Send</button>");
  });

  test("drafts restore into the textarea across repaints, escaped", () => {
    inboxSelection.threadId = "eng-1";
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
