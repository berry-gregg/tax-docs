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

const secondClient: Client = {
  id: "client-docs-routes-2",
  legalName: "Sierra Outfitters Inc",
  entityType: "partnership",
  ein: "98-7654321",
  contactName: "Ola Berg",
  contactEmail: "ola@sierra.example",
  city: "Boise",
  state: "ID",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Two clients, two engagements (2026 1065 vs 2025 1120-S), two documents:
 * doc-newer (client one, classified P&L, needs-review, created later) and
 * doc-older (client two, unclassified, trusted, created earlier).
 */
async function seedFilterFixtures(app: ReturnType<typeof createApp>) {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(secondClient));

  const engagementOne = await createEngagement(app);
  const secondResponse = await app.request("/api/engagements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: secondClient.id,
      taxYear: 2025,
      filingType: "1120-S",
      items: [],
    }),
  });
  expect(secondResponse.status).toBe(201);
  const engagementTwo = (await secondResponse.json() as { engagement: Engagement }).engagement;

  await insertDocument({
    id: "doc-newer",
    engagementId: engagementOne.id,
    filename: "pl.pdf",
    mimeType: "application/pdf",
    size: 12,
    storagePath: "data/uploads/doc-newer.pdf",
    uploadedBy: "cpa",
    pipelineStatus: "needs-review",
    classification: { documentTypeId: "dt-profit-loss", confidence: 0.9, reasoning: "Looks like a P&L" },
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
  });
  await insertDocument({
    id: "doc-older",
    engagementId: engagementTwo.id,
    filename: "k1.pdf",
    mimeType: "application/pdf",
    size: 12,
    storagePath: "data/uploads/doc-older.pdf",
    uploadedBy: "client",
    pipelineStatus: "trusted",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });

  return { engagementOne, engagementTwo };
}

