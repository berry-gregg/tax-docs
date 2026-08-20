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
import {
  engagementDetailSchema,
  engagementListResponseSchema,
} from "../../src/shared/schemas/api.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import { engagementSchema, type Engagement } from "../../src/shared/schemas/engagement.ts";

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

const secondClient: Client = {
  id: "client-sierra",
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
 * Two engagements straddling every filter axis: eng-newer (client one, 2026, 1065,
 * collecting, created later) and eng-older (client two, 2025, 1120-S, in-review,
 * created earlier).
 */
async function seedListFixtures() {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(secondClient));
  const fixtures: Engagement[] = [
    engagementSchema.parse({
      id: "eng-newer",
      clientId: client.id,
      taxYear: 2026,
      filingType: "1065",
      status: "collecting",
      portalToken: "token-newer",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
    engagementSchema.parse({
      id: "eng-older",
      clientId: secondClient.id,
      taxYear: 2025,
      filingType: "1120-S",
      status: "in-review",
      portalToken: "token-older",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  ];
  await engagementsCollection(db).insertMany(fixtures.map((engagement) => toStored(engagement)));
}

async function listEngagementIds(app: ReturnType<typeof createApp>, url: string): Promise<string[]> {
  const response = await app.request(url);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(() => engagementListResponseSchema.parse(body)).not.toThrow();
  return body.engagements.map((row: { id: string }) => row.id);
}

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
    expect(() => engagementDetailSchema.parse(detailBody)).not.toThrow();
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

  test("does not claim a request was sent when the checklist is empty", async () => {
    const app = createApp();

    const createResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1065",
        items: [],
      }),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const detailResponse = await app.request(`/api/engagements/${createBody.engagement.id}`);
    const detailBody = await detailResponse.json();

    expect(detailBody.requestItems).toHaveLength(0);
    expect(detailBody.activity[0]).toMatchObject({
      action: "engagement-created",
      detail: "Engagement created",
    });
    expect(detailBody.activity[0].detail).not.toContain("items requested");
    expect(detailBody.activity[0].action).not.toBe("request-sent");
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
    expect(() => engagementListResponseSchema.parse(listBody)).not.toThrow();
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

  test("stamps a server-owned createdAt on request items, ignoring any caller value", async () => {
    const app = createApp();
    const before = new Date().toISOString();

    const createResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1065",
        items: [{ ...explicitItem, createdAt: "1999-01-01T00:00:00.000Z" }],
      }),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const detailResponse = await app.request(`/api/engagements/${createBody.engagement.id}`);
    const detailBody = await detailResponse.json();
    const templated = detailBody.requestItems[0];
    expect(templated.createdAt >= before).toBe(true);

    const addedResponse = await app.request(
      `/api/engagements/${createBody.engagement.id}/request-items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentTypeId: "dt-balance-sheet",
          title: "Year-end balance sheet",
          description: "Statement of financial position as of year end.",
          required: true,
          createdAt: "1999-01-01T00:00:00.000Z",
        }),
      },
    );
    const addedBody = await addedResponse.json();
    expect(addedResponse.status).toBe(201);
    expect(addedBody.item.createdAt >= before).toBe(true);
  });

  test("creates and deletes request items scoped to the engagement", async () => {
    const app = createApp();
    const extraItem = {
      documentTypeId: "dt-balance-sheet",
      title: "Year-end balance sheet",
      description: "Statement of financial position as of year end.",
      required: true,
    } as const;

    const createHomeResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2026,
        filingType: "1065",
        items: [explicitItem],
      }),
    });
    const createHomeBody = await createHomeResponse.json();
    const createForeignResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        taxYear: 2025,
        filingType: "1065",
        items: [explicitItem],
      }),
    });
    const createForeignBody = await createForeignResponse.json();

    expect(createHomeResponse.status).toBe(201);
    expect(createForeignResponse.status).toBe(201);

    const createItemResponse = await app.request(
      `/api/engagements/${createHomeBody.engagement.id}/request-items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extraItem),
      },
    );
    const createItemBody = await createItemResponse.json();

    expect(createItemResponse.status).toBe(201);
    expect(createItemBody.item).toMatchObject({
      ...extraItem,
      engagementId: createHomeBody.engagement.id,
      status: "open",
      matchedDocumentIds: [],
    });
    expect(createItemBody.item.id).toBeString();

    const foreignDeleteResponse = await app.request(
      `/api/engagements/${createForeignBody.engagement.id}/request-items/${createItemBody.item.id}`,
      { method: "DELETE" },
    );
    const foreignDeleteBody = await foreignDeleteResponse.json();

    expect(foreignDeleteResponse.status).toBe(404);
    expect(foreignDeleteBody).toEqual({ error: "Not found" });

    const deleteResponse = await app.request(
      `/api/engagements/${createHomeBody.engagement.id}/request-items/${createItemBody.item.id}`,
      { method: "DELETE" },
    );

    expect(deleteResponse.status).toBe(204);
    expect(await deleteResponse.text()).toBe("");

    const missingDeleteResponse = await app.request(
      `/api/engagements/${createHomeBody.engagement.id}/request-items/${createItemBody.item.id}`,
      { method: "DELETE" },
    );
    const missingDeleteBody = await missingDeleteResponse.json();

    expect(missingDeleteResponse.status).toBe(404);
    expect(missingDeleteBody).toEqual({ error: "Not found" });
  });

  test("list filters narrow by client, tax year, filing type, and stage", async () => {
    const app = createApp();
    await seedListFixtures();

    const byClient = await listEngagementIds(app, `/api/engagements?clientId=${client.id}`);
    expect(byClient).toEqual(["eng-newer"]);

    const byOtherClient = await listEngagementIds(app, `/api/engagements?clientId=${secondClient.id}`);
    expect(byOtherClient).toEqual(["eng-older"]);

    const byYear = await listEngagementIds(app, "/api/engagements?taxYear=2025");
    expect(byYear).toEqual(["eng-older"]);

    const byFilingType = await listEngagementIds(app, "/api/engagements?filingType=1120-S");
    expect(byFilingType).toEqual(["eng-older"]);

    const byStage = await listEngagementIds(app, "/api/engagements?status=in-review");
    expect(byStage).toEqual(["eng-older"]);

    const combined = await listEngagementIds(app, `/api/engagements?clientId=${client.id}&taxYear=2025`);
    expect(combined).toEqual([]);
  });

  test("list sorts newest first by default and oldest first on request", async () => {
    const app = createApp();
    await seedListFixtures();

    expect(await listEngagementIds(app, "/api/engagements")).toEqual(["eng-newer", "eng-older"]);
    expect(await listEngagementIds(app, "/api/engagements?sort=oldest")).toEqual(["eng-older", "eng-newer"]);
    expect(await listEngagementIds(app, "/api/engagements?sort=newest")).toEqual(["eng-newer", "eng-older"]);
  });

  test("rejects invalid list query params with a real message", async () => {
    const app = createApp();

    const badYear = await app.request("/api/engagements?taxYear=abc");
    const badYearBody = await badYear.json();
    expect(badYear.status).toBe(400);
    expect(badYearBody.error.toLowerCase()).toContain("number");

    const badSort = await app.request("/api/engagements?sort=bogus");
    const badSortBody = await badSort.json();
    expect(badSort.status).toBe(400);
    expect(badSortBody.error).toContain("Invalid enum value");

    const badStage = await app.request("/api/engagements?status=bogus");
    expect(badStage.status).toBe(400);
  });

  test("returns 404 for unknown engagement ids and 400 for invalid filing types", async () => {
    const app = createApp();

    const missingResponse = await app.request("/api/engagements/missing-engagement");
    const missingBody = await missingResponse.json();

    expect(missingResponse.status).toBe(404);
    expect(missingBody).toEqual({ error: "Not found" });

    const unknownClientResponse = await app.request("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "missing-client",
        taxYear: 2026,
        filingType: "1120-S",
      }),
    });
    const unknownClientBody = await unknownClientResponse.json();

    expect(unknownClientResponse.status).toBe(404);
    expect(unknownClientBody).toEqual({ error: "Not found" });

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

