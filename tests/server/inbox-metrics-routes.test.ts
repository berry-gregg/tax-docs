import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  collectionNames,
  engagementsCollection,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { activitySchema } from "../../src/shared/schemas/activity.ts";
import { metricsSchema } from "../../src/shared/schemas/api.ts";
import { inboxThreadsResponseSchema, type InboxThread } from "../../src/shared/schemas/inbox.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import {
  extractionFieldSchema,
  taxDocumentSchema,
  type TaxDocument,
} from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";
import { requestItemSchema, type RequestItem } from "../../src/shared/schemas/request.ts";

const iso = "2026-01-01T00:00:00.000Z";

const client: Client = {
  id: "client-inbox-metrics",
  legalName: "Bluebird Robotics LLC",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Maya Chen",
  contactEmail: "maya@bluebird.example",
  city: "Denver",
  state: "CO",
  createdAt: iso,
};

const exportedClient: Client = {
  ...client,
  id: "client-exported-only",
  legalName: "Harbor Yarns LP",
};

const engagement: Engagement = {
  id: "eng-inbox-metrics",
  clientId: client.id,
  taxYear: 2026,
  filingType: "1120-S",
  status: "collecting",
  portalToken: "portal-inbox-token",
  createdAt: iso,
  updatedAt: iso,
};

const exportedEngagement: Engagement = {
  id: "eng-exported-only",
  clientId: exportedClient.id,
  taxYear: 2026,
  filingType: "1065",
  status: "exported",
  portalToken: "portal-exported-token",
  createdAt: iso,
  updatedAt: iso,
};

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

function activity(input: {
  id: string;
  action: string;
  direction: "inbound" | "outbound" | "internal";
  createdAt: string;
  engagementId?: string;
  readAt?: string;
  actor?: "agent" | "cpa" | "client";
  detail?: string;
  requestItemId?: string;
  documentId?: string;
}) {
  return activitySchema.parse({
    id: input.id,
    engagementId: input.engagementId ?? engagement.id,
    actor: input.actor ?? (input.direction === "inbound" ? "client" : "cpa"),
    action: input.action,
    detail: input.detail ?? input.action,
    direction: input.direction,
    createdAt: input.createdAt,
    ...(input.readAt ? { readAt: input.readAt } : {}),
    ...(input.requestItemId ? { requestItemId: input.requestItemId } : {}),
    ...(input.documentId ? { documentId: input.documentId } : {}),
  });
}

function field(reviewStatus: "unreviewed" | "accepted" | "edited", key: string) {
  return extractionFieldSchema.parse({
    key,
    label: key,
    metadataType: "dollar-amount",
    dataType: "double",
    value: 100,
    confidence: 0.9,
    sourceSnippet: `${key} 100`,
    notFound: false,
    regexPass: true,
    reviewStatus,
  });
}

function document(input: {
  id: string;
  pipelineStatus: TaxDocument["pipelineStatus"];
  fields?: TaxDocument["extraction"];
  filename?: string;
  requestItemId?: string;
  createdAt?: string;
}): TaxDocument {
  return taxDocumentSchema.parse({
    id: input.id,
    engagementId: engagement.id,
    filename: input.filename ?? `${input.id}.pdf`,
    mimeType: "application/pdf",
    size: 1200,
    storagePath: `data/uploads/${input.id}.pdf`,
    uploadedBy: "client",
    pipelineStatus: input.pipelineStatus,
    createdAt: input.createdAt ?? iso,
    updatedAt: input.createdAt ?? iso,
    ...(input.fields ? { extraction: input.fields } : {}),
    ...(input.requestItemId ? { requestItemId: input.requestItemId } : {}),
  });
}

function requestItem(input: {
  id: string;
  required: boolean;
  status: RequestItem["status"];
  title?: string;
  matchedDocumentIds?: string[];
  waiveNote?: string;
  createdAt?: string;
}): RequestItem {
  return requestItemSchema.parse({
    id: input.id,
    engagementId: engagement.id,
    documentTypeId: "dt-w2",
    title: input.title ?? input.id,
    description: "Request item",
    required: input.required,
    status: input.status,
    matchedDocumentIds: input.matchedDocumentIds ?? [],
    createdAt: input.createdAt ?? "2026-02-01T00:00:00.000Z",
    ...(input.waiveNote ? { waiveNote: input.waiveNote } : {}),
  });
}

