import { describe, expect, test } from "bun:test";
import { exportPage, renderExport, type ExportData } from "../../src/client/app/pages/export.ts";
import { exportSchema } from "../../src/shared/schemas/export.ts";

const iso = "2026-08-19T18:00:00.000Z";

const draftExport = exportSchema.parse({
  id: "exp-1",
  engagementId: "eng-1",
  status: "draft",
  lines: [
    {
      engineForm: "Form 1120-S",
      lineId: "8",
      lineLabel: "Salaries and wages",
      value: 512000,
      sourceRefs: [{ documentId: "doc-pl", fieldKey: "salaries_wages" }],
    },
    {
      engineForm: "Form 1120-S",
      lineId: "11",
      lineLabel: "Rents",
      value: null,
      sourceRefs: [],
    },
  ],
  createdAt: iso,
  payloadJson: "{}",
});

const sentExport = exportSchema.parse({
  ...draftExport,
  status: "sent",
  confirmedAt: "2026-08-19T19:00:00.000Z",
});

function data(overrides: Partial<ExportData> = {}): ExportData {
  return {
    engagementId: "eng-1",
    clientName: "Northwind Partners LLC",
    taxYear: 2025,
    filingType: "1120-S",
    export: draftExport,
    blocked: null,
    needsBuild: false,
    ...overrides,
  };
}

const filledExport = exportSchema.parse({
  ...draftExport,
  id: "exp-filled",
  lines: draftExport.lines.map((line) =>
    line.value === null
      ? { ...line, value: 12000, sourceRefs: [{ documentId: "doc-pl", fieldKey: "rents" }] }
      : line,
  ),
});

