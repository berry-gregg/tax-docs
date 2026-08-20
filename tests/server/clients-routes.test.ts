import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  requestItemsCollection,
  requestTemplatesCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { seedRequestTemplates } from "../../src/server/seed/definitions.ts";

const clientInput = {
  legalName: "Bluebird Robotics LLC",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Maya Chen",
  contactEmail: "maya@bluebird.example",
  city: "Denver",
  state: "CO",
} as const;

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    clientsCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    requestTemplatesCollection(db).deleteMany({}),
  ]);
}

beforeEach(async () => {
  await clearCollections();
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("clients routes", () => {
  test("creates, lists, reads, and updates clients with their engagements", async () => {
    const app = createApp();

    const createResponse = await app.request("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientInput),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.client).toMatchObject(clientInput);
    expect(createBody.client.id).toBeString();
    expect(createBody.client.createdAt).toBeString();

    const listResponse = await app.request("/api/clients");
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.clients).toHaveLength(1);
    expect(listBody.clients[0].legalName).toBe(clientInput.legalName);

    const readResponse = await app.request(`/api/clients/${createBody.client.id}`);
    const readBody = await readResponse.json();

    expect(readResponse.status).toBe(200);
    expect(readBody.client.legalName).toBe(clientInput.legalName);
    expect(readBody.engagements).toEqual([]);

    const patchResponse = await app.request(`/api/clients/${createBody.client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: "Boulder" }),
    });
    const patchBody = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchBody.client.city).toBe("Boulder");
    expect(patchBody.client.legalName).toBe(clientInput.legalName);
  });

  test("joins engagements created via POST onto client detail", async () => {
    const app = createApp();
    const db = await connectDb();
    await requestTemplatesCollection(db).insertMany(
      seedRequestTemplates.map((template) => toStored(template)),
    );

    const createClientResponse = await app.request("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientInput),
    });
    const createClientBody = await createClientResponse.json();

    expect(createClientResponse.status).toBe(201);

    const createEngagementResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: createClientBody.client.id,
        taxYear: 2026,
        filingType: "1120-S",
      }),
    });
    const createEngagementBody = await createEngagementResponse.json();

    expect(createEngagementResponse.status).toBe(201);
    expect(createEngagementBody.engagement.clientId).toBe(createClientBody.client.id);

    const detailResponse = await app.request(`/api/clients/${createClientBody.client.id}`);
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.client.id).toBe(createClientBody.client.id);
    expect(detailBody.engagements).toHaveLength(1);
    expect(detailBody.engagements[0]).toMatchObject({
      id: createEngagementBody.engagement.id,
      clientId: createClientBody.client.id,
      taxYear: 2026,
      filingType: "1120-S",
      status: "collecting",
    });
  });

  test("returns 400 for invalid client bodies and 404 for missing ids", async () => {
    const app = createApp();

    const invalidResponse = await app.request("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legalName: "" }),
    });
    const invalidBody = await invalidResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.error).toContain("Required");

    const missingResponse = await app.request("/api/clients/missing-client");
    const missingBody = await missingResponse.json();

    expect(missingResponse.status).toBe(404);
    expect(missingBody).toEqual({ error: "Not found" });
  });
});
