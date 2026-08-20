import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError } from "../../src/client/app/api.ts";
import {
  portalPage,
  renderPortal,
  resetPortalViewState,
  type PortalData,
} from "../../src/client/app/pages/portal.ts";
import { FIRM_NAME, POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { portalStateSchema, type PortalState } from "../../src/shared/schemas/api.ts";
import type { TaxDocument } from "../../src/shared/schemas/document.ts";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetPortalViewState();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function uploadedDocument(id: string, filename: string): TaxDocument {
  return {
    id,
    engagementId: "eng-1",
    filename,
    mimeType: "application/pdf",
    size: 40,
    storagePath: `data/uploads/${id}.pdf`,
    uploadedBy: "client",
    pipelineStatus: "received",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function portalState(overrides: Partial<PortalState> = {}): PortalState {
  return portalStateSchema.parse({
    firmName: FIRM_NAME,
    clientName: "Northwind Partners LLC",
    taxYear: 2025,
    filingType: "1120-S",
    items: [
      {
        id: "item-open",
        title: "2025 W-2s",
        description: "Every W-2 issued by the entity.",
        required: true,
        portalStatus: "waiting",
        status: "open",
        documents: [],
      },
      {
        id: "item-proc",
        title: "Trial balance",
        description: "Year-end trial balance.",
        required: true,
        portalStatus: "processing",
        status: "open",
        documents: [
          {
            id: "doc-proc",
            filename: "tb.pdf",
            pipelineStatus: "classifying",
            documentTypeName: null,
            uploadedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
      {
        id: "item-recv",
        title: "Balance sheet",
        description: "Year-end balance sheet.",
        required: true,
        portalStatus: "received",
        status: "received",
        documents: [
          {
            id: "doc-1",
            filename: "balance-sheet.pdf",
            pipelineStatus: "needs-review",
            documentTypeName: "Balance sheet",
            uploadedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
      {
        id: "item-attn",
        title: "Bank statements",
        description: "December closing statements.",
        required: false,
        portalStatus: "needs-attention",
        status: "needs-attention",
        documents: [],
      },
      {
        id: "item-waived",
        title: "Payroll reports",
        description: "Quarterly payroll filings.",
        required: false,
        portalStatus: "waiting",
        status: "waived",
        waiveNote: "Sold the business",
        documents: [],
      },
    ],
    unmatched: [
      {
        id: "doc-un-1",
        filename: "mystery.pdf",
        pipelineStatus: "extracting",
        documentTypeName: null,
        uploadedAt: "2026-04-02T00:00:00.000Z",
      },
      {
        id: "doc-un-2",
        filename: "lease.pdf",
        pipelineStatus: "rejected",
        documentTypeName: null,
        uploadedAt: "2026-04-03T00:00:00.000Z",
      },
    ],
    ...overrides,
  });
}

function validData(state: PortalState = portalState(), token = "portal-tok"): PortalData {
  return { kind: "valid", token, state };
}

type FakeEvent = { preventDefault(): void; key?: string };

class FakePortalNode {
  hidden = false;
  open = false;
  textContent = "";
  value = "";
  innerHTML = "";
  disabled = false;
  files: File[] = [];
  clicks = 0;
  readonly attributes = new Map<string, string>();
  readonly classList = { add() {}, remove() {} };
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(private readonly children: Record<string, FakePortalNode | FakePortalNode[]> = {}) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  click(): void {
    this.clicks += 1;
    this.dispatch("click");
  }

  focus(): void {}

  querySelector(selector: string): FakePortalNode | null {
    const child = this.children[selector];
    if (Array.isArray(child)) {
      return child[0] ?? null;
    }
    return child ?? null;
  }

  querySelectorAll(selector: string): FakePortalNode[] {
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Bun.sleep(0);
  }
}

function makePortalRoot() {
  const fileInput = new FakePortalNode();
  const dropzone = new FakePortalNode({ "[data-portal-file]": fileInput });
  const uploads = new FakePortalNode();
  const errorSlot = new FakePortalNode();
  errorSlot.hidden = true;

  const waiveForm = new FakePortalNode({
    "[data-portal-waive-note]": new FakePortalNode(),
    "[data-portal-waive-cancel]": new FakePortalNode(),
  });
  waiveForm.hidden = true;
  waiveForm.attributes.set("data-portal-waive-form", "item-open");
  const waiveToggle = new FakePortalNode();
  waiveToggle.attributes.set("data-portal-waive", "item-open");

  const docsPanel = new FakePortalNode();
  docsPanel.attributes.set("data-portal-docs", "item-recv");

  const root = new FakePortalNode({
    "[data-portal-dropzone]": dropzone,
    "[data-portal-uploads]": uploads,
    "[data-portal-error]": errorSlot,
    "[data-portal-waive]": [waiveToggle],
    '[data-portal-waive-form="item-open"]': waiveForm,
    "[data-portal-docs]": [docsPanel],
  });

  return Object.assign(root, {
    fileInput,
    dropzone,
    uploads,
    errorSlot,
    waiveForm,
    waiveToggle,
    docsPanel,
    noteInput: waiveForm.querySelector("[data-portal-waive-note]") as FakePortalNode,
    cancelButton: waiveForm.querySelector("[data-portal-waive-cancel]") as FakePortalNode,
  });
}

describe("portal layout", () => {
  test("intro line names the firm, client, year, and filing type", () => {
    const html = renderPortal(validData());

    expect(html).toContain(FIRM_NAME);
    expect(html).toContain(
      `${FIRM_NAME} requested the following for Northwind Partners LLC's 2025 1120-S filing`,
    );
  });

  test("checklist sits in a left column beside one common drop zone", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-layout");
    expect(html).toContain("portal-checklist");
    expect(html).toContain("portal-main");
    expect(html.split("data-portal-dropzone").length - 1).toBe(1);
    expect(html).toContain('accept="application/pdf,.pdf"');
    expect(html).toContain("multiple");
  });

  test("no per-item dropzones or request item upload params remain", () => {
    const html = renderPortal(validData());

    expect(html).not.toContain("data-request-item-id");
    expect(html.split("data-portal-file").length - 1).toBe(1);
  });

  test("invalid token renders the plain expired-link page", () => {
    const html = renderPortal({ kind: "invalid" });

    expect(html).toContain("This link is no longer valid");
    expect(html).not.toContain("load-error");
    expect(html).not.toContain("Retry");
  });

  test("keeps a hidden in-page slot for request failures", () => {
    const html = renderPortal(validData());

    expect(html).toContain("data-portal-error");
    expect(html).toMatch(/data-portal-error[^>]*hidden|hidden[^>]*data-portal-error/);
  });
});

describe("portal checklist items", () => {
  test("received items render a check mark", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-mark-received");
    expect(html).toContain('data-icon="check"');
  });

  test("waived items render a muted mark and the note, with no waive control", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-mark-waived");
    expect(html).toContain("Not needed — Sold the business");
    expect(html).not.toContain('data-portal-waive="item-waived"');
  });

  test("needs-attention items render a warning mark and stay coarse", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-mark-attention");
    expect(html).toContain('data-icon="alert-triangle"');
    expect(html).not.toContain("rejected");
    expect(html).not.toContain("reason");
  });

  test("open items render an open circle mark and required marker", () => {
    const html = renderPortal(validData());

    expect(html).toContain("portal-mark-open");
    expect(html).toContain("Required");
  });

  test("matched documents nest in a collapsible section with a view link", () => {
    const html = renderPortal(validData());

    expect(html).toContain('<details class="portal-item-docs" data-portal-docs="item-recv"');
    expect(html).toContain("balance-sheet.pdf");
    expect(html).toContain('href="/api/portal/portal-tok/documents/doc-1/file"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
  });

  test("nested document status uses client-facing chip labels, never internal ones", () => {
    const html = renderPortal(validData());

    // needs-review is CPA work, not a client concern — it reads as done.
    expect(html).toContain("chip-success");
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Trusted");
    expect(html).toContain(">Classifying<");
  });

  test("collapsible open state survives a re-render", () => {
    const data = validData();
    expect(renderPortal(data)).not.toMatch(/data-portal-docs="item-recv"[^>]*\sopen/);

    const root = makePortalRoot();
    portalPage.bind?.(root as unknown as HTMLElement, data, () => {});
    root.docsPanel.open = true;
    root.docsPanel.dispatch("toggle");

    expect(renderPortal(data)).toMatch(/data-portal-docs="item-recv"[^>]*\sopen/);

    root.docsPanel.open = false;
    root.docsPanel.dispatch("toggle");
    expect(renderPortal(data)).not.toMatch(/data-portal-docs="item-recv"[^>]*\sopen/);
  });
});

describe("portal waive", () => {
  test("open items render a quiet waive control with a hidden note form", () => {
    const html = renderPortal(validData());

    expect(html).toContain('data-portal-waive="item-open"');
    expect(html).toContain("Not needed?");
    expect(html).toContain('data-portal-waive-form="item-open"');
    expect(html).toContain("data-portal-waive-note");
    expect(html).toContain('maxlength="500"');
    expect(html).toContain("data-portal-waive-cancel");
    expect(html).toMatch(/data-portal-waive-form="item-open"[^>]*hidden/);
  });

  test("submitting the note posts to the waive endpoint and hides the form", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return jsonResponse({
        item: {
          id: "item-open",
          title: "2025 W-2s",
          description: "Every W-2 issued by the entity.",
          required: true,
          portalStatus: "waiting",
          status: "waived",
          waiveNote: "No employees this year",
          documents: [],
        },
      });
    }) as typeof fetch;

    const root = makePortalRoot();
    portalPage.bind?.(root as unknown as HTMLElement, validData(), () => {});

    root.waiveToggle.dispatch("click");
    expect(root.waiveForm.hidden).toBe(false);

    root.noteInput.value = "No employees this year";
    root.noteInput.dispatch("input");
    root.waiveForm.dispatch("submit");

    await waitUntil(() => root.waiveForm.hidden);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/portal/portal-tok/items/item-open/waive");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ note: "No employees this year" });
    expect(root.waiveForm.hidden).toBe(true);
  });

  test("cancel hides the form without a request", () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const root = makePortalRoot();
    portalPage.bind?.(root as unknown as HTMLElement, validData(), () => {});

    root.waiveToggle.dispatch("click");
    expect(root.waiveForm.hidden).toBe(false);

    root.cancelButton.dispatch("click");
    expect(root.waiveForm.hidden).toBe(true);
    expect(fetched).toBe(0);
  });

  test("escape in the note input cancels", () => {
    const root = makePortalRoot();
    portalPage.bind?.(root as unknown as HTMLElement, validData(), () => {});

    root.waiveToggle.dispatch("click");
    root.noteInput.dispatch("keydown", { key: "Escape" });

    expect(root.waiveForm.hidden).toBe(true);
  });

  test("a waive failure surfaces the server's message in the error slot", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { error: 'Item is not open — current status is "received"' },
        409,
      )) as unknown as typeof fetch;

    const root = makePortalRoot();
    portalPage.bind?.(root as unknown as HTMLElement, validData(), () => {});

    root.waiveToggle.dispatch("click");
    root.waiveForm.dispatch("submit");

    await waitUntil(() => !root.errorSlot.hidden);

    expect(root.errorSlot.hidden).toBe(false);
    expect(root.errorSlot.textContent).toBe('Item is not open — current status is "received"');
  });
});