async function listIds(app: ReturnType<typeof createApp>, url: string): Promise<string[]> {
  const response = await app.request(url);
  expect(response.status).toBe(200);
  const body = await response.json() as { documents: Array<{ id: string }> };
  expect(() => documentListResponseSchema.parse(body)).not.toThrow();
  return body.documents.map((row) => row.id);
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
      documentId: body.document.id,
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

  test("trust auto-accepts unreviewed fields while keeping human edits attributed", async () => {
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

    const editEin = await app.request(`/api/documents/${document.id}/fields/ein`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", value: "98-7654321" }),
    });
    expect(editEin.status).toBe(200);

    const unknownField = await app.request(`/api/documents/${document.id}/fields/missing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", value: "x" }),
    });
    expect(unknownField.status).toBe(404);

    // Wages is still unreviewed: trusting the document is the review, so it succeeds and
    // finalizes the untouched field as accepted.
    const trusted = await app.request(`/api/documents/${document.id}/trust`, { method: "POST" });
    const trustedBody = await trusted.json() as { document: TaxDocument };
    expect(trusted.status).toBe(200);
    expect(trustedBody.document.pipelineStatus).toBe("trusted");
    const trustedFields = trustedBody.document.extraction?.fields ?? [];
    expect(trustedFields.find((field) => field.key === "wages")).toMatchObject({
      reviewStatus: "accepted",
    });
    expect(trustedFields.find((field) => field.key === "ein")).toMatchObject({
      reviewStatus: "edited",
      editedValue: "98-7654321",
    });

    const db = await connectDb();
    const activity = await activitiesCollection(db).findOne({
      engagementId: engagement.id,
      action: "document-trusted",
    });
    expect(activity).toMatchObject({ actor: "cpa" });

    const afterTrustEdit = await app.request(`/api/documents/${document.id}/fields/wages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", value: 1 }),
    });
    expect(afterTrustEdit.status).toBe(409);
    expect(started).toEqual([]);
  });

  test("the accept field action no longer exists: editing is the only per-field mutation", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const document = await insertDocument({
      id: "doc-no-accept",
      engagementId: engagement.id,
      filename: "pl.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-no-accept.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "needs-review",
      extraction: { fields: [wagesField] },
    });

    const accept = await app.request(`/api/documents/${document.id}/fields/wages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    const acceptBody = await accept.json() as { error: string };
    expect(accept.status).toBe(400);
    // The Zod summary names the only action the route still accepts.
    expect(acceptBody.error).toContain('"edit"');

    const db = await connectDb();
    const stored = await taxDocumentsCollection(db).findOne({ _id: document.id });
    const fields = (stored?.extraction as { fields: Array<{ reviewStatus: string }> }).fields;
    expect(fields[0]?.reviewStatus).toBe("unreviewed");
  });

  test("refuses to trust a document whose extraction returned no fields", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    const document = await insertDocument({
      id: "doc-empty-extraction",
      engagementId: engagement.id,
      filename: "blank.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-empty-extraction.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "needs-review",
      extraction: { fields: [] },
    });

    const response = await app.request(`/api/documents/${document.id}/trust`, { method: "POST" });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("extraction returned no fields");

    const db = await connectDb();
    const stored = await taxDocumentsCollection(db).findOne({ _id: document.id });
    expect(stored?.pipelineStatus).toBe("needs-review");
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

  test("list filters narrow by client, tax year, document type, and engagement", async () => {
    const app = createApp();
    const { engagementOne, engagementTwo } = await seedFilterFixtures(app);

    const byClient = await listIds(app, `/api/documents?clientId=${client.id}`);
    expect(byClient).toEqual(["doc-newer"]);

    const byOtherClient = await listIds(app, `/api/documents?clientId=${secondClient.id}`);
    expect(byOtherClient).toEqual(["doc-older"]);

    const byYear = await listIds(app, "/api/documents?taxYear=2025");
    expect(byYear).toEqual(["doc-older"]);

    const byType = await listIds(app, "/api/documents?documentTypeId=dt-profit-loss");
    expect(byType).toEqual(["doc-newer"]);

    const byEngagement = await listIds(app, `/api/documents?engagementId=${engagementTwo.id}`);
    expect(byEngagement).toEqual(["doc-older"]);

    // clientId and taxYear that point at different engagements intersect to nothing.
    const mismatch = await listIds(app, `/api/documents?clientId=${client.id}&taxYear=2025`);
    expect(mismatch).toEqual([]);

    // group still composes with the new filters.
    const approvedForClient = await listIds(app, `/api/documents?group=approved&clientId=${client.id}`);
    expect(approvedForClient).toEqual([]);
    const approvedForOther = await listIds(app, `/api/documents?group=approved&clientId=${secondClient.id}`);
    expect(approvedForOther).toEqual(["doc-older"]);
    expect(engagementOne.id).not.toBe(engagementTwo.id);
  });

  test("list sorts newest first by default and oldest first on request", async () => {
    const app = createApp();
    await seedFilterFixtures(app);

    const defaultOrder = await listIds(app, "/api/documents");
    expect(defaultOrder).toEqual(["doc-newer", "doc-older"]);

    const oldest = await listIds(app, "/api/documents?sort=oldest");
    expect(oldest).toEqual(["doc-older", "doc-newer"]);

    const newest = await listIds(app, "/api/documents?sort=newest");
    expect(newest).toEqual(["doc-newer", "doc-older"]);
  });

  test("rejects invalid list query params with a real message", async () => {
    const app = createApp();

    const badYear = await app.request("/api/documents?taxYear=abc");
    const badYearBody = await badYear.json() as { error: string };
    expect(badYear.status).toBe(400);
    expect(badYearBody.error.toLowerCase()).toContain("number");

    const badSort = await app.request("/api/documents?sort=upside-down");
    const badSortBody = await badSort.json() as { error: string };
    expect(badSort.status).toBe(400);
    expect(badSortBody.error).toContain("Invalid enum value");
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
