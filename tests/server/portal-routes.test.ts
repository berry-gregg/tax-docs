import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  documentTypesCollection,
  engagementsCollection,
  fromStored,
  messagesCollection,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { insertMessage, listMessages } from "../../src/server/db/messages.ts";
import { messageSchema, type Message } from "../../src/shared/schemas/message.ts";
import { portalStateSchema, type PortalState } from "../../src/shared/schemas/api.ts";
import { requestItemSchema, type RequestItem } from "../../src/shared/schemas/request.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import type { DocumentType } from "../../src/shared/schemas/document-type.ts";
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

const portalDocType: DocumentType = {
  id: "dt-portal-routes-pl",
  name: "Profit and loss",
  description: "Management-prepared profit and loss statement.",
  active: true,
  createdBy: "seed",
  fields: [
    {
      key: "revenue",
      label: "Revenue",
      metadataType: "dollar-amount",
      dataType: "double",
      required: true,
      description: "Total revenue for the year.",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const explicitItem = {
  documentTypeId: portalDocType.id,
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
    runner: { start(documentId: string) { started.push(documentId); }, startReclassify() {} },
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
    messagesCollection(db).deleteMany({}),
    documentTypesCollection(db).deleteMany({ _id: portalDocType.id }),
  ]);
}

async function seedClientAndType() {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(client));
  await documentTypesCollection(db).insertOne(toStored(portalDocType));
}

async function createEngagement(
  app: ReturnType<typeof createApp>,
  items: ReadonlyArray<Record<string, unknown>> = [explicitItem],
) {
  const response = await app.request("/api/engagements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: client.id,
      taxYear: 2026,
      filingType: "1065",
      items,
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

function plantedDocument(overrides: Partial<TaxDocument> & Pick<TaxDocument, "id">): TaxDocument {
  return {
    engagementId: "unset",
    filename: "planted.pdf",
    mimeType: "application/pdf",
    size: 40,
    storagePath: `data/uploads/${overrides.id}.pdf`,
    uploadedBy: "client",
    pipelineStatus: "received",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  storagePaths.length = 0;
  await clearCollections();
  await seedClientAndType();
});

afterEach(async () => {
  await Promise.all(storagePaths.map((path) => unlink(path).catch(() => undefined)));
  await clearCollections();
  await disconnectDb();
});

describe("portal state", () => {
  test("returns coarse portal status and never leaks extraction confidence", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const db = await connectDb();
    const planted = plantedDocument({
      id: "doc-portal-leak",
      engagementId: engagement.id,
      requestItemId: item.id,
      filename: "pl.pdf",
      pipelineStatus: "needs-review",
      classification: {
        documentTypeId: portalDocType.id,
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
    });
    await taxDocumentsCollection(db).insertOne(toStored(planted));
    await requestItemsCollection(db).updateOne(
      { _id: item.id },
      { $set: { matchedDocumentIds: [planted.id] } },
    );

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = await response.json() as PortalState;

    expect(response.status).toBe(200);
    expect(() => portalStateSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      firmName: "Tax Docs LLP",
      clientName: client.legalName,
      taxYear: 2026,
      filingType: "1065",
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: item.id,
      title: explicitItem.title,
      description: explicitItem.description,
      required: true,
      portalStatus: "received",
      status: "open",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain("extraction");
    expect(serialized).not.toContain("reasoning");
  });

  test("nests matched documents under their item with a resolved type name", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const db = await connectDb();
    const planted = plantedDocument({
      id: "doc-portal-nested",
      engagementId: engagement.id,
      filename: "pl-2026.pdf",
      pipelineStatus: "needs-review",
      classification: {
        documentTypeId: portalDocType.id,
        confidence: 0.94,
        reasoning: "Matches P&L layout",
      },
    });
    await taxDocumentsCollection(db).insertOne(toStored(planted));
    await requestItemsCollection(db).updateOne(
      { _id: item.id },
      { $set: { status: "received", matchedDocumentIds: [planted.id] } },
    );

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = portalStateSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.items[0]?.status).toBe("received");
    expect(body.items[0]?.documents).toEqual([
      {
        id: planted.id,
        filename: "pl-2026.pdf",
        pipelineStatus: "needs-review",
        documentTypeName: "Profit and loss",
        uploadedAt: planted.createdAt,
      },
    ]);
    expect(body.unmatched).toEqual([]);
  });

  test("lists client uploads not matched to any item in unmatched, never cpa uploads", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);

    const db = await connectDb();
    const inFlight = plantedDocument({
      id: "doc-portal-inflight",
      engagementId: engagement.id,
      filename: "mystery.pdf",
      pipelineStatus: "classifying",
    });
    const cpaUpload = plantedDocument({
      id: "doc-portal-cpa",
      engagementId: engagement.id,
      filename: "internal.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "received",
    });
    await taxDocumentsCollection(db).insertOne(toStored(inFlight));
    await taxDocumentsCollection(db).insertOne(toStored(cpaUpload));

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = portalStateSchema.parse(await response.json());

    expect(body.items[0]?.documents).toEqual([]);
    expect(body.unmatched).toEqual([
      {
        id: inFlight.id,
        filename: "mystery.pdf",
        pipelineStatus: "classifying",
        documentTypeName: null,
        uploadedAt: inFlight.createdAt,
      },
    ]);
  });

  test("unknown portal token returns 404 never 403", async () => {
    const app = createApp();
    const response = await app.request("/api/portal/unknown-token");
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(body).toEqual({ error: "Not found" });
  });

  test("lists required items first, each group alphabetical by title", async () => {
    const app = createApp();
    const engagement = await createEngagement(app, [
      { ...explicitItem, title: "Zeta ledger", required: true },
      { ...explicitItem, title: "Alpha statements", required: false },
      { ...explicitItem, title: "Alpha ledger", required: true },
      { ...explicitItem, title: "Beta receipts", required: false },
    ]);

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = portalStateSchema.parse(await response.json());

    expect(body.items.map((item) => item.title)).toEqual([
      "Alpha ledger",
      "Zeta ledger",
      "Alpha statements",
      "Beta receipts",
    ]);
  });
});

