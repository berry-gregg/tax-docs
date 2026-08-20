import { describe, expect, test } from "bun:test";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { engagementDetailSchema, type EngagementDetail } from "../../src/shared/schemas/api.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import { validationCheckSchema, type ValidationCheck } from "../../src/shared/schemas/validation.ts";
import {
  engagementPage,
  renderEngagementWorkspace,
  type EngagementWorkspaceData,
} from "../../src/client/app/pages/engagement-workspace.ts";

const now = new Date("2026-08-20T00:00:00.000Z");

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
        id: "doc-trusted",
        engagementId: "eng-1",
        requestItemId: "item-received",
        filename: "profit-loss.pdf",
        mimeType: "application/pdf",
        size: 2048,
        storagePath: "data/uploads/doc-trusted.pdf",
        uploadedBy: "client",
        pipelineStatus: "trusted",
        classification: {
          documentTypeId: "dt-pl",
          confidence: 0.94,
          reasoning: "Matched statement title.",
        },
        createdAt: "2026-08-19T20:00:00.000Z",
        updatedAt: "2026-08-19T20:00:00.000Z",
      },
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
    activity: [
      {
        id: "act-1",
        engagementId: "eng-1",
        actor: "client",
        action: "document-uploaded",
        detail: "profit-loss.pdf",
        direction: "inbound",
        createdAt: "2026-08-19T23:30:00.000Z",
      },
    ],
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
      checkId: "payroll-tie",
      label: "Payroll ties to P&L",
      status: "warn",
      explanation: "Form 941 wages are $30,000 but P&L payroll is $28,500.",
      relatedDocumentIds: ["doc-trusted"],
    }),
    validationCheckSchema.parse({
      checkId: "ein-consistency",
      label: "EIN consistency",
      status: "pass",
      explanation: "EIN/TIN values are consistent.",
      relatedDocumentIds: ["doc-trusted"],
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

describe("engagement workspace", () => {
  test("renders the client header, portal controls, validation chips, and trusted export action", () => {
    const html = renderEngagementWorkspace(data());

    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("1120-S · 2025");
    expect(html).toContain("/portal/portal-token");
    expect(html).toContain("Copy portal link");
    expect(html).toContain('href="/engagements/eng-1/export"');
    expect(html).toContain("Export");
    expect(html).toContain("Payroll ties to P&amp;L");
    expect(html).toContain("Form 941 wages are $30,000 but P&amp;L payroll is $28,500.");
    expect(html).toContain("1 passed");
  });

  test("hides Export until at least one document is trusted", () => {
    const withoutTrusted = detail({
      documents: detail().documents.map((document) => ({ ...document, pipelineStatus: "needs-review" })),
    });
    const html = renderEngagementWorkspace(data({ detail: withoutTrusted }));

    expect(html).not.toContain('href="/engagements/eng-1/export"');
  });

  test("renders request checklist chips and waive action for open optional items", () => {
    const html = renderEngagementWorkspace(data());

    expect(html).toContain("Request checklist");
    expect(html).toContain("Schedule K-1");
    expect(html).toContain("Open");
    expect(html).toContain("Received");
    expect(html).toContain('data-request-item-id="item-open"');
    expect(html).toContain("Waive");
  });

  test("renders the document table with type names, confidence, review links, failed cause, and retry", () => {
    const html = renderEngagementWorkspace(data());

    expect(html).toContain("Documents");
    expect(html).toContain("profit-loss.pdf");
    expect(html).toContain("Profit and loss");
    expect(html).toContain("Trusted");
    expect(html).toContain("94%");
    expect(html).toContain("client");
    expect(html).toContain('href="/engagements/eng-1/review/doc-trusted"');
    expect(html).toContain("trial-balance.pdf");
    expect(html).toContain("Unclassified");
    expect(html).toContain("OpenRouter timed out after retry");
    expect(html).toContain('data-rerun-document-id="doc-failed"');
    expect(html).toContain("Retry");
  });

  test("includes the CPA upload dropzone bound to the engagement", () => {
    const html = renderEngagementWorkspace(data());

    expect(html).toContain('class="dropzone"');
    expect(html).toContain('data-engagement-id="eng-1"');
    expect(html).toContain('type="file"');
    expect(html).toContain("Drop a PDF here");
  });

  test("shows activity feed and rail widgets with relative times", () => {
    const html = renderEngagementWorkspace(data());

    expect(html).toContain("Activity");
    expect(html).toContain("document-uploaded");
    expect(html).toContain("30m ago");
    expect(html).toContain("Trusted documents");
    expect(html).toContain("Open requests");
  });

  test("polls on the shared live interval", () => {
    expect(engagementPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
