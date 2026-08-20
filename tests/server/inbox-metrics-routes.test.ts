import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  collectionNames,
  engagementsCollection,
  fromStored,
  messagesCollection,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { activitySchema } from "../../src/shared/schemas/activity.ts";
import { metricsSchema } from "../../src/shared/schemas/api.ts";
import {
  inboxMessageResponseSchema,
  inboxThreadsResponseSchema,
  type InboxThread,
} from "../../src/shared/schemas/inbox.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import {
  extractionFieldSchema,
  taxDocumentSchema,
  type TaxDocument,
} from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";
import { messageSchema, type Message } from "../../src/shared/schemas/message.ts";
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

const quietClient: Client = {
  ...client,
  id: "client-quiet-thread",
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

const quietEngagement: Engagement = {
  id: "eng-quiet-thread",
  clientId: quietClient.id,
  taxYear: 2026,
  filingType: "1065",
  status: "exported",
  portalToken: "portal-quiet-token",
  createdAt: iso,
  updatedAt: iso,
};

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    clientsCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    messagesCollection(db).deleteMany({}),
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

function message(input: {
  id: string;
  sender: Message["sender"];
  body: string;
  createdAt: string;
  engagementId?: string;
  readAt?: string;
}): Message {
  return messageSchema.parse({
    id: input.id,
    engagementId: input.engagementId ?? engagement.id,
    sender: input.sender,
    body: input.body,
    createdAt: input.createdAt,
    ...(input.readAt ? { readAt: input.readAt } : {}),
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
   * Engagement A (Bluebird): a conversation — outbound request event + request message, a read
   * upload, an UNREAD client question, an UNREAD upload, and a read agent match. The unread
   * outbound request-sent activity must NOT count: only inbound items drive unread.
   * Engagement B (Harbor Yarns): the CPA's request message plus an unread OUTBOUND activity —
   * a thread that must read as fully read. Engagement C: internal activity only — no thread.
   */
  async function seedThreads() {
    const db = await connectDb();
    await clientsCollection(db).insertMany([toStored(client), toStored(quietClient)]);
    await engagementsCollection(db).insertMany([
      toStored(engagement),
      toStored(quietEngagement),
      toStored(internalOnlyEngagement),
    ]);
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-w2", required: true, status: "received", title: "W-2 forms" })),
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
      ].map((doc) => toStored(doc)),
    );
    await messagesCollection(db).insertMany(
      [
        message({
          id: "msg-a-request",
          sender: "cpa",
          body: "Hi Maya — we've opened your 2026 1120-S engagement and requested 4 documents.",
          createdAt: "2026-03-01T00:00:30.000Z",
          readAt: "2026-03-01T01:00:00.000Z",
        }),
        message({
          id: "msg-a-question",
          sender: "client",
          body: "Quick question — do you need Q4 bank statements too?",
          createdAt: "2026-03-02T00:00:00.000Z",
        }),
        message({
          id: "msg-b-request",
          engagementId: quietEngagement.id,
          sender: "cpa",
          body: "Hi — your 2026 1065 engagement is open.",
          createdAt: "2026-03-05T00:00:00.000Z",
        }),
      ].map((entry) => toStored(entry)),
    );
    await activitiesCollection(db).insertMany(
      [
        activity({
          id: "act-request-sent",
          action: "request-sent",
          direction: "outbound",
          createdAt: "2026-03-01T00:00:00.000Z",
          detail: "4 items requested",
          // Deliberately unread: the CPA's own outbound must never make their inbox unread.
        }),
        activity({
          id: "act-upload-read",
          action: "document-uploaded",
          direction: "inbound",
          createdAt: "2026-03-01T02:00:00.000Z",
          readAt: "2026-03-01T03:00:00.000Z",
          documentId: "doc-w2-old",
          detail: "w2-draft.pdf uploaded from portal",
        }),
        activity({
          id: "act-upload-unread",
          action: "document-uploaded",
          direction: "inbound",
          createdAt: "2026-03-03T01:00:00.000Z",
          documentId: "doc-w2-new",
          detail: "w2-final.pdf uploaded from portal",
        }),
        activity({
          id: "act-match-read",
          action: "checklist-item-matched",
          direction: "inbound",
          actor: "agent",
          createdAt: "2026-03-03T02:00:00.000Z",
          readAt: "2026-03-03T03:00:00.000Z",
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
          id: "act-b-request-sent",
          engagementId: quietEngagement.id,
          action: "request-sent",
          direction: "outbound",
          createdAt: "2026-03-04T23:00:00.000Z",
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

  test("returns one thread per engagement with a chronological message + event timeline", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox");
    const body = await response.json();

    expect(response.status).toBe(200);
    const { threads } = inboxThreadsResponseSchema.parse(body);

    // Latest timeline entry first; internal-only engagements never become threads.
    expect(threads.map((thread) => thread.engagementId)).toEqual([
      quietEngagement.id,
      engagement.id,
    ]);

    const main = threads[1] as InboxThread;
    expect(main).toMatchObject({
      engagementId: engagement.id,
      clientName: client.legalName,
      taxYear: 2026,
      filingType: "1120-S",
      portalToken: engagement.portalToken,
      unread: true,
      // The unread client message + the unread inbound upload. The unread OUTBOUND
      // request-sent activity must not count.
      unreadCount: 2,
    });

    expect(main.timeline.map((entry) => [entry.kind, entry.id])).toEqual([
      ["event", "act-request-sent"],
      ["message", "msg-a-request"],
      ["event", "act-upload-read"],
      ["message", "msg-a-question"],
      ["event", "act-upload-unread"],
      ["event", "act-match-read"],
    ]);

    expect(main.timeline[0]).toMatchObject({ kind: "event", text: "Request sent" });
    expect(main.timeline[1]).toMatchObject({
      kind: "message",
      sender: "cpa",
      body: "Hi Maya — we've opened your 2026 1120-S engagement and requested 4 documents.",
    });
    expect(main.timeline[3]).toMatchObject({
      kind: "message",
      sender: "client",
      body: "Quick question — do you need Q4 bank statements too?",
    });
    // Upload events name the file and deep-link the document.
    expect(main.timeline[4]).toMatchObject({
      kind: "event",
      text: "Client uploaded w2-final.pdf",
      documentId: "doc-w2-new",
    });
    // Match events name the request item.
    expect(main.timeline[5]).toMatchObject({ kind: "event", text: "Matched to W-2 forms" });

    const quiet = threads[0] as InboxThread;
    expect(quiet).toMatchObject({
      engagementId: quietEngagement.id,
      clientName: quietClient.legalName,
      taxYear: 2026,
      filingType: "1065",
      // Only the CPA has spoken and only outbound activity exists — nothing is unread.
      unread: false,
      unreadCount: 0,
    });
    expect(quiet.timeline.map((entry) => entry.kind)).toEqual(["event", "message"]);
  });

  test("unread count is the number of threads with unread inbound items only", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox/unread-count");

    expect(response.status).toBe(200);
    // Engagement A has an unread client message and an unread inbound upload but counts once.
    // Engagement B's unread OUTBOUND request-sent must not count.
    expect(await response.json()).toEqual({ count: 1 });
  });

  test("an unread client message alone makes a thread unread", async () => {
    await seedThreads();
    const db = await connectDb();
    await messagesCollection(db).insertOne(
      toStored(
        message({
          id: "msg-b-reply",
          engagementId: quietEngagement.id,
          sender: "client",
          body: "Got it, thanks!",
          createdAt: "2026-03-05T01:00:00.000Z",
        }),
      ),
    );
    const app = createApp();

    const countResponse = await app.request("/api/inbox/unread-count");
    expect(await countResponse.json()).toEqual({ count: 2 });

    const listResponse = await app.request("/api/inbox");
    const { threads } = inboxThreadsResponseSchema.parse(await listResponse.json());
    const quiet = threads.find((thread) => thread.engagementId === quietEngagement.id);
    expect(quiet?.unread).toBe(true);
    expect(quiet?.unreadCount).toBe(1);
  });

  test("stored null readAt still reads as unread", async () => {
    await seedThreads();
    const db = await connectDb();
    await db
      .collection<{ _id: string; readAt?: string | null }>(collectionNames.messages)
      .updateOne({ _id: "msg-a-question" }, { $set: { readAt: null } });
    await db
      .collection<{ _id: string; readAt?: string | null }>(collectionNames.activities)
      .updateOne({ _id: "act-upload-unread" }, { $set: { readAt: null } });
    const app = createApp();

    const countResponse = await app.request("/api/inbox/unread-count");
    expect(await countResponse.json()).toEqual({ count: 1 });

    const listResponse = await app.request("/api/inbox");
    const { threads } = inboxThreadsResponseSchema.parse(await listResponse.json());
    const main = threads.find((thread) => thread.engagementId === engagement.id);
    expect(main?.unread).toBe(true);
    expect(main?.unreadCount).toBe(2);
  });

  test("posting a message inserts a cpa message and returns it with 201", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request(`/api/inbox/threads/${engagement.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "We do — December statements please." }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    const { message: created } = inboxMessageResponseSchema.parse(body);
    expect(created).toMatchObject({
      engagementId: engagement.id,
      sender: "cpa",
      body: "We do — December statements please.",
    });
    expect(created.readAt).toBeUndefined();

    // Persisted, and lands last in the thread timeline.
    const db = await connectDb();
    const stored = await messagesCollection(db).findOne({ _id: created.id });
    expect(fromStored(messageSchema, stored!)).toEqual(created);

    const listResponse = await app.request("/api/inbox");
    const { threads } = inboxThreadsResponseSchema.parse(await listResponse.json());
    const main = threads.find((thread) => thread.engagementId === engagement.id);
    expect(main?.timeline.at(-1)).toMatchObject({
      kind: "message",
      id: created.id,
      sender: "cpa",
    });
    // The CPA's own message never makes the CPA inbox unread.
    expect(main?.unreadCount).toBe(2);
  });

  test("posting a message 404s for an unknown engagement and 400s on an invalid body", async () => {
    await seedThreads();
    const app = createApp();

    const missing = await app.request("/api/inbox/threads/eng-missing/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "hello" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });

    const empty = await app.request(`/api/inbox/threads/${engagement.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "" }),
    });
    expect(empty.status).toBe(400);
    const emptyBody = await empty.json();
    expect(emptyBody.error).toContain("at least 1 character");

    const absent = await app.request(`/api/inbox/threads/${engagement.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(absent.status).toBe(400);

    const db = await connectDb();
    expect(await messagesCollection(db).countDocuments({ engagementId: engagement.id })).toBe(2);
  });

  test("thread read marks client messages and visible activities read, leaves the rest alone", async () => {
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

    const db = await connectDb();
    // The client's question is stamped read.
    const question = await messagesCollection(db).findOne({ _id: "msg-a-question" });
    expect(typeof question?.readAt).toBe("string");
    // The CPA's own message read-state belongs to the portal side and must not be stamped here.
    const request = await messagesCollection(db).findOne({ _id: "msg-b-request" });
    expect(request?.readAt).toBeUndefined();
    // Internal activities are invisible bookkeeping and must not be stamped.
    const internal = await activitiesCollection(db).findOne({ _id: "act-internal" });
    expect(internal?.readAt).toBeUndefined();
    // Visible activities in the thread are stamped, including the outbound request line.
    const upload = await activitiesCollection(db).findOne({ _id: "act-upload-unread" });
    expect(typeof upload?.readAt).toBe("string");
  });

  test("thread read endpoint returns 404 for an unknown engagement", async () => {
    await seedThreads();
    const app = createApp();

    const response = await app.request("/api/inbox/threads/eng-missing/read", { method: "POST" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  test("GET /unread-count is not captured as a thread id", async () => {
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
    await clientsCollection(db).insertMany([toStored(client), toStored(quietClient)]);
    await engagementsCollection(db).insertMany([
      toStored(engagement),
      toStored(quietEngagement),
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
