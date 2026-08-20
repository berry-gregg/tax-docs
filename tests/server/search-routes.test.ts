import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  clientsCollection,
  documentTypesCollection,
  engagementsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { clientSchema, type Client } from "../../src/shared/schemas/client.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import { taxDocumentSchema, type TaxDocument } from "../../src/shared/schemas/document.ts";
import { engagementSchema, type Engagement } from "../../src/shared/schemas/engagement.ts";
import { searchResponseSchema, type SearchResult } from "../../src/shared/schemas/search.ts";

const NOW = "2026-04-01T00:00:00.000Z";

function makeClient(partial: Pick<Client, "id" | "legalName" | "ein">): Client {
  return clientSchema.parse({
    entityType: "s-corp",
    contactName: "Maya Chen",
    contactEmail: "maya@example.test",
    city: "Denver",
    state: "CO",
    createdAt: NOW,
    ...partial,
  });
}

function makeEngagement(
  partial: Pick<Engagement, "id" | "clientId" | "taxYear" | "filingType">,
): Engagement {
  return engagementSchema.parse({
    status: "collecting",
    portalToken: `tok-${partial.id}`,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  });
}

function makeDocument(
  partial: Pick<TaxDocument, "id" | "engagementId" | "filename"> &
    Partial<Pick<TaxDocument, "classification">>,
): TaxDocument {
  return taxDocumentSchema.parse({
    mimeType: "application/pdf",
    size: 12,
    storagePath: `data/uploads/${partial.id}.pdf`,
    uploadedBy: "cpa",
    pipelineStatus: "received",
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  });
}

function makeDocumentType(
  partial: Pick<DocumentType, "id" | "name" | "description">,
): DocumentType {
  return documentTypeSchema.parse({
    active: true,
    createdBy: "seed",
    fields: [
      {
        key: "total_wages",
        label: "Total wages",
        metadataType: "dollar-amount",
        dataType: "double",
        required: true,
        description: "Total wages for the year.",
      },
    ],
    createdAt: NOW,
    ...partial,
  });
}

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    clientsCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
    documentTypesCollection(db).deleteMany({}),
  ]);
}

async function seedBook() {
  const db = await connectDb();
  await clientsCollection(db).insertMany(
    [
      makeClient({ id: "client-north", legalName: "Northwind Partners LLC", ein: "12-3456789" }),
      makeClient({ id: "client-blue", legalName: "Bluebird Robotics LLC", ein: "98-7654321" }),
    ].map((client) => toStored(client)),
  );
  await engagementsCollection(db).insertMany(
    [
      makeEngagement({ id: "eng-north", clientId: "client-north", taxYear: 2025, filingType: "1065" }),
      makeEngagement({ id: "eng-blue", clientId: "client-blue", taxYear: 2024, filingType: "1120-S" }),
    ].map((engagement) => toStored(engagement)),
  );
  await documentTypesCollection(db).insertMany(
    [
      makeDocumentType({
        id: "type-w2",
        name: "W-2 wage statement",
        description: "Employee wage and tax statement.",
      }),
      makeDocumentType({
        id: "type-k1",
        name: "Schedule K-1",
        description: "Partner share of income and deductions.",
      }),
    ].map((documentType) => toStored(documentType)),
  );
  await taxDocumentsCollection(db).insertMany(
    [
      makeDocument({
        id: "doc-w2",
        engagementId: "eng-north",
        filename: "w-2 (final).pdf",
        classification: { documentTypeId: "type-w2", confidence: 0.9, reasoning: "W-2 layout" },
      }),
      makeDocument({ id: "doc-bank", engagementId: "eng-blue", filename: "bank-statement.pdf" }),
    ].map((document) => toStored(document)),
  );
}

async function search(query: string): Promise<{ status: number; results: SearchResult[] }> {
  const app = createApp();
  const response = await app.request(`/api/search?q=${encodeURIComponent(query)}`);
  if (response.status !== 200) {
    return { status: response.status, results: [] };
  }

  const body = searchResponseSchema.parse(await response.json());
  return { status: response.status, results: body.results };
}

