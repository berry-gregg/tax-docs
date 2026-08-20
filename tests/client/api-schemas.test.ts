import { describe, expect, test } from "bun:test";
import { FIRM_NAME } from "../../src/shared/constants.ts";
import {
  documentListRowSchema,
  engagementDetailSchema,
  engagementListRowSchema,
  inboxEntrySchema,
  metricsSchema,
  portalStateSchema,
} from "../../src/shared/schemas/api.ts";

const iso = "2026-03-12T00:00:00.000Z";

const engagement = {
  id: "eng-1",
  clientId: "client-1",
  taxYear: 2025,
  filingType: "1120-S",
  status: "collecting",
  portalToken: "portal-token-1",
  createdAt: iso,
  updatedAt: iso,
};

const client = {
  id: "client-1",
  legalName: "Northwind Partners LLC",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Maya Chen",
  contactEmail: "maya@northwind.example",
  city: "Denver",
  state: "CO",
  createdAt: iso,
};

const taxDocument = {
  id: "doc-1",
  engagementId: "eng-1",
  filename: "w2.pdf",
  mimeType: "application/pdf",
  size: 2048,
  storagePath: "data/uploads/doc-1.pdf",
  uploadedBy: "client",
  pipelineStatus: "needs-review",
  createdAt: iso,
  updatedAt: iso,
};

const requestItem = {
  id: "item-1",
  engagementId: "eng-1",
  documentTypeId: "dt-w2",
  title: "2025 W-2s",
  description: "Every W-2 issued by the entity for the tax year.",
  required: true,
  status: "open",
  matchedDocumentIds: [],
  createdAt: iso,
};

const activity = {
  id: "act-1",
  engagementId: "eng-1",
  actor: "client",
  action: "document-uploaded",
  detail: "w2.pdf",
  direction: "inbound",
  createdAt: iso,
};

describe("engagementListRowSchema", () => {
  test("parses an engagement row joined with its client and counts", () => {
    const row = engagementListRowSchema.parse({
      ...engagement,
      clientName: client.legalName,
      docCounts: { total: 7, needsReview: 2 },
      openItems: 3,
    });

    expect(row.clientName).toBe("Northwind Partners LLC");
    expect(row.docCounts).toEqual({ total: 7, needsReview: 2 });
    expect(row.openItems).toBe(3);
    expect(row.filingType).toBe("1120-S");
  });

  test("rejects a row that lost its joined counts", () => {
    expect(() =>
      engagementListRowSchema.parse({ ...engagement, clientName: client.legalName, openItems: 0 }),
    ).toThrow();
  });
});

describe("documentListRowSchema", () => {
  test("parses a document row with the joined client and engagement labels", () => {
    const row = documentListRowSchema.parse({
      ...taxDocument,
      clientName: client.legalName,
      engagementLabel: "2025 1120-S",
      documentTypeName: "W-2",
    });

    expect(row.engagementId).toBe("eng-1");
    expect(row.engagementLabel).toBe("2025 1120-S");
    expect(row.documentTypeName).toBe("W-2");
  });

  test("documentTypeName is optional so an unclassified row still parses", () => {
    const row = documentListRowSchema.parse({
      ...taxDocument,
      pipelineStatus: "unclassified",
      clientName: client.legalName,
      engagementLabel: "2025 1120-S",
    });

    expect(row.documentTypeName).toBeUndefined();
  });
});

describe("inboxEntrySchema", () => {
  test("parses an activity joined with client name, portal token, and unread", () => {
    const entry = inboxEntrySchema.parse({
      ...activity,
      clientName: client.legalName,
      portalToken: engagement.portalToken,
      unread: true,
    });

    expect(entry.unread).toBe(true);
    expect(entry.portalToken).toBe("portal-token-1");
  });

  test("rejects an entry without the unread flag", () => {
    expect(() => inboxEntrySchema.parse({ ...activity, clientName: client.legalName })).toThrow();
  });
});

describe("metricsSchema", () => {
  test("parses the six live counters", () => {
    expect(
      metricsSchema.parse({
        documentsAutoProcessed: 12,
        fieldsAwaitingReview: 7,
        straightThroughRate: 86,
        needsReviewCount: 3,
        outstandingRequests: 2,
        activeClients: 4,
      }),
    ).toEqual({
      documentsAutoProcessed: 12,
      fieldsAwaitingReview: 7,
      straightThroughRate: 86,
      needsReviewCount: 3,
      outstandingRequests: 2,
      activeClients: 4,
    });
  });

  test("rejects negative counts and fractional counts", () => {
    const base = {
      documentsAutoProcessed: 0,
      fieldsAwaitingReview: 0,
      straightThroughRate: 0,
      needsReviewCount: 0,
      outstandingRequests: 0,
      activeClients: 0,
    };

    expect(() => metricsSchema.parse({ ...base, needsReviewCount: -1 })).toThrow();
    expect(() => metricsSchema.parse({ ...base, straightThroughRate: -20 })).toThrow();
    expect(() => metricsSchema.parse({ ...base, fieldsAwaitingReview: 1.5 })).toThrow();
  });
});

describe("portalStateSchema", () => {
  test("parses the coarse client-facing checklist", () => {
    const state = portalStateSchema.parse({
      firmName: FIRM_NAME,
      clientName: client.legalName,
      taxYear: 2025,
      filingType: "1065",
      items: [
        {
          id: "item-1",
          title: "2025 W-2s",
          description: "Every W-2 issued by the entity.",
          required: true,
          portalStatus: "waiting",
        },
        {
          id: "item-2",
          title: "Bank statements",
          description: "December closing statements.",
          required: false,
          portalStatus: "needs-attention",
        },
      ],
    });

    expect(state.firmName).toBe(FIRM_NAME);
    expect(state.items.map((item) => item.portalStatus)).toEqual(["waiting", "needs-attention"]);
  });

  test("rejects a pipeline status leaking into the portal payload", () => {
    expect(() =>
      portalStateSchema.parse({
        firmName: FIRM_NAME,
        clientName: client.legalName,
        taxYear: 2025,
        filingType: "1065",
        items: [
          {
            id: "item-1",
            title: "2025 W-2s",
            description: "Every W-2 issued by the entity.",
            required: true,
            portalStatus: "extracting",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("engagementDetailSchema", () => {
  test("parses the workspace aggregate", () => {
    const detail = engagementDetailSchema.parse({
      engagement,
      client,
      requestItems: [requestItem],
      documents: [taxDocument],
      activity: [activity],
    });

    expect(detail.engagement.id).toBe("eng-1");
    expect(detail.client.legalName).toBe("Northwind Partners LLC");
    expect(detail.requestItems).toHaveLength(1);
    expect(detail.documents).toHaveLength(1);
    expect(detail.activity).toHaveLength(1);
  });

  test("rejects a detail payload missing its client", () => {
    expect(() =>
      engagementDetailSchema.parse({
        engagement,
        requestItems: [],
        documents: [],
        activity: [],
      }),
    ).toThrow();
  });
});
