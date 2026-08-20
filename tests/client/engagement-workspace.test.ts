import { afterEach, describe, expect, test } from "bun:test";
import {
  engagementPage,
  renderEngagementWorkspace,
  type EngagementWorkspaceData,
} from "../../src/client/app/pages/engagement-workspace.ts";
import { engagementDetailSchema, type EngagementDetail } from "../../src/shared/schemas/api.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import { validationCheckSchema, type ValidationCheck } from "../../src/shared/schemas/validation.ts";

const now = new Date("2026-08-20T00:00:00.000Z");
const originalFetch = globalThis.fetch;
const originalAlert = globalThis.alert;
const originalHTMLElement = globalThis.HTMLElement;

function detail(overrides: Partial<EngagementDetail> = {}): EngagementDetail {
  return engagementDetailSchema.parse({
    engagement: {
      id: "eng-1",
      clientId: "client-1",
      taxYear: 2025,
      filingType: "1120-S",
      status: "in-review",
      portalToken: "portal-token",
      createdAt: "2026-08-19T18:00:00.000Z",
      updatedAt: "2026-08-19T18:00:00.000Z",
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
      createdAt: "2026-08-19T18:00:00.000Z",
    },
    requestItems: [
      {
        id: "item-open",
        engagementId: "eng-1",
        documentTypeId: "dt-k1",
        title: "Schedule K-1",
        description: "Upload every shareholder K-1.",
        required: false,
        status: "open",
        matchedDocumentIds: [],
        createdAt: "2026-08-19T18:00:00.000Z",
      },
      {
        id: "item-received",
        engagementId: "eng-1",
        documentTypeId: "dt-pl",
        title: "Profit and loss",
        description: "Full-year statement.",
        required: true,
        status: "received",
        matchedDocumentIds: ["doc-trusted"],
        createdAt: "2026-08-19T18:01:00.000Z",
      },
    ],
    documents: [
      {
        id: "doc-failed",
        engagementId: "eng-1",
        filename: "trial-balance.pdf",
        mimeType: "application/pdf",
        size: 1024,
        storagePath: "data/uploads/doc-failed.pdf",
        uploadedBy: "cpa",
        pipelineStatus: "failed",
        failure: { message: "OpenRouter timed out after retry" },
        createdAt: "2026-08-19T21:00:00.000Z",
        updatedAt: "2026-08-19T21:00:00.000Z",
      },
    ],
    activity: [],
    ...overrides,
  });
}

function documentTypes(): DocumentType[] {
  return [
    documentTypeSchema.parse({
      id: "dt-pl",
      name: "Profit and loss",
      description: "P&L statement.",
      active: true,
      createdBy: "seed",
      fields: [
        {
          key: "gross_receipts",
          label: "Gross receipts",
          metadataType: "dollar-amount",
          dataType: "double",
          required: true,
          description: "Total revenue.",
        },
      ],
      createdAt: "2026-08-19T18:00:00.000Z",
    }),
  ];
}

function validations(): ValidationCheck[] {
  return [
    validationCheckSchema.parse({
      checkId: "ein-consistency",
      label: "EIN consistency",
      status: "pass",
      explanation: "EIN/TIN values are consistent.",
      relatedDocumentIds: [],
    }),
  ];
}

function data(overrides: Partial<EngagementWorkspaceData> = {}): EngagementWorkspaceData {
  return {
    detail: detail(),
    documentTypes: documentTypes(),
    validations: validations(),
    now,
    ...overrides,
  };
}

function checklistMarkup(html: string): string {
  const start = html.indexOf("Request checklist");
  const end = html.indexOf(">Documents<");
  return html.slice(start, end === -1 ? undefined : end);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return urls;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

class WorkspaceNode {
  hidden = true;
  textContent = "";
  files: File[] = [];
  dataset: Record<string, string> = {};
  readonly classList = { add() {}, remove() {} };
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(event: WorkspaceEvent) => void>>();

  constructor(
    readonly selector: string,
    private readonly children: Record<string, WorkspaceNode> = {},
  ) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector: string): WorkspaceNode | null {
    return this.children[selector] ?? null;
  }

  querySelectorAll(selector: string): WorkspaceNode[] {
    const child = this.children[selector];
    return child ? [child] : [];
  }

  addEventListener(type: string, listener: (event: WorkspaceEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, target: WorkspaceNode = this, extra: Partial<WorkspaceEvent> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target, preventDefault() {}, ...extra });
    }
  }
}

type WorkspaceEvent = {
  target: WorkspaceNode;
  preventDefault(): void;
  dataTransfer?: { files: File[] };
};