describe("portal uploads", () => {
  test("unmatched uploads render as status rows with stage chips", () => {
    const html = renderPortal(validData());

    expect(html).toContain("data-portal-uploads");
    expect(html).toContain("mystery.pdf");
    expect(html).toContain(">Extracting<");
    expect(html).toContain("lease.pdf");
    expect(html).toContain(">Needs attention<");
  });

  test("rejected uploads carry an honest warning message", () => {
    const html = renderPortal(validData());

    expect(html).toContain("We couldn't accept this file");
  });

  test("dropped files upload sequentially and show an optimistic uploading row", async () => {
    const calls: string[] = [];
    let served = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      served += 1;
      return jsonResponse({ document: uploadedDocument(`doc-new-${served}`, `file-${served}.pdf`) }, 201);
    }) as typeof fetch;

    const root = makePortalRoot();
    portalPage.bind?.(root as unknown as HTMLElement, validData(), () => {});

    root.fileInput.files = [
      new File(["%PDF"], "w2-a.pdf", { type: "application/pdf" }),
      new File(["%PDF"], "w2-b.pdf", { type: "application/pdf" }),
    ];
    root.fileInput.dispatch("change");

    expect(root.uploads.innerHTML).toContain("w2-a.pdf");
    expect(root.uploads.innerHTML).toContain("Uploading");

    await waitUntil(() => calls.length === 2);

    expect(calls).toEqual([
      "/api/portal/portal-tok/upload",
      "/api/portal/portal-tok/upload",
    ]);
    await waitUntil(() => !root.uploads.innerHTML.includes("Uploading"));
    expect(root.uploads.innerHTML).toContain("w2-a.pdf");
    expect(root.uploads.innerHTML).toContain("w2-b.pdf");
  });

  test("an upload failure keeps the row with the server's own message and no dialog", async () => {
    const alerts: string[] = [];
    const originalAlert = globalThis.alert;
    globalThis.alert = ((message: string) => {
      alerts.push(String(message));
    }) as typeof alert;

    try {
      globalThis.fetch = (async () =>
        jsonResponse({ error: "Upload must be a PDF" }, 400)) as unknown as typeof fetch;

      const root = makePortalRoot();
      portalPage.bind?.(root as unknown as HTMLElement, validData(), () => {});

      root.fileInput.files = [new File(["%PDF"], "notes.txt", { type: "text/plain" })];
      root.fileInput.dispatch("change");

      await waitUntil(() => root.uploads.innerHTML.includes("Upload must be a PDF"));

      expect(alerts).toEqual([]);
      expect(root.uploads.innerHTML).toContain("notes.txt");
      expect(root.uploads.innerHTML).toContain("Upload must be a PDF");
    } finally {
      globalThis.alert = originalAlert;
    }
  });
});

