import { afterEach, describe, expect, test } from "bun:test";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import {
  taxDocumentSchema,
  type ExtractionField,
  type TaxDocument,
} from "../../src/shared/schemas/document.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import {
  validationCheckSchema,
  type ValidationCheck,
} from "../../src/shared/schemas/validation.ts";
import {
  canTrust,
  renderReview,
  reviewPage,
  type ReviewData,
} from "../../src/client/app/pages/review.ts";
import type { Route } from "../../src/client/app/router.ts";

function fields(overrides: Partial<ExtractionField>[] = []): ExtractionField[] {
  const base: ExtractionField[] = [
    {
      key: "gross_receipts",
      label: "Gross receipts",
      metadataType: "dollar-amount",
      dataType: "double",
      value: 1250000,
      confidence: 0.96,
      sourceSnippet: "Total revenue 1,250,000",
      notFound: false,
      regexPass: null,
      reviewStatus: "unreviewed",
    },
    {
      key: "ein",
      label: "EIN",
      metadataType: "ein-tin",
      dataType: "string",
      value: "12-345678",
      confidence: 0.72,
      sourceSnippet: "EIN 12-345678",
      notFound: false,
      regexPass: false,
      reviewStatus: "unreviewed",
    },
    {
      key: "officer_name",
      label: "Officer name",
      metadataType: "person-name",
      dataType: "string",
      value: null,
      confidence: 0.2,
      sourceSnippet: "",
      notFound: true,
      regexPass: null,
      reviewStatus: "unreviewed",
    },
  ];

  return base.map((field, index) => ({ ...field, ...overrides[index] }));
}

function document(overrides: Partial<TaxDocument> = {}): TaxDocument {
  return taxDocumentSchema.parse({
    id: "doc-1",
    engagementId: "eng-1",
    filename: "profit-loss.pdf",
    mimeType: "application/pdf",
    size: 2048,
    storagePath: "data/uploads/doc-1.pdf",
    uploadedBy: "client",
    pipelineStatus: "needs-review",
    classification: {
      documentTypeId: "dt-pl",
      confidence: 0.93,
      reasoning: "Statement title matched the profit and loss definition.",
    },
    extraction: { fields: fields() },
    createdAt: "2026-08-19T20:00:00.000Z",
    updatedAt: "2026-08-19T21:00:00.000Z",
    ...overrides,
  });
}

function documentType(): DocumentType {
  return documentTypeSchema.parse({
    id: "dt-pl",
    name: "Profit and loss",
    description: "Full-year profit and loss statement.",
    active: true,
    createdBy: "seed",
    fields: [
      {
        key: "gross_receipts",
        label: "Gross receipts",
        metadataType: "dollar-amount",
        dataType: "double",
        required: true,
        description: "Total revenue for the year.",
      },
    ],
    createdAt: "2026-08-19T18:00:00.000Z",
  });
}

/** doc-1 checks (one warn, one pass), plus cross-doc and checklist noise that must not render. */
function validations(): ValidationCheck[] {
  return [
    validationCheckSchema.parse({
      checkId: "payroll-tie",
      label: "Payroll ties to P&L",
      status: "warn",
      explanation: "Form 941 wages are $30,000 but P&L payroll is $28,500.",
      relatedDocumentIds: ["doc-1", "doc-941"],
    }),
    validationCheckSchema.parse({
      checkId: "balance-sheet-ties",
      label: "Balance sheet ties",
      status: "pass",
      explanation: "Assets equal liabilities plus equity.",
      relatedDocumentIds: ["doc-1"],
    }),
    validationCheckSchema.parse({
      checkId: "trial-balance-ties",
      label: "Trial balance ties",
      status: "warn",
      explanation: "Debits do not equal credits on the trial balance.",
      relatedDocumentIds: ["doc-other"],
    }),
    validationCheckSchema.parse({
      checkId: "missing-required-items",
      label: "Missing required items",
      status: "warn",
      explanation: "2 required checklist items have no matched document.",
      relatedDocumentIds: [],
    }),
  ];
}

function data(overrides: Partial<ReviewData> = {}): ReviewData {
  return {
    engagementId: "eng-1",
    document: document(),
    documentType: documentType(),
    validations: validations(),
    ...overrides,
  };
}

