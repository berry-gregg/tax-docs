import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildExportLines, ENGINE_LINE_MAP, mapExportLines } from "../../src/server/export/engine-map.ts";
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
import { seedDocumentTypes } from "../../src/server/seed/definitions.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import type { ExtractionField, TaxDocument } from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";

const now = "2026-04-01T00:00:00.000Z";

const client: Client = {
  id: "client-engine-map",
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
  id: "eng-engine-map",
  clientId: client.id,
  taxYear: 2026,
  filingType: "1120-S",
  status: "ready-to-export",
  portalToken: "portal-engine-map",
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

beforeEach(async () => {
  await clearCollections();
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(client));
  await engagementsCollection(db).insertOne(toStored(engagement));
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("ENGINE_LINE_MAP", () => {
  test("references only seed document types and field keys", () => {
    const seedFieldsByDocumentType = new Map(
      seedDocumentTypes.map((documentType) => [
        documentType.id,
        new Set(documentType.fields.map((field) => field.key)),
      ]),
    );

    for (const lineDefs of Object.values(ENGINE_LINE_MAP)) {
      for (const lineDef of lineDefs) {
        expect(seedFieldsByDocumentType.has(lineDef.source.documentTypeId)).toBe(true);
        expect(seedFieldsByDocumentType.get(lineDef.source.documentTypeId)?.has(lineDef.source.fieldKey)).toBe(true);
      }
    }
  });
});

describe("mapExportLines", () => {
  test("exports a human edit over the extracted value, including one the model could not ground", () => {
    const edited = documentWithFields({
      id: "doc-edited",
      pipelineStatus: "trusted",
      classification: { documentTypeId: "dt-profit-loss", confidence: 0.95, reasoning: "P&L" },
      extraction: {
        fields: [
          { ...moneyField("gross_receipts", 120000), editedValue: 125000, reviewStatus: "edited" },
          {
            ...moneyField("net_income", 0),
            value: null,
            notFound: true,
            sourceSnippet: "",
            editedValue: 45000,
            reviewStatus: "edited",
          },
        ],
      },
    });

    const lines = mapExportLines("1120-S", [edited]);

    expect(lines.find((line) => line.engineForm === "Form 1120-S" && line.lineId === "1a")).toMatchObject({
      value: 125000,
      sourceRefs: [{ documentId: "doc-edited", fieldKey: "gross_receipts" }],
    });
    expect(lines.find((line) => line.engineForm === "Form 1120-S" && line.lineId === "21")).toMatchObject({
      value: 45000,
      sourceRefs: [{ documentId: "doc-edited", fieldKey: "net_income" }],
    });
  });
});

describe("buildExportLines", () => {
  test("sums numeric trusted sources, ignores untrusted documents, and emits null lines for missing sources", async () => {
    const db = await connectDb();
    await taxDocumentsCollection(db).insertMany([
      toStored(documentWithFields({
        id: "doc-pl-trusted-a",
        pipelineStatus: "trusted",
        classification: { documentTypeId: "dt-profit-loss", confidence: 0.95, reasoning: "P&L" },
        extraction: { fields: [moneyField("gross_receipts", 120000), moneyField("net_income", 45000)] },
      })),
      toStored(documentWithFields({
        id: "doc-pl-trusted-b",
        pipelineStatus: "trusted",
        classification: { documentTypeId: "dt-profit-loss", confidence: 0.93, reasoning: "P&L" },
        extraction: { fields: [moneyField("gross_receipts", 30000), moneyField("net_income", 5000)] },
      })),
      toStored(documentWithFields({
        id: "doc-pl-needs-review",
        pipelineStatus: "needs-review",
        classification: { documentTypeId: "dt-profit-loss", confidence: 0.91, reasoning: "P&L" },
        extraction: { fields: [moneyField("gross_receipts", 999999)] },
      })),
    ]);

    const lines = await buildExportLines(engagement.id);

    expect(lines.find((line) => line.engineForm === "Form 1120-S" && line.lineId === "1a")).toMatchObject({
      value: 150000,
      sourceRefs: [
        { documentId: "doc-pl-trusted-a", fieldKey: "gross_receipts" },
        { documentId: "doc-pl-trusted-b", fieldKey: "gross_receipts" },
      ],
    });
    expect(lines.find((line) => line.engineForm === "Item F" && line.lineId === "total-assets")).toMatchObject({
      value: null,
      sourceRefs: [],
    });
  });
});
