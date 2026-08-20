import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  documentTypesCollection,
  engagementsCollection,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { readStoredFile } from "../../src/server/files/storage.ts";
import { documentListResponseSchema } from "../../src/shared/schemas/api.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import type { TaxDocument } from "../../src/shared/schemas/document.ts";
import type { DocumentType } from "../../src/shared/schemas/document-type.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";
import { MAX_UPLOAD_BYTES } from "../../src/shared/constants.ts";

const client: Client = {
  id: "client-docs-routes",
  legalName: "Bluebird Robotics LLC",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Maya Chen",
  contactEmail: "maya@bluebird.example",
  city: "Denver",
  state: "CO",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const explicitItem = {
  documentTypeId: "dt-profit-loss",
  title: "Custom P&L",
  description: "Management-prepared P&L for the tax year.",
  required: true,
} as const;

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

const storagePaths: string[] = [];

function recordingRunner() {
  const started: string[] = [];
  return {
    started,
    runner: { start(documentId: string) { started.push(documentId); } },
  };
}

function pdfFile(name = "profit-loss.pdf") {
  return new File([pdfBytes], name, { type: "application/pdf" });
}

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    clientsCollection(db).deleteMany({}),
    documentTypesCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
}

async function seedClient() {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(client));
}

async function createEngagement(app: ReturnType<typeof createApp>) {
  const response = await app.request("/api/engagements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: client.id,
      taxYear: 2026,
      filingType: "1065",
      items: [explicitItem],
    }),
  });
  const body = await response.json() as { engagement: Engagement };
  expect(response.status).toBe(201);
  return body.engagement;
}