describe("request-item activity emissions", () => {
  async function createEngagementWithItem(app: ReturnType<typeof createApp>) {
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
    const detailBody = engagementDetailSchema.parse(await detailResponse.json());
    return {
      engagementId: createBody.engagement.id as string,
      itemId: detailBody.requestItems[0]?.id as string,
    };
  }

  async function activityFeed(app: ReturnType<typeof createApp>, engagementId: string) {
    const response = await app.request(`/api/engagements/${engagementId}`);
    return engagementDetailSchema.parse(await response.json()).activity;
  }

  test("adding a request item emits an outbound request-item-added activity", async () => {
    const app = createApp();
    const { engagementId } = await createEngagementWithItem(app);

    const addResponse = await app.request(`/api/engagements/${engagementId}/request-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentTypeId: "dt-balance-sheet",
        title: "Year-end balance sheet",
        description: "Statement of financial position as of year end.",
        required: true,
      }),
    });
    const addBody = await addResponse.json();
    expect(addResponse.status).toBe(201);

    const feed = await activityFeed(app, engagementId);
    expect(feed).toContainEqual(
      expect.objectContaining({
        action: "request-item-added",
        actor: "cpa",
        direction: "outbound",
        detail: "Year-end balance sheet",
        requestItemId: addBody.item.id,
      }),
    );
  });

  test("waiving a request item emits request-item-waived only on the transition to waived", async () => {
    const app = createApp();
    const { engagementId, itemId } = await createEngagementWithItem(app);

    const patchItem = (body: Record<string, unknown>) =>
      app.request(`/api/engagements/${engagementId}/request-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    // A metadata-only patch is not a waive and must stay silent.
    const titleResponse = await patchItem({ title: "Custom P&L (updated)" });
    expect(titleResponse.status).toBe(200);
    let waives = (await activityFeed(app, engagementId)).filter(
      (entry) => entry.action === "request-item-waived",
    );
    expect(waives).toHaveLength(0);

    const waiveResponse = await patchItem({ status: "waived" });
    expect(waiveResponse.status).toBe(200);
    waives = (await activityFeed(app, engagementId)).filter(
      (entry) => entry.action === "request-item-waived",
    );
    expect(waives).toHaveLength(1);
    expect(waives[0]).toMatchObject({
      actor: "cpa",
      direction: "outbound",
      requestItemId: itemId,
    });

    // Re-waiving an already-waived item is not a transition.
    const rewaiveResponse = await patchItem({ status: "waived" });
    expect(rewaiveResponse.status).toBe(200);
    waives = (await activityFeed(app, engagementId)).filter(
      (entry) => entry.action === "request-item-waived",
    );
    expect(waives).toHaveLength(1);
  });
});