describe("review page", () => {
  test("renders the stored PDF beside the panel with filename and document type", () => {
    const html = renderReview(data());

    expect(html).toContain('src="/api/documents/doc-1/file"');
    expect(html).toContain("profit-loss.pdf");
    expect(html).toContain("Profit and loss");
    expect(html).toContain("Statement title matched the profit and loss definition.");
  });

  test("breadcrumbs lead back to the documents tab with the filename as the current page", () => {
    const html = renderReview(data());

    expect(html).toContain('class="breadcrumbs"');
    expect(html).toMatch(/class="breadcrumb-link" href="\/documents"[^>]*>Documents</);
    expect(html).toMatch(/class="breadcrumb-current"[^>]*>profit-loss\.pdf</);
  });

  test("the header hosts the trust action instead of an engagement workspace link", () => {
    const html = renderReview(data());

    expect(html).not.toContain("Engagement workspace");
    expect(html).not.toContain('href="/engagements/eng-1"');
    expect(html).toMatch(
      /<div class="page-actions"><button class="btn-primary" type="button" data-mark-trusted>Mark trusted<\/button><\/div>/,
    );
  });

  test("each field is one compact row: label, always-editable input, confidence chip", () => {
    const html = renderReview(data());

    expect(html).toMatch(/data-field-input="gross_receipts"[^>]*value="1250000"/);
    expect(html).toMatch(/data-field-input="ein"[^>]*value="12-345678"/);
    expect(html).toContain('class="chip confidence-high">96%');
    expect(html).toContain('class="chip confidence-medium">72%');
    expect(html).toContain('class="chip confidence-low">20%');
    expect(html).toContain('class="review-field-type">dollar-amount');
  });

  test("per-field accept, edit, and bulk-accept controls are gone", () => {
    const html = renderReview(data());

    expect(html).not.toContain("data-accept-field");
    expect(html).not.toContain("data-edit-field");
    expect(html).not.toContain("data-accept-high-confidence");
    expect(html).not.toContain("fields reviewed");
  });

  test("an ungrounded field is an empty input with a Not found placeholder", () => {
    const html = renderReview(data());

    expect(html).toMatch(/data-field-input="officer_name"[^>]*value=""/);
    expect(html).toMatch(/data-field-input="officer_name"[^>]*placeholder="Not found"/);
  });

  test("a value that fails its regex is tagged as a format mismatch", () => {
    const html = renderReview(data());

    expect(html).toContain("Format mismatch");
  });

  test("an edited field pre-fills the correction and stays attributed as edited", () => {
    const html = renderReview(
      data({
        document: document({
          extraction: {
            fields: fields([{ reviewStatus: "edited", editedValue: 1300000 }]),
          },
        }),
      }),
    );

    expect(html).toMatch(/data-field-input="gross_receipts"[^>]*value="1300000"/);
    expect(html).toContain("Edited");
    expect(html).toContain("Extracted $1,250,000.00");
  });

  test("source snippets collapse behind a per-row disclosure instead of adding row height", () => {
    const html = renderReview(data());

    expect(html).toContain('data-source-toggle="gross_receipts"');
    expect(html).toMatch(/data-source-row="gross_receipts"[^>]*hidden/);
    expect(html).toContain("Total revenue 1,250,000");
    // A field with no snippet renders no toggle at all.
    expect(html).not.toContain('data-source-toggle="officer_name"');
  });

  test("Trust is live even while fields are unreviewed — editing is optional", () => {
    const html = renderReview(data());

    expect(html).toContain("data-mark-trusted");
    expect(html).not.toContain("data-mark-trusted disabled");
    expect(html).not.toContain("Edit anything that is wrong");
    expect(html).not.toContain("review-foot");
  });

  test("Trust stays disabled when extraction returned no fields", () => {
    const html = renderReview(
      data({
        document: document({ extraction: { fields: [] } }),
      }),
    );

    expect(html).toContain("Extraction returned no fields for this document type.");
    expect(html).toContain("data-mark-trusted disabled");
    expect(html).toContain("This document cannot be marked trusted.");
  });

  test("canTrust needs fields but no per-field review", () => {
    expect(canTrust(fields())).toBe(true);
    expect(canTrust([])).toBe(false);
  });

  test("validation shows only this document's checks, passes included", () => {
    const html = renderReview(data());

    expect(html).toContain("Payroll ties to P&amp;L");
    expect(html).toContain("Form 941 wages are $30,000 but P&amp;L payroll is $28,500.");
    expect(html).toContain('<span class="chip chip-warning">Warn</span>');
    expect(html).toContain("Balance sheet ties");
    expect(html).toContain('<span class="chip chip-success">Pass</span>');
    expect(html).toContain("never block");
    // Other documents' checks and the checklist roll-up stay on the engagement workspace.
    expect(html).not.toContain("Trial balance ties");
    expect(html).not.toContain("Missing required items");
  });

  test("a document with no document-scoped checks says so quietly", () => {
    const html = renderReview(
      data({
        validations: [
          validationCheckSchema.parse({
            checkId: "trial-balance-ties",
            label: "Trial balance ties",
            status: "warn",
            explanation: "Debits do not equal credits.",
            relatedDocumentIds: ["doc-other"],
          }),
        ],
      }),
    );

    expect(html).toContain("No document-level checks for this document type.");
    expect(html).not.toContain("Trial balance ties");
  });

  test("needs-review renders the same warning chip class the documents list uses", () => {
    const html = renderReview(data());

    expect(html).toContain('<span class="chip chip-warning">Needs review</span>');
  });

  test("confidence never borrows the highlighter reserved for primary actions", () => {
    const html = renderReview(data());

    expect(html).not.toContain('class="badge"');
    expect(html).not.toContain("highlighter");
  });

  test("an unclassified document offers Define document type with the reasoning", () => {
    const html = renderReview(
      data({
        documentType: null,
        document: document({
          pipelineStatus: "unclassified",
          classification: {
            documentTypeId: null,
            confidence: 0.31,
            reasoning: "No active document type matches a state apportionment schedule.",
          },
          extraction: undefined,
        }),
      }),
    );

    expect(html).toContain("No active document type matches a state apportionment schedule.");
    expect(html).toContain("data-define-document-type");
    expect(html).toContain("Define document type");
    expect(html).toContain("Unclassified");
  });

  test("a failed document surfaces the real failure message with a retry", () => {
    const html = renderReview(
      data({
        document: document({
          pipelineStatus: "failed",
          failure: { message: "OpenRouter returned 503 after one retry" },
          extraction: undefined,
        }),
      }),
    );

    expect(html).toContain("OpenRouter returned 503 after one retry");
    expect(html).toContain("data-rerun-document");
    expect(html).toContain("Retry");
  });

  test("a rejected document shows the kind, the reason, and Run again", () => {
    const html = renderReview(
      data({
        document: document({
          pipelineStatus: "rejected",
          rejection: { kind: "unreadable", reason: "The scan is too blurry to read any figures." },
          extraction: undefined,
        }),
      }),
    );

    expect(html).toContain("unreadable");
    expect(html).toContain("The scan is too blurry to read any figures.");
    expect(html).toContain("Run again");
    expect(html).toContain("data-rerun-document");
  });

  test("a document still in the pipeline shows progress instead of review controls", () => {
    const html = renderReview(
      data({
        document: document({ pipelineStatus: "extracting", extraction: undefined }),
      }),
    );

    expect(html).toContain("Extracting");
    expect(html).toContain("still moving through the pipeline");
    expect(html).not.toContain("data-field-input");
    expect(html).not.toContain("data-mark-trusted");
  });

  test("a trusted document disables its inputs and points at the engine export", () => {
    const html = renderReview(
      data({
        document: document({
          pipelineStatus: "trusted",
          extraction: { fields: fields([{ reviewStatus: "accepted" }, { reviewStatus: "accepted" }]) },
        }),
      }),
    );

    expect(html).toContain("Trusted");
    expect(html).toMatch(
      /<div class="page-actions"><a class="btn-secondary" href="\/engagements\/eng-1\/export" data-nav-link>Open export<\/a><\/div>/,
    );
    expect(html).toMatch(/data-field-input="gross_receipts"[^>]*disabled/);
    expect(html).not.toContain("data-mark-trusted");
    expect(html).not.toContain("ready for the engine export");
  });

  test("polls on the shared live interval so the fail-soft rerun lands on its own", () => {
    expect(reviewPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});

const originalFetch = globalThis.fetch;

type RecordedRequest = { url: string; init?: RequestInit };

function stubFetch(handler: (url: string) => Response): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return requests;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function unclassifiedData(): ReviewData {
  return data({
    documentType: null,
    document: document({
      pipelineStatus: "unclassified",
      classification: {
        documentTypeId: null,
        confidence: 0.31,
        reasoning: "No active document type matches a state apportionment schedule.",
      },
      extraction: undefined,
    }),
  });
}

function draftType(name: string) {
  return {
    name,
    description: `${name} description.`,
    active: true,
    fields: [
      {
        key: "sales_factor",
        label: "Sales factor",
        metadataType: "percentage" as const,
        dataType: "double" as const,
        required: true,
        description: "In-state sales ratio.",
      },
    ],
  };
}

type ReviewListener = (event: { target: FakeReviewElement; preventDefault(): void }) => void;

class FakeReviewElement {
  dataset: Record<string, string | undefined> = {};
  innerHTML = "";
  textContent = "";
  value = "";
  disabled = false;
  private readonly listeners = new Map<string, ReviewListener[]>();

  constructor(readonly selector: string) {}

  addEventListener(type: string, listener: ReviewListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, preventDefault() {} });
    }
  }

  querySelector(selector: string): FakeReviewElement | null {
    if (selector === ".side-panel" && this.innerHTML.includes("side-panel")) {
      return new FakeReviewElement(".side-panel");
    }
    return null;
  }

  querySelectorAll(): FakeReviewElement[] {
    return [];
  }
}