async function insertDocument(partial: Omit<TaxDocument, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
}) {
  const now = "2026-04-01T00:00:00.000Z";
  const document: TaxDocument = {
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  const db = await connectDb();
  await taxDocumentsCollection(db).insertOne(toStored(document));
  return document;
}

const wagesField = {
  key: "wages",
  label: "Wages",
  metadataType: "dollar-amount" as const,
  dataType: "double" as const,
  value: 120000,
  confidence: 0.91,
  sourceSnippet: "Wages 120000",
  notFound: false,
  regexPass: true,
  reviewStatus: "unreviewed" as const,
};

const einField = {
  key: "ein",
  label: "EIN",
  metadataType: "ein-tin" as const,
  dataType: "string" as const,
  value: "12-3456789",
  confidence: 0.88,
  sourceSnippet: "EIN 12-3456789",
  notFound: false,
  regexPass: true,
  reviewStatus: "unreviewed" as const,
};

beforeEach(async () => {
  storagePaths.length = 0;
  await clearCollections();
  await seedClient();
});

afterEach(async () => {
  await Promise.all(storagePaths.map((path) => unlink(path).catch(() => undefined)));
  await clearCollections();
  await disconnectDb();
});

describe("document routes", () => {
  test("CPA upload stores a PDF, records activity, and starts the runner", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);

    const form = new FormData();
    form.set("file", pdfFile());
    form.set("engagementId", engagement.id);

    const response = await app.request("/api/documents", { method: "POST", body: form });
    const body = await response.json() as { document: TaxDocument };

    expect(response.status).toBe(201);
    expect(body.document).toMatchObject({
      engagementId: engagement.id,
      filename: "profit-loss.pdf",
      mimeType: "application/pdf",
      uploadedBy: "cpa",
      pipelineStatus: "received",
    });
    expect(started).toEqual([body.document.id]);

    const stored = await readStoredFile(body.document.storagePath);
    expect(stored).toEqual(pdfBytes);
    storagePaths.push(body.document.storagePath);

    const db = await connectDb();
    const activity = await activitiesCollection(db).findOne({
      engagementId: engagement.id,
      action: "document-uploaded",
    });
    expect(activity).toMatchObject({
      actor: "cpa",
      direction: "internal",
    });
  });

  test("rejects a non-PDF upload with an explicit PDF message", async () => {
    const { runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);

    const form = new FormData();
    form.set("file", new File(["not a pdf"], "notes.txt", { type: "text/plain" }));
    form.set("engagementId", engagement.id);

    const response = await app.request("/api/documents", { method: "POST", body: form });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("PDF");
  });

  test("rejects an oversized upload with an explicit size message", async () => {
    const { runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);

    const form = new FormData();
    form.set("file", new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.pdf", { type: "application/pdf" }));
    form.set("engagementId", engagement.id);

    const response = await app.request("/api/documents", { method: "POST", body: form });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(400);
    expect(body.error.toLowerCase()).toMatch(/large|size|exceed/);
  });

  test("lists documents grouped by pipeline status with joined labels", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const documentType: DocumentType = {
      id: "dt-profit-loss",
      name: "Profit & Loss",
      description: "Income statement",
      active: true,
      createdBy: "seed",
      fields: [{
        key: "revenue",
        label: "Revenue",
        metadataType: "dollar-amount",
        dataType: "double",
        required: true,
        description: "Total revenue",
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const db = await connectDb();
    await documentTypesCollection(db).insertOne(toStored(documentType));

    await insertDocument({
      id: "doc-needs-review",
      engagementId: engagement.id,
      filename: "pl.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-needs-review.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "needs-review",
      classification: { documentTypeId: documentType.id, confidence: 0.9, reasoning: "Looks like a P&L" },
    });
    await insertDocument({
      id: "doc-unclassified",
      engagementId: engagement.id,
      filename: "mystery.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-unclassified.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "unclassified",
    });
    await insertDocument({
      id: "doc-trusted",
      engagementId: engagement.id,
      filename: "k1.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-trusted.pdf",
      uploadedBy: "client",
      pipelineStatus: "trusted",
    });
    await insertDocument({
      id: "doc-received",
      engagementId: engagement.id,
      filename: "941.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-received.pdf",
      uploadedBy: "client",
      pipelineStatus: "received",
    });

    const needsReview = await app.request("/api/documents?group=needs-review");
    const needsReviewBody = await needsReview.json() as { documents: Array<{ id: string }> };
    expect(needsReview.status).toBe(200);
    expect(() => documentListResponseSchema.parse(needsReviewBody)).not.toThrow();
    expect(needsReviewBody.documents.map((row) => row.id).sort()).toEqual([
      "doc-needs-review",
      "doc-unclassified",
    ]);
    expect(needsReviewBody.documents[0]).toMatchObject({
      clientName: client.legalName,
      engagementLabel: "2026 1065",
    });
    expect(needsReviewBody.documents.find((row) => row.id === "doc-needs-review")).toMatchObject({
      documentTypeName: "Profit & Loss",
    });

    const approved = await app.request("/api/documents?group=approved");
    const approvedBody = await approved.json() as { documents: Array<{ id: string }> };
    expect(approvedBody.documents.map((row) => row.id)).toEqual(["doc-trusted"]);

    const all = await app.request("/api/documents?group=all");
    const allBody = await all.json() as { documents: Array<{ id: string }> };
    expect(allBody.documents).toHaveLength(4);
  });

  test("returns document detail with document type and streams the PDF", async () => {
    const { runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);

    const form = new FormData();
    form.set("file", pdfFile("wages.pdf"));
    form.set("engagementId", engagement.id);
    const upload = await app.request("/api/documents", { method: "POST", body: form });
    const uploaded = await upload.json() as { document: TaxDocument };
    storagePaths.push(uploaded.document.storagePath);

    const missing = await app.request("/api/documents/missing-doc");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });

    const detail = await app.request(`/api/documents/${uploaded.document.id}`);
    const detailBody = await detail.json() as { document: TaxDocument; documentType?: unknown };
    expect(detail.status).toBe(200);
    expect(detailBody.document.id).toBe(uploaded.document.id);
    expect(detailBody.documentType).toBeUndefined();

    const fileResponse = await app.request(`/api/documents/${uploaded.document.id}/file`);
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await fileResponse.arrayBuffer())).toEqual(pdfBytes);
  });

  test("trusts a document only after every field is reviewed while needs-review", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    const document = await insertDocument({
      id: "doc-trust-gate",
      engagementId: engagement.id,
      filename: "pl.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-trust-gate.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "needs-review",
      extraction: { fields: [wagesField, einField] },
    });

    const blockedTrust = await app.request(`/api/documents/${document.id}/trust`, { method: "POST" });
    const blockedBody = await blockedTrust.json() as { error: string };
    expect(blockedTrust.status).toBe(409);
    expect(blockedBody.error).toContain("unreviewed fields remain");

    const acceptWages = await app.request(`/api/documents/${document.id}/fields/wages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    expect(acceptWages.status).toBe(200);

    const editEin = await app.request(`/api/documents/${document.id}/fields/ein`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", value: "98-7654321" }),
    });
    expect(editEin.status).toBe(200);

    const unknownField = await app.request(`/api/documents/${document.id}/fields/missing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    expect(unknownField.status).toBe(404);

    const trusted = await app.request(`/api/documents/${document.id}/trust`, { method: "POST" });
    const trustedBody = await trusted.json() as { document: TaxDocument };
    expect(trusted.status).toBe(200);
    expect(trustedBody.document.pipelineStatus).toBe("trusted");

    const db = await connectDb();
    const activity = await activitiesCollection(db).findOne({
      engagementId: engagement.id,
      action: "document-trusted",
    });
    expect(activity).toMatchObject({ actor: "cpa" });

    const afterTrustEdit = await app.request(`/api/documents/${document.id}/fields/wages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    expect(afterTrustEdit.status).toBe(409);
    expect(started).toEqual([]);
  });

  test("rerun resets a failed document and restarts the runner", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    const document = await insertDocument({
      id: "doc-failed",
      engagementId: engagement.id,
      filename: "broken.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-failed.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "failed",
      failure: { message: "OpenRouter timed out" },
      rejection: { kind: "unreadable", reason: "blurry scan" },
    });

    const response = await app.request(`/api/documents/${document.id}/rerun`, { method: "POST" });
    const body = await response.json() as { document: TaxDocument };

    expect(response.status).toBe(200);
    expect(body.document.pipelineStatus).toBe("received");
    expect(body.document.failure).toBeUndefined();
    expect(body.document.rejection).toBeUndefined();
    expect(started).toEqual([document.id]);
  });

  test("rerun is refused unless the document failed, is unclassified, or was rejected", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    await insertDocument({
      id: "doc-trusted-rerun",
      engagementId: engagement.id,
      filename: "ok.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-trusted-rerun.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "trusted",
    });

    const response = await app.request("/api/documents/doc-trusted-rerun/rerun", { method: "POST" });
    expect(response.status).toBe(409);
    expect(started).toEqual([]);
  });
});