beforeEach(async () => {
  await clearCollections();
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("inbox routes", () => {
  const internalOnlyEngagement: Engagement = {
    ...engagement,
    id: "eng-internal-only",
    portalToken: "portal-internal-token",
  };

  /**
   * Engagement A: four checklist items in every status, two uploads rolled into one received
   * item, one unread inbound update. Engagement B: a fully-read request. Engagement C: internal
   * activity only, so it must not surface as a thread.
   */
  async function seedThreads() {
    const db = await connectDb();
    await clientsCollection(db).insertMany([toStored(client), toStored(exportedClient)]);
    await engagementsCollection(db).insertMany([
      toStored(engagement),
      toStored(exportedEngagement),
      toStored(internalOnlyEngagement),
    ]);
    await requestItemsCollection(db).insertMany(
      [
        requestItem({
          id: "item-w2",
          required: true,
          status: "received",
          title: "W-2 forms",
          matchedDocumentIds: ["doc-w2-old", "doc-w2-new"],
        }),
        requestItem({
          id: "item-bs",
          required: true,
          status: "needs-attention",
          title: "Balance sheet",
        }),
        requestItem({ id: "item-open", required: true, status: "open", title: "Bank statements" }),
        requestItem({
          id: "item-waived",
          required: false,
          status: "waived",
          title: "Vehicle log",
          waiveNote: "Sold the truck in March",
        }),
      ].map((item) => toStored(item)),
    );
    await taxDocumentsCollection(db).insertMany(
      [
        document({
          id: "doc-w2-old",
          pipelineStatus: "trusted",
          filename: "w2-draft.pdf",
          requestItemId: "item-w2",
          createdAt: "2026-03-01T02:00:00.000Z",
        }),
        document({
          id: "doc-w2-new",
          pipelineStatus: "needs-review",
          filename: "w2-final.pdf",
          requestItemId: "item-w2",
          createdAt: "2026-03-03T01:00:00.000Z",
        }),
        document({
          id: "doc-bs",
          pipelineStatus: "rejected",
          filename: "balance-sheet.pdf",
          requestItemId: "item-bs",
          createdAt: "2026-03-02T00:00:00.000Z",
        }),
      ].map((doc) => toStored(doc)),
    );
    await activitiesCollection(db).insertMany(
      [
        activity({
          id: "act-request-sent",
          action: "request-sent",
          direction: "outbound",
          createdAt: "2026-03-01T00:00:00.000Z",
          readAt: "2026-03-01T00:05:00.000Z",
          detail: "4 items requested",
        }),
        activity({
          id: "act-upload-read",
          action: "document-uploaded",
          direction: "inbound",
          createdAt: "2026-03-01T02:00:00.000Z",
          readAt: "2026-03-01T03:00:00.000Z",
          documentId: "doc-w2-old",
          detail: "w2-draft.pdf",
        }),
        activity({
          id: "act-upload-unread",
          action: "document-uploaded",
          direction: "inbound",
          createdAt: "2026-03-03T01:00:00.000Z",
          documentId: "doc-w2-new",
          detail: "w2-final.pdf",
        }),
        activity({
          id: "act-match-unread",
          action: "checklist-item-matched",
          direction: "inbound",
          actor: "agent",
          createdAt: "2026-03-03T02:00:00.000Z",
          requestItemId: "item-w2",
          detail: "W-2 forms — w2-final.pdf",
        }),
        activity({
          id: "act-internal",
          action: "document-failed",
          direction: "internal",
          createdAt: "2026-03-04T00:00:00.000Z",
        }),
        activity({
          id: "act-engine",
          action: "sent-to-engine",
          direction: "outbound",
          createdAt: "2026-03-05T00:00:00.000Z",
          readAt: "2026-03-05T00:01:00.000Z",
        }),
        activity({
          id: "act-quiet-request",
          engagementId: exportedEngagement.id,
          action: "request-sent",
          direction: "outbound",
          createdAt: "2026-03-02T00:00:00.000Z",
          readAt: "2026-03-02T00:05:00.000Z",
          detail: "2 items requested",
        }),
        activity({
          id: "act-internal-only",
          engagementId: internalOnlyEngagement.id,
          action: "document-trusted",
          direction: "internal",
          createdAt: "2026-03-06T00:00:00.000Z",
        }),
      ].map((entry) => toStored(entry)),
    );
  }

  test("returns one thread per outbound request with request-item lines, not per-file rows", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox");
    const body = await response.json();

    expect(response.status).toBe(200);
    const { threads } = inboxThreadsResponseSchema.parse(body);

    // Newest visible activity first; internal-only engagements never become threads.
    expect(threads.map((thread) => thread.engagementId)).toEqual([
      engagement.id,
      exportedEngagement.id,
    ]);

    const main = threads[0] as InboxThread;
    expect(main).toMatchObject({
      engagementId: engagement.id,
      clientName: client.legalName,
      engagementLabel: "1120-S · 2026",
      portalToken: engagement.portalToken,
      requestSentAt: "2026-03-01T00:00:00.000Z",
      unread: true,
      unreadCount: 2,
      sentToEngineAt: "2026-03-05T00:00:00.000Z",
    });

    // One line per request item — two uploads on item-w2 still make exactly one line.
    expect(main.items).toHaveLength(4);
    const byId = new Map(main.items.map((item) => [item.id, item]));
    expect(byId.get("item-w2")).toMatchObject({
      title: "W-2 forms",
      status: "received",
      documentId: "doc-w2-new",
      documentFilename: "w2-final.pdf",
      lastUpdateAt: "2026-03-03T02:00:00.000Z",
    });
    expect(byId.get("item-bs")).toMatchObject({
      title: "Balance sheet",
      status: "needs-attention",
      documentId: "doc-bs",
      documentFilename: "balance-sheet.pdf",
    });
    expect(byId.get("item-open")).toMatchObject({ title: "Bank statements", status: "open" });
    expect(byId.get("item-open")?.documentId).toBeUndefined();
    expect(byId.get("item-waived")).toMatchObject({
      title: "Vehicle log",
      status: "waived",
      waiveNote: "Sold the truck in March",
    });

    const quiet = threads[1] as InboxThread;
    expect(quiet).toMatchObject({
      engagementId: exportedEngagement.id,
      clientName: exportedClient.legalName,
      engagementLabel: "1065 · 2026",
      unread: false,
      unreadCount: 0,
      items: [],
    });
    expect(quiet.sentToEngineAt).toBeUndefined();
  });

  test("unread count is the number of unread threads, not unread activities", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox/unread-count");

    expect(response.status).toBe(200);
    // Engagement A has two unread activities but counts once; B is read; C is internal-only.
    expect(await response.json()).toEqual({ count: 1 });
  });

  test("stored null readAt still reads as unread", async () => {
    await seedThreads();
    const db = await connectDb();
    await db
      .collection<{ _id: string; readAt?: string | null }>(collectionNames.activities)
      .updateOne({ _id: "act-quiet-request" }, { $set: { readAt: null } });
    const app = createApp();

    const countResponse = await app.request("/api/inbox/unread-count");
    expect(await countResponse.json()).toEqual({ count: 2 });

    const listResponse = await app.request("/api/inbox");
    const { threads } = inboxThreadsResponseSchema.parse(await listResponse.json());
    const quiet = threads.find((thread) => thread.engagementId === exportedEngagement.id);
    expect(quiet?.unread).toBe(true);
  });

  test("thread read endpoint marks every visible activity read and leaves internal alone", async () => {
    await seedThreads();
    const app = createApp();

    const markResponse = await app.request(`/api/inbox/threads/${engagement.id}/read`, {
      method: "POST",
    });

    expect(markResponse.status).toBe(204);
    expect(await markResponse.text()).toBe("");

    const countResponse = await app.request("/api/inbox/unread-count");
    expect(await countResponse.json()).toEqual({ count: 0 });

    const listResponse = await app.request("/api/inbox");
    const { threads } = inboxThreadsResponseSchema.parse(await listResponse.json());
    const main = threads.find((thread) => thread.engagementId === engagement.id);
    expect(main?.unread).toBe(false);
    expect(main?.unreadCount).toBe(0);

    // The internal activity is invisible bookkeeping and must not be stamped.
    const db = await connectDb();
    const internal = await activitiesCollection(db).findOne({ _id: "act-internal" });
    expect(internal?.readAt).toBeUndefined();
  });

  test("thread read endpoint returns 404 for an unknown engagement", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox/threads/eng-missing/read", { method: "POST" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  test("single-activity mark-read keeps working and unknown ids 404", async () => {
    await seedThreads();
    const app = createApp();

    const markResponse = await app.request("/api/inbox/act-upload-unread/read", {
      method: "POST",
    });
    expect(markResponse.status).toBe(204);

    const listResponse = await app.request("/api/inbox");
    const { threads } = inboxThreadsResponseSchema.parse(await listResponse.json());
    const main = threads.find((thread) => thread.engagementId === engagement.id);
    // act-match-unread is still unread, so the thread stays unread with one fewer unread update.
    expect(main?.unread).toBe(true);
    expect(main?.unreadCount).toBe(1);

    const missingResponse = await app.request("/api/inbox/missing-activity/read", {
      method: "POST",
    });
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ error: "Not found" });
  });

  test("GET /unread-count is not captured as an inbox id", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox/unread-count");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1 });
  });
});