function makeFakeReviewRoot() {
  const define = new FakeReviewElement("[data-define-document-type]");
  define.textContent = "Define document type";
  const slot = new FakeReviewElement("[data-schema-panel-slot]");

  return {
    define,
    slot,
    querySelector(selector: string) {
      if (selector === "[data-define-document-type]") {
        return define;
      }
      if (selector === "[data-schema-panel-slot]") {
        return slot;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

async function clickDefine(root: ReturnType<typeof makeFakeReviewRoot>): Promise<void> {
  root.define.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("review save-on-change", () => {
  function makeEditableRoot() {
    const input = new FakeReviewElement('[data-field-input="ein"]');
    input.dataset.fieldInput = "ein";
    input.value = "12-345678";
    const state = new FakeReviewElement('[data-field-state="ein"]');

    return {
      input,
      state,
      querySelector(selector: string) {
        if (selector === '[data-field-state="ein"]') {
          return state;
        }
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === "[data-field-input]") {
          return [input];
        }
        return [];
      },
    };
  }

  test("blurring a changed value PATCHes an edit and shows a quiet saved hint", async () => {
    const requests = stubFetch(() => jsonResponse({ document: document() }));
    const root = makeEditableRoot();
    const reviewData = data();

    reviewPage.bind?.(root as unknown as HTMLElement, reviewData, () => {});
    root.input.value = "98-7654321";
    root.input.dispatch("change");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe("/api/documents/doc-1/fields/ein");
    expect(request?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      action: "edit",
      value: "98-7654321",
    });
    expect(root.state.textContent).toBe("Saved");
  });

  test("an unchanged value never fires a request", async () => {
    const requests = stubFetch(() => jsonResponse({ document: document() }));
    const root = makeEditableRoot();

    reviewPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    root.input.dispatch("change");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toHaveLength(0);
  });

  test("a failed save surfaces the server's own error message inline", async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ error: "Document is not awaiting review" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const root = makeEditableRoot();

    reviewPage.bind?.(root as unknown as HTMLElement, data(), () => {});
    root.input.value = "98-7654321";
    root.input.dispatch("change");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.state.textContent).toBe("Document is not awaiting review");
  });
});

describe("review define-type schema builder", () => {
  test("define document type mounts a modal wash and keeps the first draft if define is clicked again", async () => {
    const drafts = [draftType("State apportionment"), draftType("Schedule K-1")];
    stubFetch((url) =>
      url.includes("/draft-type")
        ? jsonResponse({ draft: drafts.shift() ?? draftType("fallback") })
        : jsonResponse({}),
    );
    const root = makeFakeReviewRoot();

    reviewPage.bind?.(root as unknown as HTMLElement, unclassifiedData(), () => {});
    await clickDefine(root);

    expect(root.slot.innerHTML).toContain('class="modal"');
    expect(root.slot.innerHTML).toContain("data-schema-scrim");
    expect(root.slot.innerHTML).toContain("State apportionment");
    expect(root.slot.innerHTML).toContain("Edit schema");

    await clickDefine(root);

    expect(root.slot.innerHTML).toContain("State apportionment");
    expect(root.slot.innerHTML).not.toContain("Schedule K-1");
  });

  test("closing the schema builder allows a later define to mount a new draft", async () => {
    const drafts = [draftType("State apportionment"), draftType("Schedule K-1")];
    stubFetch((url) =>
      url.includes("/draft-type")
        ? jsonResponse({ draft: drafts.shift() ?? draftType("fallback") })
        : jsonResponse({}),
    );
    const root = makeFakeReviewRoot();

    reviewPage.bind?.(root as unknown as HTMLElement, unclassifiedData(), () => {});
    await clickDefine(root);
    expect(root.slot.innerHTML).toContain("State apportionment");

    root.slot.innerHTML = "";
    await clickDefine(root);

    expect(root.slot.innerHTML).toContain('class="modal"');
    expect(root.slot.innerHTML).toContain("Schedule K-1");
  });
});

describe("review page load", () => {
  const route: Route = { page: "review", documentId: "doc-1" };

  test("pulls the document by id and derives the engagement for its validations", async () => {
    const requests = stubFetch((url) =>
      url.startsWith("/api/documents")
        ? jsonResponse({ document: document(), documentType: documentType() })
        : jsonResponse({ checks: validations() }),
    );

    const loaded = await reviewPage.load(route);

    expect(requests.map((request) => request.url)).toContain("/api/documents/doc-1");
    expect(requests.map((request) => request.url)).toContain("/api/engagements/eng-1/validations");
    expect(loaded.document.id).toBe("doc-1");
    expect(loaded.engagementId).toBe("eng-1");
    expect(loaded.documentType?.name).toBe("Profit and loss");
    expect(loaded.validations).toHaveLength(4);
  });
});
