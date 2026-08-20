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
import type { Client } from "../../src/shared/schemas/client.ts";
import {
  extractionFieldSchema,
  taxDocumentSchema,
  type TaxDocument,
} from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";
import { inboxEntrySchema } from "../../src/shared/schemas/inbox.ts";
import { metricsSchema } from "../../src/shared/schemas/metrics.ts";
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
  readAt?: string;
  actor?: "agent" | "cpa" | "client";
  detail?: string;
}) {
  return activitySchema.parse({
    id: input.id,
    engagementId: engagement.id,
    actor: input.actor ?? (input.direction === "inbound" ? "client" : "cpa"),
    action: input.action,
    detail: input.detail ?? input.action,
    direction: input.direction,
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
}): TaxDocument {
  return taxDocumentSchema.parse({
    id: input.id,
    engagementId: engagement.id,
    filename: `${input.id}.pdf`,
    mimeType: "application/pdf",
    size: 1200,
    storagePath: `data/uploads/${input.id}.pdf`,
    uploadedBy: "client",
    pipelineStatus: input.pipelineStatus,
    createdAt: iso,
    updatedAt: iso,
    ...(input.fields ? { extraction: input.fields } : {}),
  });
}

function requestItem(input: {
  id: string;
  required: boolean;
  status: RequestItem["status"];
}): RequestItem {
  return requestItemSchema.parse({
    id: input.id,
    engagementId: engagement.id,
    documentTypeId: "dt-w2",
    title: input.id,
    description: "Request item",
    required: input.required,
    status: input.status,
    matchedDocumentIds: [],
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
  async function seedInbox() {
    const db = await connectDb();
    await clientsCollection(db).insertOne(toStored(client));
    await engagementsCollection(db).insertOne(toStored(engagement));
    await activitiesCollection(db).insertMany(
      [
        activity({
          id: "act-internal",
          action: "classified",
          direction: "internal",
          createdAt: "2026-03-04T00:00:00.000Z",
        }),
        activity({
          id: "act-inbound-unread-new",
          action: "document-uploaded",
          direction: "inbound",
          createdAt: "2026-03-03T00:00:00.000Z",
          detail: "w2.pdf",
        }),
        activity({
          id: "act-inbound-read",
          action: "document-uploaded",
          direction: "inbound",
          createdAt: "2026-03-02T00:00:00.000Z",
          readAt: "2026-03-02T12:00:00.000Z",
          detail: "k1.pdf",
        }),
        activity({
          id: "act-request-sent",
          action: "request-sent",
          direction: "outbound",
          createdAt: "2026-03-01T00:00:00.000Z",
          detail: "3 items requested",
        }),
        activity({
          id: "act-inbound-unread-old",
          action: "needs-review",
          direction: "inbound",
          createdAt: "2026-02-28T00:00:00.000Z",
        }),
      ].map((entry) => toStored(entry)),
    );
  }

  test("lists non-internal activities newest first with joined clientName, portalToken, and unread", async () => {
    await seedInbox();
    const app = createApp();

    const response = await app.request("/api/inbox");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries.map((entry: { id: string }) => inboxEntrySchema.parse(entry).id)).toEqual([
      "act-inbound-unread-new",
      "act-inbound-read",
      "act-request-sent",
      "act-inbound-unread-old",
    ]);
    expect(body.entries.find((entry: { id: string }) => entry.id === "act-internal")).toBeUndefined();

    const unreadNew = body.entries[0];
    expect(unreadNew).toMatchObject({
      id: "act-inbound-unread-new",
      engagementId: engagement.id,
      clientName: client.legalName,
      direction: "inbound",
      unread: true,
    });

    const readInbound = body.entries[1];
    expect(readInbound.unread).toBe(false);

    const requestSent = body.entries[2];
    expect(requestSent).toMatchObject({
      id: "act-request-sent",
      action: "request-sent",
      direction: "outbound",
      unread: false,
      portalToken: engagement.portalToken,
      clientName: client.legalName,
      engagementId: engagement.id,
    });
  });

  test("unread count includes only inbound unread entries and mark-read flips it", async () => {
    await seedInbox();
    const app = createApp();

    const unreadResponse = await app.request("/api/inbox/unread-count");
    const unreadBody = await unreadResponse.json();

    expect(unreadResponse.status).toBe(200);
    expect(unreadBody).toEqual({ count: 2 });

    const markResponse = await app.request("/api/inbox/act-inbound-unread-new/read", {
      method: "POST",
    });

    expect(markResponse.status).toBe(204);
    expect(await markResponse.text()).toBe("");

    const afterCountResponse = await app.request("/api/inbox/unread-count");
    const afterCountBody = await afterCountResponse.json();
    expect(afterCountBody).toEqual({ count: 1 });

    const listResponse = await app.request("/api/inbox");
    const listBody = await listResponse.json();
    const marked = listBody.entries.find(
      (entry: { id: string }) => entry.id === "act-inbound-unread-new",
    );
    expect(marked.unread).toBe(false);
    expect(marked.readAt).toBeString();
  });

  test("GET /unread-count is not captured as an inbox id", async () => {
    await seedInbox();
    const app = createApp();

    const response = await app.request("/api/inbox/unread-count");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ count: 2 });
  });

  test("unread count and list treat stored null readAt as unread", async () => {
    await seedInbox();
    const db = await connectDb();
    await db.collection<{ _id: string; readAt?: string | null }>(collectionNames.activities).updateOne(
      { _id: "act-inbound-unread-new" },
      { $set: { readAt: null } },
    );
    const app = createApp();

    const countResponse = await app.request("/api/inbox/unread-count");
    const listResponse = await app.request("/api/inbox");
    const listBody = await listResponse.json();
    const entry = listBody.entries.find(
      (item: { id: string }) => item.id === "act-inbound-unread-new",
    );

    expect(countResponse.status).toBe(200);
    expect(await countResponse.json()).toEqual({ count: 2 });
    expect(entry.unread).toBe(true);
    expect(entry.readAt).toBeUndefined();
  });

  test("mark-read returns 404 for an unknown activity id", async () => {
    await seedInbox();
    const app = createApp();

    const response = await app.request("/api/inbox/missing-activity/read", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
  });
});

describe("metrics routes", () => {
  test("straightThroughRate is 67 for 2 needs-review and 1 rejected document", async () => {
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

    expect(response.status).toBe(200);
    expect(metricsSchema.parse(body).documentsAutoProcessed).toBe(2);
    expect(body.straightThroughRate).toBe(67);
    expect(Number.isInteger(body.straightThroughRate)).toBe(true);
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
      documentsAutoProcessed: 3,
      fieldsAwaitingReview: 3,
      straightThroughRate: 60,
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