describe("portal messages", () => {
  test("portal state carries the full thread oldest first and marks CPA messages read", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const db = await connectDb();
    const fromCpa = await insertMessage(db, {
      engagementId: engagement.id,
      sender: "cpa",
      body: "Please add the December statement",
    });
    const fromClient = await insertMessage(db, {
      engagementId: engagement.id,
      sender: "client",
      body: "Uploading it tonight",
    });

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = portalStateSchema.parse(await response.json());

    expect(response.status).toBe(200);
    // The engagement's opening request message may lead the thread; ours follow in insert order.
    expect(body.messages.map((message) => message.id).slice(-2)).toEqual([
      fromCpa.id,
      fromClient.id,
    ]);
    const createdAts = body.messages.map((message) => message.createdAt);
    expect([...createdAts].sort()).toEqual(createdAts);

    // Fetching the portal means the client saw the firm's messages — and only those.
    const stored = await listMessages(db, engagement.id);
    expect(stored.filter((message) => message.sender === "cpa").every((m) => m.readAt)).toBe(true);
    expect(stored.find((message) => message.id === fromClient.id)?.readAt).toBeUndefined();
  });

  test("posting a message inserts a client message and returns 201", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);

    const response = await app.request(`/api/portal/${engagement.portalToken}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Is the prior-year return needed too?" }),
    });
    const payload = await response.json() as { message: Message };

    expect(response.status).toBe(201);
    expect(() => messageSchema.parse(payload.message)).not.toThrow();
    expect(payload.message).toMatchObject({
      engagementId: engagement.id,
      sender: "client",
      body: "Is the prior-year return needed too?",
    });

    const db = await connectDb();
    const stored = await listMessages(db, engagement.id);
    expect(
      stored.filter((message) => message.sender === "client").map((message) => message.id),
    ).toEqual([payload.message.id]);
  });

  test("an empty or over-long message body is a 400 with the zod summary", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);

    const empty = await app.request(`/api/portal/${engagement.portalToken}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "   " }),
    });
    expect(empty.status).toBe(400);

    const overlong = await app.request(`/api/portal/${engagement.portalToken}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "x".repeat(2001) }),
    });
    expect(overlong.status).toBe(400);
    const overlongBody = await overlong.json() as { error: string };
    expect(overlongBody.error.length).toBeGreaterThan(0);

    const db = await connectDb();
    const stored = await listMessages(db, engagement.id);
    expect(stored.filter((message) => message.sender === "client")).toEqual([]);
  });

  test("posting a message with an unknown token is 404, never 403", async () => {
    const app = createApp();
    const response = await app.request("/api/portal/wrong-token/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "hello" }),
    });

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});

describe("portal upload", () => {
  test("marks inbound activity, maps the item to processing, and surfaces the upload in unmatched", async () => {
    const { started, runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const waiting = await app.request(`/api/portal/${engagement.portalToken}`);
    const waitingBody = portalStateSchema.parse(await waiting.json());
    expect(waitingBody.items[0]?.portalStatus).toBe("waiting");

    const form = new FormData();
    form.set("file", new File([pdfBytes], "client-pl.pdf", { type: "application/pdf" }));

    const upload = await app.request(`/api/portal/${engagement.portalToken}/upload`, {
      method: "POST",
      body: form,
    });
    const uploaded = await upload.json() as { document: TaxDocument };

    expect(upload.status).toBe(201);
    expect(uploaded.document).toMatchObject({
      engagementId: engagement.id,
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
    expect(activity).toMatchObject({ actor: "client", documentId: uploaded.document.id });

    const after = await app.request(`/api/portal/${engagement.portalToken}`);
    const afterBody = portalStateSchema.parse(await after.json());
    expect(afterBody.items[0]?.id).toBe(item.id);
    expect(afterBody.unmatched.map((doc) => doc.id)).toEqual([uploaded.document.id]);
    expect(afterBody.unmatched[0]?.pipelineStatus).toBe("received");
  });

  test("upload with an unknown token is 404", async () => {
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
    await taxDocumentsCollection(db).insertOne(toStored(plantedDocument({
      id: "doc-rejected",
      engagementId: engagement.id,
      requestItemId: item.id,
      filename: "lease.pdf",
      pipelineStatus: "rejected",
      rejection: { kind: "irrelevant", reason: "Residential lease" },
    })));
    await requestItemsCollection(db).updateOne(
      { _id: item.id },
      { $set: { status: "needs-attention", matchedDocumentIds: ["doc-rejected"] } },
    );

    const response = await app.request(`/api/portal/${engagement.portalToken}`);
    const body = portalStateSchema.parse(await response.json());
    expect(body.items[0]?.portalStatus).toBe("needs-attention");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain("Residential lease");
  });
});

describe("portal waive", () => {
  test("waives an open item with a note and writes client activity", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const response = await app.request(
      `/api/portal/${engagement.portalToken}/items/${item.id}/waive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "The entity had no payroll this year" }),
      },
    );
    const body = await response.json() as { item: { status: string; waiveNote?: string } };

    expect(response.status).toBe(200);
    expect(body.item.status).toBe("waived");
    expect(body.item.waiveNote).toBe("The entity had no payroll this year");

    const db = await connectDb();
    const stored = fromStored(
      requestItemSchema,
      (await requestItemsCollection(db).findOne({ _id: item.id }))!,
    );
    expect(stored.status).toBe("waived");
    expect(stored.waiveNote).toBe("The entity had no payroll this year");

    const activity = await activitiesCollection(db).findOne({
      engagementId: engagement.id,
      action: "request-item-waived",
    });
    expect(activity).toMatchObject({
      actor: "client",
      direction: "inbound",
      requestItemId: item.id,
    });
    expect(String(activity?.detail)).toContain(item.title);
    expect(String(activity?.detail)).toContain("The entity had no payroll this year");
  });

  test("waiving a non-open item is 409 with a real message", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);
    const db = await connectDb();
    await requestItemsCollection(db).updateOne({ _id: item.id }, { $set: { status: "received" } });

    const response = await app.request(
      `/api/portal/${engagement.portalToken}/items/${item.id}/waive`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    const body = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("received");
  });

  test("waiving with an unknown token is 404", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const response = await app.request(`/api/portal/wrong-token/items/${item.id}/waive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  test("waiving an item from another engagement is 404, not 403", async () => {
    const app = createApp();
    const engagementA = await createEngagement(app);
    const engagementB = await createEngagement(app);
    const itemB = await requestItemFor(engagementB.id);

    const response = await app.request(
      `/api/portal/${engagementA.portalToken}/items/${itemB.id}/waive`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);

    const db = await connectDb();
    const stored = fromStored(
      requestItemSchema,
      (await requestItemsCollection(db).findOne({ _id: itemB.id }))!,
    );
    expect(stored.status).toBe("open");
  });

  test("an over-long note is a 400, not a truncation", async () => {
    const app = createApp();
    const engagement = await createEngagement(app);
    const item = await requestItemFor(engagement.id);

    const response = await app.request(
      `/api/portal/${engagement.portalToken}/items/${item.id}/waive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "x".repeat(501) }),
      },
    );

    expect(response.status).toBe(400);
  });
});

