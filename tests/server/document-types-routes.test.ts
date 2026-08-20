import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  documentTypesCollection,
  requestTemplatesCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { seedRequestTemplates } from "../../src/server/seed/definitions.ts";

const validField = {
  key: "amount",
  label: "Amount",
  metadataType: "dollar-amount" as const,
  dataType: "double" as const,
  required: true,
  description: "Total amount on the document.",
};

const createPayload = {
  name: "Custom statement",
  description: "A CPA-defined document type for testing.",
  fields: [validField],
};

describe("document-types routes", () => {
  test("POST sets createdBy cpa and defaults active true", async () => {
    await connectDb();
    const app = createApp();

    const response = await app.request("/api/document-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.documentType.createdBy).toBe("cpa");
    expect(body.documentType.active).toBe(true);
    expect(body.documentType.name).toBe(createPayload.name);

    const db = await connectDb();
    await documentTypesCollection(db).deleteMany({});
    await disconnectDb();
  });

  test("POST returns 400 when fields is empty", async () => {
    await connectDb();
    const app = createApp();

    const response = await app.request("/api/document-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...createPayload, fields: [] }),
    });

    expect(response.status).toBe(400);

    await disconnectDb();
  });

  test("GET list includes inactive types after PATCH", async () => {
    await connectDb();
    const app = createApp();

    const createResponse = await app.request("/api/document-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });
    const { documentType } = await createResponse.json();

    const patchResponse = await app.request(`/api/document-types/${documentType.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json();
    expect(patched.documentType.active).toBe(false);

    const listResponse = await app.request("/api/document-types");
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    const found = listBody.documentTypes.find((dt: { id: string }) => dt.id === documentType.id);
    expect(found?.active).toBe(false);

    const db = await connectDb();
    await documentTypesCollection(db).deleteMany({});
    await disconnectDb();
  });

  test("GET by id returns 404 for unknown id", async () => {
    await connectDb();
    const app = createApp();

    const response = await app.request("/api/document-types/missing-id");
    expect(response.status).toBe(404);

    await disconnectDb();
  });
});

describe("request-templates routes", () => {
  test("GET filters templates by filingType", async () => {
    await connectDb();
    const db = await connectDb();
    await requestTemplatesCollection(db).deleteMany({});
    for (const tpl of seedRequestTemplates) {
      await requestTemplatesCollection(db).insertOne(toStored(tpl));
    }

    const app = createApp();
    const response = await app.request("/api/request-templates?filingType=1120-S");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].filingType).toBe("1120-S");
    expect(body.templates[0].id).toBe("tpl-1120s");

    await requestTemplatesCollection(db).deleteMany({});
    await disconnectDb();
  });

  test("GET returns 400 for invalid filingType query", async () => {
    await connectDb();
    const app = createApp();

    const response = await app.request("/api/request-templates?filingType=1120s");
    expect(response.status).toBe(400);

    await disconnectDb();
  });

  test("PATCH replaces items on a template", async () => {
    await connectDb();
    const db = await connectDb();
    await requestTemplatesCollection(db).deleteMany({});
    await requestTemplatesCollection(db).insertOne(toStored(seedRequestTemplates[0]!));

    const app = createApp();
    const newItems = [
      {
        title: "Only P&L",
        description: "Single required item for the test.",
        documentTypeId: "dt-profit-loss",
        required: true,
      },
    ];

    const response = await app.request("/api/request-templates/tpl-1120s", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: newItems }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.template.items).toEqual(newItems);

    await requestTemplatesCollection(db).deleteMany({});
    await disconnectDb();
  });

  test("PATCH returns 404 for unknown template id", async () => {
    await connectDb();
    const app = createApp();

    const response = await app.request("/api/request-templates/missing-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            title: "Item",
            description: "Desc",
            documentTypeId: "dt-profit-loss",
            required: true,
          },
        ],
      }),
    });

    expect(response.status).toBe(404);

    await disconnectDb();
  });
});
