import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { portalStateSchema } from "../../src/shared/schemas/api.ts";
import { requestItemSchema, type RequestItem } from "../../src/shared/schemas/request.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import type { TaxDocument } from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";

const client: Client = {
  id: "client-portal-routes",
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

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    clientsCollection(db).deleteMany({}),
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

async function requestItemFor(engagementId: string): Promise<RequestItem> {
  const db = await connectDb();
  const doc = await requestItemsCollection(db).findOne({ engagementId });
  if (!doc) {
    throw new Error("expected request item");
  }
  return fromStored(requestItemSchema, doc);
}

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

describe("portal routes", () => {
  test("returns coarse portal status and never leaks extraction confidence", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const db = await connectDb();
    const planted: TaxDocument = {
      id: "doc-portal-leak",
      engagementId: engagement.id,
      requestItemId: item.id,
      filename: "pl.pdf",
      mimeType: "application/pdf",
      size: 40,
      storagePath: "data/uploads/doc-portal-leak.pdf",
      uploadedBy: "client",
      pipelineStatus: "needs-review",
      classification: {
        documentTypeId: "dt-profit-loss",
        confidence: 0.94,
        reasoning: "Matches P&L layout",
      },
      extraction: {
        fields: [{
          key: "revenue",
          label: "Revenue",
          metadataType: "dollar-amount",
          dataType: "double",
          value: 50000,
          confidence: 0.87,
          sourceSnippet: "Revenue 50000",
          notFound: false,
          regexPass: true,
          reviewStatus: "unreviewed",
        }],
      },
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    await taxDocumentsCollection(db).insertOne(toStored(planted));
    await requestItemsCollection(db).updateOne(
      { _id: item.id },
      { $set: { matchedDocumentIds: [planted.id] } },
    );

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = await response.json() as {
      firmName: string;
      clientName: string;
      taxYear: number;
      filingType: string;
      items: Array<{ id: string; title: string; description: string; required: boolean; portalStatus: string }>;
    };

    expect(response.status).toBe(200);
    expect(() => portalStateSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      firmName: "Tax Docs LLP",
      clientName: client.legalName,
      taxYear: 2026,
      filingType: "1065",
    });
    expect(body.items).toEqual([
      {
        id: item.id,
        title: explicitItem.title,
        description: explicitItem.description,
        required: true,
        portalStatus: "received",
      },
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain("extraction");
    expect(serialized).not.toContain("reasoning");
  });

  test("unknown portal token returns 404 never 403", async () => {
    const app = createApp();
    const response = await app.request("/api/portal/unknown-token");
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(body).toEqual({ error: "Not found" });
  });

  test("portal upload marks inbound activity and maps the item to processing", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const waiting = await app.request(`/api/portal/${engagement.portalToken}`);
    const waitingBody = await waiting.json() as { items: Array<{ portalStatus: string }> };
    expect(waitingBody.items[0].portalStatus).toBe("waiting");

    const form = new FormData();
    form.set("file", new File([pdfBytes], "client-pl.pdf", { type: "application/pdf" }));
    form.set("requestItemId", item.id);

    const upload = await app.request(`/api/portal/${engagement.portalToken}/upload`, {
      method: "POST",
      body: form,
    });
    const uploaded = await upload.json() as { document: TaxDocument };

    expect(upload.status).toBe(201);
    expect(uploaded.document).toMatchObject({
      engagementId: engagement.id,
      requestItemId: item.id,
      uploadedBy: "client",
      pipelineStatus: "received",
    });
    expect(started).toEqual([uploaded.document.id]);
    storagePaths.push(uploaded.document.storagePath);

    const db = await connectDb();
    const activity = await activitiesCollection(db).findOne({
      engagementId: engagement.id,
      action: "document-uploaded",
      direction: "inbound",
    });
    expect(activity).toMatchObject({ actor: "client" });

    const after = await app.request(`/api/portal/${engagement.portalToken}`);
    const afterBody = await after.json() as { items: Array<{ portalStatus: string }> };
    expect(afterBody.items[0].portalStatus).toBe("processing");
  });

  test("portal upload of an unknown token is 404", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const form = new FormData();
    form.set("file", new File([pdfBytes], "client-pl.pdf", { type: "application/pdf" }));

    const response = await app.request("/api/portal/missing-token/upload", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(started).toEqual([]);
  });

  test("rejected matched documents surface as needs-attention", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);
    const db = await connectDb();
    await taxDocumentsCollection(db).insertOne(toStored({
      id: "doc-rejected",
      engagementId: engagement.id,
      requestItemId: item.id,
      filename: "lease.pdf",
      mimeType: "application/pdf",
      size: 12,
      storagePath: "data/uploads/doc-rejected.pdf",
      uploadedBy: "client",
      pipelineStatus: "rejected",
      rejection: { kind: "irrelevant", reason: "Residential lease" },
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    }));
    await requestItemsCollection(db).updateOne(
      { _id: item.id },
      { $set: { status: "needs-attention", matchedDocumentIds: ["doc-rejected"] } },
    );

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = await response.json() as { items: Array<{ portalStatus: string }> };
    expect(body.items[0].portalStatus).toBe("needs-attention");
    expect(JSON.stringify(body)).not.toContain("confidence");
  });
});