describe("portal file passthrough", () => {
  async function uploadThroughPortal(app: ReturnType<typeof createApp>, token: string) {
    const form = new FormData();
    form.set("file", new File([pdfBytes], "client-pl.pdf", { type: "application/pdf" }));
    const upload = await app.request(`/api/portal/${token}/upload`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(201);
    const { document } = await upload.json() as { document: TaxDocument };
    storagePaths.push(document.storagePath);
    return document;
  }

  test("serves the client's own uploaded PDF", async () => {
    const { runner } = recordingRunner();
    const app = createApp({ runner });
    const engagement = await createEngagement(app);
    const document = await uploadThroughPortal(app, engagement.portalToken);

    const response = await app.request(
      `/api/portal/${engagement.portalToken}/documents/${document.id}/file`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
  });

  test("a document from another engagement is 404, not 403", async () => {
    const { runner } = recordingRunner();
    const app = createApp({ runner });
    const engagementA = await createEngagement(app);
    const engagementB = await createEngagement(app);
    const documentA = await uploadThroughPortal(app, engagementA.portalToken);

    const response = await app.request(
      `/api/portal/${engagementB.portalToken}/documents/${documentA.id}/file`,
    );

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  test("an unknown token is 404", async () => {
    const app = createApp();
    const response = await app.request("/api/portal/wrong-token/documents/doc-x/file");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
