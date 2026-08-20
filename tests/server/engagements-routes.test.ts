import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  requestItemsCollection,
  requestTemplatesCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { seedRequestTemplates } from "../../src/server/seed/definitions.ts";
import type { Client } from "../../src/shared/schemas/client.ts";

const client: Client = {
  id: "client-bluebird",
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

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    clientsCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    requestTemplatesCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
}

async function seedClientAndTemplates() {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(client));
  await requestTemplatesCollection(db).insertMany(seedRequestTemplates.map((template) => toStored(template)));
}

beforeEach(async () => {
  await clearCollections();
  await seedClientAndTemplates();
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("engagement routes", () => {
  test("creates an engagement from the filing type template and returns aggregate detail", async () => {
    const app = createApp();

    const createResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1120-S",
      }),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.engagement).toMatchObject({
      clientId: client.id,
      taxYear: 2026,
      filingType: "1120-S",
      status: "collecting",
    });
    expect(createBody.engagement.portalToken).toBeString();

    const detailResponse = await app.request(`/api/engagements/${createBody.engagement.id}`);
    const detailBody = await detailResponse.json();

    const template = seedRequestTemplates.find((candidate) => candidate.filingType === "1120-S");
    expect(detailResponse.status).toBe(200);
    expect(detailBody.client.legalName).toBe(client.legalName);
    expect(detailBody.requestItems).toHaveLength(template?.items.length ?? 0);
    expect(detailBody.requestItems[0]).toMatchObject({
      engagementId: createBody.engagement.id,
      status: "open",
      matchedDocumentIds: [],
    });
    expect(detailBody.activity).toContainEqual(
      expect.objectContaining({
        action: "request-sent",
        detail: `${template?.items.length ?? 0} items requested`,
        direction: "outbound",
      }),
    );
  });

  test("uses explicit request items instead of template items", async () => {
    const app = createApp();

    const createResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1065",
        items: [explicitItem],
      }),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);

    const detailResponse = await app.request(`/api/engagements/${createBody.engagement.id}`);
    const detailBody = await detailResponse.json();

    expect(detailBody.requestItems).toHaveLength(1);
    expect(detailBody.requestItems[0]).toMatchObject({
      ...explicitItem,
      status: "open",
      matchedDocumentIds: [],
    });
    expect(detailBody.activity[0]).toMatchObject({
      action: "request-sent",
      detail: "1 items requested",
    });
  });

  test("lists engagement rows with client names, document counts, and open item counts", async () => {
    const app = createApp();

    const createResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1065",
        items: [explicitItem],
      }),
    });
    const createBody = await createResponse.json();

    const listResponse = await app.request("/api/engagements");
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.engagements).toContainEqual(
      expect.objectContaining({
        id: createBody.engagement.id,
        clientName: client.legalName,
        docCounts: { total: 0, needsReview: 0 },
        openItems: 1,
      }),
    );
  });

  test("updates engagement and request item state", async () => {
    const app = createApp();

    const createResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1065",
        items: [explicitItem],
      }),
    });
    const createBody = await createResponse.json();
    const detailResponse = await app.request(`/api/engagements/${createBody.engagement.id}`);
    const detailBody = await detailResponse.json();
    const itemId = detailBody.requestItems[0].id;

    const statusResponse = await app.request(`/api/engagements/${createBody.engagement.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in-review" }),
    });
    const statusBody = await statusResponse.json();

    expect(statusResponse.status).toBe(200);
    expect(statusBody.engagement.status).toBe("in-review");

    const itemResponse = await app.request(
      `/api/engagements/${createBody.engagement.id}/request-items/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "waived" }),
      },
    );
    const itemBody = await itemResponse.json();

    expect(itemResponse.status).toBe(200);
    expect(itemBody.item.status).toBe("waived");
  });

  test("returns 404 for unknown engagement ids and 400 for invalid filing types", async () => {
    const app = createApp();

    const missingResponse = await app.request("/api/engagements/missing-engagement");
    const missingBody = await missingResponse.json();

    expect(missingResponse.status).toBe(404);
    expect(missingBody).toEqual({ error: "Not found" });

    const invalidResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1040",
      }),
    });
    const invalidBody = await invalidResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.error).toContain("Invalid enum value");
  });
});