function makeWorkspaceRoot() {
  const fileInput = new WorkspaceNode("[data-document-upload]");
  const dropzone = new WorkspaceNode("[data-dropzone]", {
    "[data-document-upload]": fileInput,
  });
  const errorSlot = new WorkspaceNode("[data-workspace-error]");
  const waiveButton = new WorkspaceNode("[data-waive-request-item]");
  waiveButton.attributes.set("data-waive-request-item", "item-open");
  const retryButton = new WorkspaceNode("[data-rerun-document-id]");
  retryButton.attributes.set("data-rerun-document-id", "doc-failed");
  const root = new WorkspaceNode("root", {
    "[data-dropzone]": dropzone,
    "[data-workspace-error]": errorSlot,
  });

  return Object.assign(root, { fileInput, dropzone, errorSlot, waiveButton, retryButton });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.alert = originalAlert;
  globalThis.HTMLElement = originalHTMLElement;
});

describe("engagement workspace checklist", () => {
  test("renders request items as non-anchor rows and keeps Waive as a button", () => {
    const html = renderEngagementWorkspace(data());
    const checklist = checklistMarkup(html);

    expect(checklist).toContain("Schedule K-1");
    expect(checklist).toContain('<div class="list-row">');
    expect(checklist).toContain('data-waive-request-item="item-open"');
    expect(checklist).toMatch(/<button class="btn-ghost" type="button" data-waive-request-item="item-open">Waive<\/button>/);
    expect(checklist).not.toContain('href="#"');
    expect(checklist).not.toContain("<a ");
  });
});

describe("engagement workspace errors", () => {
  test("keeps a hidden inline slot beside the dropzone for upload, waive, and retry failures", () => {
    const html = renderEngagementWorkspace(data());
    const documentsStart = html.indexOf(">Documents<");
    const documentsBlock = html.slice(documentsStart);

    expect(documentsBlock).toContain("data-dropzone");
    expect(documentsBlock).toContain('data-workspace-error');
    expect(documentsBlock).toContain("load-error-message");
    expect(documentsBlock).toMatch(/data-workspace-error[^>]*hidden|hidden[^>]*data-workspace-error/);
    expect(documentsBlock.indexOf("data-dropzone")).toBeLessThan(documentsBlock.indexOf("data-workspace-error"));
  });

  test("upload failure writes the ApiError into the dropzone slot, not a browser dialog", async () => {
    const alerts: string[] = [];
    globalThis.alert = ((message: string) => {
      alerts.push(String(message));
    }) as typeof alert;
    globalThis.HTMLElement = WorkspaceNode as unknown as typeof HTMLElement;
    stubFetch(() => jsonResponse({ error: "Upload must be a PDF" }, 400));

    const root = makeWorkspaceRoot();
    engagementPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    root.fileInput.files = [new File(["not-a-pdf"], "notes.txt", { type: "text/plain" })];
    root.fileInput.dispatch("change");

    await flushMicrotasks();

    expect(alerts).toEqual([]);
    expect(root.errorSlot.hidden).toBe(false);
    expect(root.errorSlot.textContent).toBe("Upload must be a PDF");
  });

  test("waive failure writes the ApiError into the dropzone slot", async () => {
    globalThis.HTMLElement = WorkspaceNode as unknown as typeof HTMLElement;
    stubFetch(() => jsonResponse({ error: "Only open optional items can be waived" }, 400));

    const root = makeWorkspaceRoot();
    engagementPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    root.dispatch("click", root.waiveButton);

    await flushMicrotasks();

    expect(root.errorSlot.hidden).toBe(false);
    expect(root.errorSlot.textContent).toBe("Only open optional items can be waived");
  });

  test("retry failure writes the ApiError into the dropzone slot", async () => {
    globalThis.HTMLElement = WorkspaceNode as unknown as typeof HTMLElement;
    stubFetch(() => jsonResponse({ error: "Document is not in a failed state" }, 409));

    const root = makeWorkspaceRoot();
    engagementPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    root.dispatch("click", root.retryButton);

    await flushMicrotasks();

    expect(root.errorSlot.hidden).toBe(false);
    expect(root.errorSlot.textContent).toBe("Document is not in a failed state");
  });
});

describe("engagement workspace bind", () => {
  test("binds the delegated click listener once so Waive does not fire on every poll tick", async () => {
    globalThis.HTMLElement = WorkspaceNode as unknown as typeof HTMLElement;
    const urls = stubFetch(() => jsonResponse({ item: { id: "item-open" } }));

    const root = makeWorkspaceRoot();
    engagementPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    engagementPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    root.dispatch("click", root.waiveButton);

    await flushMicrotasks();

    expect(root.dataset.boundWorkspace).toBe("true");
    expect(urls).toEqual(["/api/engagements/eng-1/request-items/item-open"]);
    expect(urls).toHaveLength(1);
  });
});
