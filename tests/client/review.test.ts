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
import { ApiError } from "../../src/client/app/api.ts";
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
      reviewStatus: "accepted",
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

function validations(): ValidationCheck[] {
  return [
    validationCheckSchema.parse({
      checkId: "payroll-tie",
      label: "Payroll ties to P&L",
      status: "warn",
      explanation: "Form 941 wages are $30,000 but P&L payroll is $28,500.",
      relatedDocumentIds: ["doc-1"],
    }),
    validationCheckSchema.parse({
      checkId: "ein-consistency",
      label: "EIN consistency",
      status: "pass",
      explanation: "EIN/TIN values are consistent.",
      relatedDocumentIds: ["doc-1"],
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
    expect(html).toContain('href="/engagements/eng-1"');
  });

  test("a field row carries its confidence tier, metadata caption, and source snippet", () => {
    const html = renderReview(data());

    expect(html).toContain('class="confidence confidence-high">96%');
    expect(html).toContain('class="confidence confidence-medium">72%');
    expect(html).toContain('class="confidence confidence-low">20%');
    expect(html).toContain('class="review-field-type">dollar-amount');
    expect(html).toContain('class="review-source">Total revenue 1,250,000');
    expect(html).toContain("1 of 3 fields reviewed");
  });

  test("confidence never borrows the highlighter reserved for primary actions", () => {
    const html = renderReview(data());

    expect(html).not.toContain('class="badge"');
    expect(html).not.toContain("highlighter");
  });

  test("a dollar field renders through the shared money formatter", () => {
    const html = renderReview(data());

    expect(html).toContain("$1,250,000.00");
  });

  test("an ungrounded field says Not found instead of inventing a value", () => {
    const html = renderReview(data());

    expect(html).toContain("Not found");
  });

  test("a value that fails its regex is tagged as a format mismatch", () => {
    const html = renderReview(data());

    expect(html).toContain("Format mismatch");
  });

  test("each unreviewed field offers accept and edit, with an inline edit input", () => {
    const html = renderReview(data());

    expect(html).toContain('data-accept-field="gross_receipts"');
    expect(html).toContain('data-edit-field="ein"');
    expect(html).toContain('data-field-edit="ein"');
    expect(html).toContain("data-field-edit-input");
  });

  test("Accept all >=90% shows only while an unreviewed high-confidence field remains", () => {
    const html = renderReview(data());
    expect(html).toContain("data-accept-high-confidence");
    expect(html).toContain("Accept all ≥90%");

    const reviewed = renderReview(
      data({
        document: document({
          extraction: {
            fields: fields([{ reviewStatus: "accepted" }, { reviewStatus: "accepted" }]),
          },
        }),
      }),
    );
    expect(reviewed).not.toContain("data-accept-high-confidence");
  });

  test("an edited field shows the corrected value and keeps the extracted one visible", () => {
    const html = renderReview(
      data({
        document: document({
          extraction: {
            fields: fields([{ reviewStatus: "edited", editedValue: 1300000 }]),
          },
        }),
      }),
    );

    expect(html).toContain("$1,300,000.00");
    expect(html).toContain("Extracted $1,250,000.00");
    expect(html).toContain("Edited");
  });

  test("Mark trusted stays disabled while any field is unreviewed", () => {
    const html = renderReview(data());

    expect(html).toContain("data-mark-trusted disabled");
  });

  test("Mark trusted enables once every field is accepted or edited", () => {
    const html = renderReview(
      data({
        document: document({
          extraction: {
            fields: fields([{ reviewStatus: "accepted" }, { reviewStatus: "edited", editedValue: "12-3456789" }]),
          },
        }),
      }),
    );

    expect(html).toContain("data-mark-trusted>");
    expect(html).not.toContain("data-mark-trusted disabled");
  });

  test("canTrust is false while any field is unreviewed", () => {
    expect(canTrust(fields())).toBe(false);
  });

  test("canTrust is true when every field is accepted or edited", () => {
    expect(
      canTrust(fields([{ reviewStatus: "accepted" }, { reviewStatus: "edited", editedValue: "x" }])),
    ).toBe(true);
  });

  test("validation warnings render the real explanation and stay advisory", () => {
    const html = renderReview(data());

    expect(html).toContain("Payroll ties to P&amp;L");
    expect(html).toContain("Form 941 wages are $30,000 but P&amp;L payroll is $28,500.");
    expect(html).toContain("never block");
    expect(html).not.toContain("EIN consistency");
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
    expect(html).not.toContain("data-accept-field");
    expect(html).not.toContain("data-mark-trusted");
  });

  test("a trusted document is read-only and points at the engine export", () => {
    const html = renderReview(
      data({
        document: document({
          pipelineStatus: "trusted",
          extraction: { fields: fields([{ reviewStatus: "accepted" }, { reviewStatus: "accepted" }]) },
        }),
      }),
    );

    expect(html).toContain("Trusted");
    expect(html).toContain('href="/engagements/eng-1/export"');
    expect(html).not.toContain("data-accept-field");
    expect(html).not.toContain("data-mark-trusted");
  });

  test("polls on the shared live interval so the fail-soft rerun lands on its own", () => {
    expect(reviewPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return urls;
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

describe("review page load", () => {
  const route: Route = { page: "review", engagementId: "eng-1", documentId: "doc-1" };

  test("pulls the document detail and the engagement validations", async () => {
    const urls = stubFetch((url) =>
      url.startsWith("/api/documents")
        ? jsonResponse({ document: document(), documentType: documentType() })
        : jsonResponse({ checks: validations() }),
    );

    const loaded = await reviewPage.load(route);

    expect(urls).toContain("/api/documents/doc-1");
    expect(urls).toContain("/api/engagements/eng-1/validations");
    expect(loaded.document.id).toBe("doc-1");
    expect(loaded.documentType?.name).toBe("Profit and loss");
    expect(loaded.validations).toHaveLength(2);
  });

  test("a document from another engagement is a miss, not a permission error", async () => {
    stubFetch((url) =>
      url.startsWith("/api/documents")
        ? jsonResponse({ document: document({ engagementId: "eng-other" }) })
        : jsonResponse({ checks: [] }),
    );

    const error = await reviewPage.load(route).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe("Not found");
  });
});