describe("portal page module", () => {
  test("load maps a 404 ApiError to the invalid-token state", async () => {
    globalThis.fetch = ((() =>
      Promise.resolve(jsonResponse({ error: "Not found" }, 404))) as unknown) as typeof fetch;

    const data = await portalPage.load({ page: "portal", token: "missing" });

    expect(data).toEqual({ kind: "invalid" });
  });

  test("load maps a 403 ApiError to the same invalid-token state as 404", async () => {
    globalThis.fetch = ((() =>
      Promise.resolve(jsonResponse({ error: "Forbidden" }, 403))) as unknown) as typeof fetch;

    const data = await portalPage.load({ page: "portal", token: "forbidden" });

    expect(data).toEqual({ kind: "invalid" });
  });

  test("load rethrows non-404/403 ApiError for the shell load-error path", async () => {
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

  test("never surfaces confidence or extraction strings in rendered HTML", () => {
    const html = renderPortal(validData());

    expect(html.toLowerCase()).not.toContain("confidence");
    expect(html.toLowerCase()).not.toContain("extraction");
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
              status: "waived",
              waiveNote: '<script>note</script>',
              documents: [
                {
                  id: "doc-x",
                  filename: '<script>file</script>.pdf',
                  pipelineStatus: "received",
                  documentTypeName: null,
                  uploadedAt: "2026-04-01T00:00:00.000Z",
                },
              ],
            },
          ],
          unmatched: [],
        }),
      ),
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;title&lt;/script&gt;");
  });

  test("uses product chrome only — no marketing band, highlighter, or uppercase", () => {
    const html = renderPortal(validData());

    expect(html).not.toContain("surface-inverted");
    expect(html).not.toContain("highlighter");
    expect(html).not.toContain("#e4f222");
    expect(html).not.toMatch(/text-transform:\s*uppercase/i);
  });
});
