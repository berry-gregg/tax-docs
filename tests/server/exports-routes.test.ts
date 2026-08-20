import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  engineExportsCollection,
  requestItemsCollection,
  requestTemplatesCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import type { ExtractionField, TaxDocument } from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";

const now = "2026-04-01T00:00:00.000Z";

const client: Client = {
  id: "client-exports-routes",
  legalName: "Bluebird Robotics LLC",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Maya Chen",
  contactEmail: "maya@bluebird.example",
  city: "Denver",
  state: "CO",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const engagement: Engagement = {
  id: "eng-exports-routes",
  clientId: client.id,
  taxYear: 2026,
  filingType: "1120-S",
  status: "ready-to-export",
  portalToken: "portal-exports-routes",
  createdAt: now,
  updatedAt: now,
};

function moneyField(key: string, value: number): ExtractionField {
  return {
    key,
    label: key,
    metadataType: "dollar-amount",
    dataType: "double",
    value,
    confidence: 0.95,
    sourceSnippet: `${key}: ${value}`,
    notFound: false,
    regexPass: true,
    reviewStatus: "accepted",
  };
}

function documentWithFields(partial: Pick<TaxDocument, "id" | "pipelineStatus" | "classification" | "extraction">): TaxDocument {
  return {
    id: partial.id,
    engagementId: engagement.id,
    filename: `${partial.id}.pdf`,
    mimeType: "application/pdf",
    size: 12,
    storagePath: `data/uploads/${partial.id}.pdf`,
    uploadedBy: "cpa",
    pipelineStatus: partial.pipelineStatus,
    classification: partial.classification,
    extraction: partial.extraction,
    createdAt: now,
    updatedAt: now,
  };
}

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    clientsCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    engineExportsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    requestTemplatesCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
}

async function seedBaseData() {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(client));
  await engagementsCollection(db).insertOne(toStored(engagement));
}

async function seedTrustedProfitLoss() {
  const db = await connectDb();
  await taxDocumentsCollection(db).insertMany([
    toStored(documentWithFields({
      id: "doc-pl-trusted",
      pipelineStatus: "trusted",
      classification: { documentTypeId: "dt-profit-loss", confidence: 0.95, reasoning: "P&L" },
      extraction: {
        fields: [
          moneyField("gross_receipts", 150000),
          moneyField("officer_compensation", 50000),
          moneyField("salaries_wages", 70000),
          moneyField("rents", 12000),
          moneyField("taxes_licenses", 3000),
          moneyField("depreciation", 8000),
          moneyField("advertising", 4500),
          moneyField("net_income", 32000),
        ],
      },
    })),
    toStored(documentWithFields({
      id: "doc-pl-untrusted",
      pipelineStatus: "needs-review",
      classification: { documentTypeId: "dt-profit-loss", confidence: 0.95, reasoning: "P&L" },
      extraction: { fields: [moneyField("gross_receipts", 999999)] },
    })),
  ]);
}

beforeEach(async () => {
  await clearCollections();
  await seedBaseData();
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("export routes", () => {
  test("builds a draft export from trusted documents and leaves missing source lines null", async () => {
    const app = createApp();
    await seedTrustedProfitLoss();

    const response = await app.request(`/api/engagements/${engagement.id}/export`, { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.export).toMatchObject({
      engagementId: engagement.id,
      status: "draft",
    });
    expect(body.export.lines.find((line: { engineForm: string; lineId: string }) =>
      line.engineForm === "Form 1120-S" && line.lineId === "1a"
    )).toMatchObject({
      value: 150000,
      sourceRefs: [{ documentId: "doc-pl-trusted", fieldKey: "gross_receipts" }],
    });
    expect(body.export.lines.find((line: { engineForm: string; lineId: string }) =>
      line.engineForm === "Item F" && line.lineId === "total-assets"
    )).toMatchObject({
      value: null,
      sourceRefs: [],
    });
    expect(JSON.parse(body.export.payloadJson)).toMatchObject({
      engine: "tax-engine-generic",
      filingType: "1120-S",
      taxYear: 2026,
      client: { legalName: client.legalName, ein: client.ein },
    });

    const getResponse = await app.request(`/api/engagements/${engagement.id}/export`);
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.export.id).toBe(body.export.id);
  });

  test("returns 409 when no trusted source contributes any export line", async () => {
    const app = createApp();

    const response = await app.request(`/api/engagements/${engagement.id}/export`, { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "No trusted documents to export" });
  });

  test("confirms a draft once, updates engagement state, records activity, and downloads the payload", async () => {
    const app = createApp();
    await seedTrustedProfitLoss();

    const buildResponse = await app.request(`/api/engagements/${engagement.id}/export`, { method: "POST" });
    const buildBody = await buildResponse.json();

    const confirmResponse = await app.request(`/api/exports/${buildBody.export.id}/confirm`, { method: "POST" });
    const confirmBody = await confirmResponse.json();

    expect(confirmResponse.status).toBe(200);
    expect(confirmBody.export.status).toBe("sent");
    expect(confirmBody.export.confirmedAt).toBeString();

    const db = await connectDb();
    const storedEngagement = await engagementsCollection(db).findOne({ _id: engagement.id });
    expect(storedEngagement?.status).toBe("exported");
    const activity = await activitiesCollection(db).findOne({
      engagementId: engagement.id,
      action: "sent-to-engine",
    });
    expect(activity).toMatchObject({
      actor: "cpa",
      direction: "outbound",
    });

    const secondConfirmResponse = await app.request(`/api/exports/${buildBody.export.id}/confirm`, { method: "POST" });
    const secondConfirmBody = await secondConfirmResponse.json();
    expect(secondConfirmResponse.status).toBe(409);
    expect(secondConfirmBody.error).toContain("draft");

    const payloadResponse = await app.request(`/api/exports/${buildBody.export.id}/payload`);
    expect(payloadResponse.status).toBe(200);
    expect(payloadResponse.headers.get("Content-Type")).toContain("application/json");
    expect(payloadResponse.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Bluebird-Robotics-LLC-2026-1120-S.json"',
    );
    expect(await payloadResponse.text()).toBe(buildBody.export.payloadJson);
  });
});