function engagementDetail() {
  return {
    engagement: {
      id: "eng-1",
      clientId: "client-1",
      taxYear: 2025,
      filingType: "1120-S",
      status: "in-review",
      portalToken: "portal-token",
      createdAt: iso,
      updatedAt: iso,
    },
    client: {
      id: "client-1",
      legalName: "Northwind Partners LLC",
      entityType: "s-corp",
      ein: "12-3456789",
      contactName: "Nora North",
      contactEmail: "nora@example.com",
      city: "Denver",
      state: "CO",
      createdAt: iso,
    },
    requestItems: [],
    documents: [],
    activity: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class FakeExportNode {
  hidden = true;
  textContent = "";
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(
    readonly selector: string,
    private readonly children: Record<string, FakeExportNode> = {},
  ) {}

  querySelector(selector: string): FakeExportNode | null {
    return this.children[selector] ?? null;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Bun.sleep(0);
  }
}

function makeExportRoot() {
  const confirmButton = new FakeExportNode("[data-export-confirm]");
  const errorSlot = new FakeExportNode("[data-export-error]");
  const modal = new FakeExportNode("[data-export-confirm-modal]");
  const openButton = new FakeExportNode("[data-export-open]");
  const cancelButton = new FakeExportNode("[data-export-cancel]");
  const root = new FakeExportNode("root", {
    "[data-export-confirm-modal]": modal,
    "[data-export-open]": openButton,
    "[data-export-cancel]": cancelButton,
    "[data-export-confirm]": confirmButton,
    "[data-export-error]": errorSlot,
  });

  return Object.assign(root, { confirmButton, errorSlot });
}

describe("export page", () => {
  test("line rows format money and show missing trusted-source state", () => {
    const html = renderExport(data());

    expect(html).toContain("$512,000.00");
    expect(html).toContain("Missing — no trusted source");
    expect(html).toContain("Salaries and wages");
    expect(html).toContain("Rents");
    expect(html).toContain("Form 1120-S");
  });

  test("source refs link to each document review page", () => {
    const html = renderExport(data());

    expect(html).toContain('href="/engagements/eng-1/review/doc-pl"');
    expect(html).toContain("salaries_wages");
  });

  test("confirm modal copy includes human confirmation and line count context", () => {
    const html = renderExport(data());

    expect(html).toContain("human confirmation");
    expect(html).toContain("This sends 2 line items for Northwind Partners LLC 2025 1120-S to the tax engine");
    expect(html).toContain("nothing has been sent yet");
    expect(html).toContain("Confirm &amp; send to tax engine");
  });

  test("confirm copy and table warn when lines have no trusted source, without blocking send", () => {
    const html = renderExport(data());

    expect(html).toContain("1 of 2 lines have no trusted source");
    expect(html).toContain("data-export-missing");
    expect(html).toContain('class="btn-primary" type="button" data-export-open');
    expect(html).toContain('data-export-confirm');
  });

  test("filled exports omit the missing-source warning", () => {
    const html = renderExport(data({ export: filledExport }));

    expect(html).not.toContain("have no trusted source");
    expect(html).not.toContain("data-export-missing");
    expect(html).toContain("This sends 2 line items for Northwind Partners LLC 2025 1120-S to the tax engine");
  });

  test("sent state shows success banner and download payload href", () => {
    const html = renderExport(data({ export: sentExport }));

    expect(html).toContain('href="/api/exports/exp-1/payload"');
    expect(html).toContain("Download payload");
    expect(html).toContain("2026-08-19T19:00:00.000Z");
    expect(html).toContain("Salaries and wages");
    expect(html).not.toContain("Confirm &amp; send to tax engine");
  });

  test("409 blocked state renders the server message and workspace link", () => {
    const html = renderExport(
      data({
        export: null,
        blocked: "No trusted documents to export",
      }),
    );

    expect(html).toContain("No trusted documents to export");
    expect(html).toContain('href="/engagements/eng-1"');
  });

  test("missing values use muted ash, not warning or inverted surfaces", () => {
    const html = renderExport(data());

    expect(html).toContain('<span class="muted">Missing — no trusted source</span>');
    expect(html).not.toContain("chip-warning");
    expect(html).not.toContain("surface-inverted");
    expect(html).not.toContain("box-shadow");
  });

  test("only the confirm action uses the highlighter primary button", () => {
    const draftHtml = renderExport(data());
    const sentHtml = renderExport(data({ export: sentExport }));

    expect(draftHtml).toContain('class="btn-primary" type="button" data-export-open');
    expect(sentHtml).toContain('class="btn-secondary"');
    expect(sentHtml).not.toContain("btn-primary");
  });

  test("export page module exposes load and render", () => {
    expect(typeof exportPage.load).toBe("function");
    expect(typeof exportPage.render).toBe("function");
    expect(typeof exportPage.bind).toBe("function");
  });

  test("confirm modal keeps an inline slot for confirm failures", () => {
    const html = renderExport(data());

    expect(html).toContain("data-export-confirm-modal");
    expect(html).toContain("data-export-error");
    expect(html).toContain("load-error-message");
    expect(html).toMatch(/data-export-error[^>]*hidden|hidden[^>]*data-export-error/);
  });

  test("confirm failure writes the ApiError into the modal slot, not a browser dialog", async () => {
    const alerts: string[] = [];
    const originalAlert = globalThis.alert;
    const originalFetch = globalThis.fetch;
    globalThis.alert = ((message: string) => {
      alerts.push(String(message));
    }) as typeof alert;

    try {
      globalThis.fetch = ((() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Export is no longer a draft" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        )) as unknown) as typeof fetch;

      const root = makeExportRoot();
      exportPage.bind?.(root as unknown as HTMLElement, data(), () => {});
      root.confirmButton.dispatch("click");

      await waitUntil(() => root.errorSlot.hidden === false);

      expect(alerts).toEqual([]);
      expect(root.errorSlot.hidden).toBe(false);
      expect(root.errorSlot.textContent).toBe("Export is no longer a draft");
    } finally {
      globalThis.alert = originalAlert;
      globalThis.fetch = originalFetch;
    }
  });

  test("load GETs the latest export and does not POST a draft", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      if (path === "/api/engagements/eng-1") {
        return jsonResponse(engagementDetail());
      }
      if (path === "/api/engagements/eng-1/export") {
        return jsonResponse({ export: draftExport });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }) as unknown) as typeof fetch;

    try {
      const loaded = await exportPage.load({ page: "export", engagementId: "eng-1" });

      expect(loaded.export?.id).toBe("exp-1");
      expect(loaded.needsBuild).toBe(false);
      expect(calls).toEqual([
        { method: "GET", path: "/api/engagements/eng-1" },
        { method: "GET", path: "/api/engagements/eng-1/export" },
      ]);
      expect(calls.some((call) => call.method === "POST")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("load treats a missing export as a build prompt instead of writing a draft", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      if (path === "/api/engagements/eng-1") {
        return jsonResponse(engagementDetail());
      }
      return jsonResponse({ error: "Not found" }, 404);
    }) as unknown) as typeof fetch;

    try {
      const loaded = await exportPage.load({ page: "export", engagementId: "eng-1" });

      expect(loaded).toMatchObject({
        engagementId: "eng-1",
        export: null,
        blocked: null,
        needsBuild: true,
      });
      expect(calls.some((call) => call.method === "POST")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("needs-build state offers an explicit Build export primary", () => {
    const html = renderExport(
      data({
        export: null,
        needsBuild: true,
      }),
    );

    expect(html).toContain("Build export");
    expect(html).toContain("data-export-build");
    expect(html).toContain("No export has been built yet");
    expect(html).not.toContain("Export could not be loaded");
    expect(html).not.toContain("data-export-open");
  });
});