describe("metrics routes", () => {
  test("needs-review documents do not raise auto-processed or produce a 100% straight-through rate", async () => {
    const db = await connectDb();
    await taxDocumentsCollection(db).insertMany(
      [
        document({ id: "doc-nr-1", pipelineStatus: "needs-review" }),
        document({ id: "doc-nr-2", pipelineStatus: "needs-review" }),
        document({ id: "doc-rejected", pipelineStatus: "rejected" }),
      ].map((doc) => toStored(doc)),
    );
    const app = createApp();

    const response = await app.request("/api/metrics");
    const body = await response.json();
    const metrics = metricsSchema.parse(body);

    expect(response.status).toBe(200);
    expect(metrics.documentsAutoProcessed).toBe(0);
    expect(metrics.needsReviewCount).toBe(2);
    expect(metrics.straightThroughRate).toBe(0);
    expect(metrics.straightThroughRate).not.toBe(100);
    expect(Number.isInteger(metrics.straightThroughRate)).toBe(true);
  });

  test("straightThroughRate is trusted over terminal-ish statuses", async () => {
    const db = await connectDb();
    await taxDocumentsCollection(db).insertMany(
      [
        document({ id: "doc-trusted-1", pipelineStatus: "trusted" }),
        document({ id: "doc-trusted-2", pipelineStatus: "trusted" }),
        document({ id: "doc-nr-queued", pipelineStatus: "needs-review" }),
        document({ id: "doc-rejected", pipelineStatus: "rejected" }),
      ].map((doc) => toStored(doc)),
    );
    const app = createApp();

    const response = await app.request("/api/metrics");
    const body = await response.json();
    const metrics = metricsSchema.parse(body);

    expect(response.status).toBe(200);
    expect(metrics.documentsAutoProcessed).toBe(2);
    expect(metrics.needsReviewCount).toBe(1);
    expect(metrics.straightThroughRate).toBe(50);
  });

  test("computes field, request, client, and empty-denominator metrics as integers", async () => {
    const db = await connectDb();
    await clientsCollection(db).insertMany([toStored(client), toStored(exportedClient)]);
    await engagementsCollection(db).insertMany([
      toStored(engagement),
      toStored(exportedEngagement),
    ]);
    await taxDocumentsCollection(db).insertMany(
      [
        document({
          id: "doc-nr-fields",
          pipelineStatus: "needs-review",
          fields: {
            fields: [field("unreviewed", "wages"), field("accepted", "federal_income_tax"), field("unreviewed", "ssn")],
          },
        }),
        document({
          id: "doc-nr-one-field",
          pipelineStatus: "needs-review",
          fields: { fields: [field("unreviewed", "ordinary_income")] },
        }),
        document({
          id: "doc-trusted-ignored-fields",
          pipelineStatus: "trusted",
          fields: { fields: [field("unreviewed", "ignored")] },
        }),
        document({ id: "doc-unclassified", pipelineStatus: "unclassified" }),
        document({ id: "doc-failed", pipelineStatus: "failed" }),
        document({ id: "doc-received", pipelineStatus: "received" }),
      ].map((doc) => toStored(doc)),
    );
    await requestItemsCollection(db).insertMany(
      [
        requestItem({ id: "item-required-open-1", required: true, status: "open" }),
        requestItem({ id: "item-required-open-2", required: true, status: "open" }),
        requestItem({ id: "item-optional-open", required: false, status: "open" }),
        requestItem({ id: "item-required-received", required: true, status: "received" }),
      ].map((item) => toStored(item)),
    );
    const app = createApp();

    const response = await app.request("/api/metrics");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(metricsSchema.parse(body)).toEqual({
      documentsAutoProcessed: 1,
      fieldsAwaitingReview: 3,
      straightThroughRate: 20,
      needsReviewCount: 3,
      outstandingRequests: 2,
      activeClients: 1,
    });
    for (const value of Object.values(body)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  test("returns zeros when no documents or engagements exist", async () => {
    const app = createApp();

    const response = await app.request("/api/metrics");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(metricsSchema.parse(body)).toEqual({
      documentsAutoProcessed: 0,
      fieldsAwaitingReview: 0,
      straightThroughRate: 0,
      needsReviewCount: 0,
      outstandingRequests: 0,
      activeClients: 0,
    });
  });
});