function group(results: SearchResult[], id: SearchResult["group"]): SearchResult[] {
  return results.filter((result) => result.group === id);
}

beforeEach(async () => {
  await clearCollections();
  await seedBook();
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("GET /api/search", () => {
  test("matches clients by legal name substring, case-insensitively", async () => {
    const { status, results } = await search("NORTHWIND");

    expect(status).toBe(200);
    expect(group(results, "Clients")).toEqual([
      {
        id: "client-north",
        group: "Clients",
        label: "Northwind Partners LLC",
        href: "/clients/client-north",
      },
    ]);
  });

  test("matches clients by EIN substring", async () => {
    const { results } = await search("3456789");

    expect(group(results, "Clients").map((result) => result.id)).toEqual(["client-north"]);
  });

  test("matches engagements by joined client name with a composed label", async () => {
    const { results } = await search("northwind");

    expect(group(results, "Engagements")).toEqual([
      {
        id: "eng-north",
        group: "Engagements",
        label: "Northwind Partners LLC · 2025 1065",
        href: "/engagements/eng-north",
      },
    ]);
  });

  test("matches engagements by tax year and filing type substrings", async () => {
    const byYear = await search("2024");
    expect(group(byYear.results, "Engagements").map((result) => result.id)).toEqual(["eng-blue"]);

    const byFiling = await search("1120");
    expect(group(byFiling.results, "Engagements").map((result) => result.id)).toEqual(["eng-blue"]);
  });

  test("matches documents by filename with the joined client in the label", async () => {
    const { results } = await search("bank");

    expect(group(results, "Documents")).toEqual([
      {
        id: "doc-bank",
        group: "Documents",
        label: "bank-statement.pdf · Bluebird Robotics LLC",
        href: "/documents/doc-bank",
      },
    ]);
  });

  test("matches documents through the joined document type name", async () => {
    const { results } = await search("wage statement");

    expect(group(results, "Documents").map((result) => result.id)).toEqual(["doc-w2"]);
  });

  test("matches documents through the joined client name", async () => {
    const { results } = await search("bluebird");

    expect(group(results, "Documents").map((result) => result.id)).toEqual(["doc-bank"]);
  });

  test("matches document types by name and description, linking to settings", async () => {
    const byName = await search("k-1");
    expect(group(byName.results, "Document types")).toEqual([
      {
        id: "type-k1",
        group: "Document types",
        label: "Schedule K-1",
        href: "/settings?tab=document-types",
      },
    ]);

    const byDescription = await search("share of income");
    expect(group(byDescription.results, "Document types").map((result) => result.id)).toEqual([
      "type-k1",
    ]);
  });

  test("treats regex metacharacters as literal text instead of throwing", async () => {
    const { status, results } = await search("w-2 (final)");

    expect(status).toBe(200);
    expect(group(results, "Documents").map((result) => result.id)).toEqual(["doc-w2"]);

    const noMatch = await search(".*");
    expect(noMatch.status).toBe(200);
    expect(noMatch.results).toEqual([]);
  });

  test("empty and whitespace-only queries return no results", async () => {
    const app = createApp();

    const missing = await app.request("/api/search");
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ results: [] });

    const blank = await search("   ");
    expect(blank.status).toBe(200);
    expect(blank.results).toEqual([]);
  });

  test("rejects queries beyond 100 characters with the real cause", async () => {
    const app = createApp();
    const response = await app.request(`/api/search?q=${"a".repeat(101)}`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("caps every group at 8 results", async () => {
    const db = await connectDb();
    await clientsCollection(db).insertMany(
      Array.from({ length: 12 }, (_, i) =>
        toStored(
          makeClient({
            id: `client-cap-${i}`,
            legalName: `Capsearch Holdings ${i}`,
            ein: `00-000000${i}`,
          }),
        ),
      ),
    );

    const { results } = await search("capsearch");
    expect(group(results, "Clients")).toHaveLength(8);
  });
});
