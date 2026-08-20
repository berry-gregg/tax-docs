import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  collectionNames,
  documentTypesCollection,
  engagementsCollection,
  engineExportsCollection,
  fromStored,
  requestItemsCollection,
  requestTemplatesCollection,
  taxDocumentsCollection,
} from "../../src/server/db/collections.ts";
import { figuresSchema, loadDemoFigures } from "../../src/server/seed/figures.ts";
import { seedRequestTemplates } from "../../src/server/seed/definitions.ts";
import { resetAndSeed, seedIfEmpty } from "../../src/server/seed/seed.ts";
import { activitySchema } from "../../src/shared/schemas/activity.ts";
import { clientSchema } from "../../src/shared/schemas/client.ts";
import { taxDocumentSchema } from "../../src/shared/schemas/document.ts";
import { documentTypeSchema } from "../../src/shared/schemas/document-type.ts";
import { engagementSchema } from "../../src/shared/schemas/engagement.ts";
import { exportSchema } from "../../src/shared/schemas/export.ts";
import { requestItemSchema, requestTemplateSchema } from "../../src/shared/schemas/request.ts";

const domainCollectionNames = [
  collectionNames.clients,
  collectionNames.engagements,
  collectionNames.documentTypes,
  collectionNames.requestTemplates,
  collectionNames.requestItems,
  collectionNames.taxDocuments,
  collectionNames.activities,
  collectionNames.engineExports,
] as const;

async function clearDomainCollections() {
  const db = await connectDb();
  await Promise.all(domainCollectionNames.map((name) => db.collection(name).deleteMany({})));
}

async function countsSnapshot() {
  const db = await connectDb();
  return Object.fromEntries(
    await Promise.all(domainCollectionNames.map(async (name) => [name, await db.collection(name).countDocuments()])),
  );
}

async function expectStoredDocumentsParseThroughSchemas() {
  const db = await connectDb();
  (await clientsCollection(db).find().toArray()).forEach((doc) => fromStored(clientSchema, doc));
  (await engagementsCollection(db).find().toArray()).forEach((doc) => fromStored(engagementSchema, doc));
  (await documentTypesCollection(db).find().toArray()).forEach((doc) => fromStored(documentTypeSchema, doc));
  (await requestTemplatesCollection(db).find().toArray()).forEach((doc) => fromStored(requestTemplateSchema, doc));
  (await requestItemsCollection(db).find().toArray()).forEach((doc) => fromStored(requestItemSchema, doc));
  (await taxDocumentsCollection(db).find().toArray()).forEach((doc) => fromStored(taxDocumentSchema, doc));
  (await activitiesCollection(db).find().toArray()).forEach((doc) => fromStored(activitySchema, doc));
  (await engineExportsCollection(db).find().toArray()).forEach((doc) => fromStored(exportSchema, doc));
}

describe("demo seed persistence", () => {
  beforeEach(async () => {
    await clearDomainCollections();
  });

  afterEach(async () => {
    await clearDomainCollections();
    await disconnectDb();
  });

  test("seeds an empty DB once through schemas and leaves a live demo book", async () => {
    const figures = loadDemoFigures();
    expect(figuresSchema.parse(figures).companies.map((company) => company.name)).toEqual([
      "Northgate Millwork, Inc.",
      "Alder Creek Design Studio LLC",
    ]);

    const db = await connectDb();

    expect(await seedIfEmpty(db)).toBe(true);
    await expectStoredDocumentsParseThroughSchemas();

    const countsAfterFirstSeed = await countsSnapshot();
    expect(await seedIfEmpty(db)).toBe(false);
    expect(await countsSnapshot()).toEqual(countsAfterFirstSeed);

    const heroClient = fromStored(clientSchema, (await clientsCollection(db).findOne({
      legalName: "Northgate Millwork, Inc.",
    }))!);
    const heroEngagement = fromStored(engagementSchema, (await engagementsCollection(db).findOne({
      clientId: heroClient.id,
    }))!);
    expect(heroEngagement).toMatchObject({
      filingType: "1120-S",
      taxYear: 2025,
      status: "collecting",
    });

    const heroOpenRequiredItems = (
      await requestItemsCollection(db).find({
        engagementId: heroEngagement.id,
        required: true,
        status: "open",
      }).toArray()
    ).map((doc) => fromStored(requestItemSchema, doc));
    expect(heroOpenRequiredItems.length).toBeGreaterThan(0);

    const heroDocuments = (
      await taxDocumentsCollection(db).find({ engagementId: heroEngagement.id }).toArray()
    ).map((doc) => fromStored(taxDocumentSchema, doc));
    expect(heroDocuments.map((document) => document.storagePath).sort()).toEqual([
      "demo-docs/northgate-balance-sheet-2025.pdf",
      "demo-docs/northgate-trial-balance-2025.pdf",
    ]);
    expect(heroDocuments.every((document) => document.pipelineStatus === "trusted")).toBe(true);
    expect(heroDocuments.flatMap((document) => document.extraction?.fields ?? []).every((field) =>
      field.reviewStatus === "accepted"
    )).toBe(true);

    const spareClient = fromStored(clientSchema, (await clientsCollection(db).findOne({
      legalName: "Alder Creek Design Studio LLC",
    }))!);
    const spareEngagement = fromStored(engagementSchema, (await engagementsCollection(db).findOne({
      clientId: spareClient.id,
    }))!);
    expect(spareEngagement.status).toBe("in-review");

    const spareRequestItems = (
      await requestItemsCollection(db).find({ engagementId: spareEngagement.id }).toArray()
    ).map((doc) => fromStored(requestItemSchema, doc));
    const template1065 = seedRequestTemplates.find((template) => template.filingType === "1065");
    if (!template1065) {
      throw new Error("Missing seeded 1065 request template");
    }
    expect(spareRequestItems.map((item) => item.documentTypeId)).toEqual(
      template1065.items.map((item) => item.documentTypeId),
    );

    const spareNeedsReviewDocuments = (
      await taxDocumentsCollection(db).find({
        engagementId: spareEngagement.id,
        pipelineStatus: "needs-review",
      }).toArray()
    ).map((doc) => fromStored(taxDocumentSchema, doc));
    expect(spareNeedsReviewDocuments.length).toBeGreaterThanOrEqual(1);
    expect(spareNeedsReviewDocuments.map((document) => document.classification?.documentTypeId).sort()).toEqual([
      "dt-k1-1065",
      "dt-k1-1065",
      "dt-profit-loss",
    ]);
    expect(spareNeedsReviewDocuments.flatMap((document) => document.extraction?.fields ?? []).every((field) =>
      field.reviewStatus === "unreviewed"
    )).toBe(true);

    const sentExport = fromStored(exportSchema, (await engineExportsCollection(db).findOne({ status: "sent" }))!);
    expect(sentExport.confirmedAt).toBeString();

    const seededDocuments = (await taxDocumentsCollection(db).find().toArray()).map((doc) =>
      fromStored(taxDocumentSchema, doc)
    );
    for (const document of seededDocuments) {
      expect(document.storagePath.startsWith("demo-docs/")).toBe(true);
      await access(join(process.cwd(), document.storagePath));
    }

    await clientsCollection(db).insertOne({
      _id: "client-extra",
      legalName: "Extra Client LLC",
      entityType: "llc",
      ein: "12-0000000",
      contactName: "Extra Contact",
      contactEmail: "extra@example.com",
      city: "Austin",
      state: "TX",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await resetAndSeed(db);

    await expectStoredDocumentsParseThroughSchemas();
    expect(await clientsCollection(db).findOne({ _id: "client-extra" })).toBeNull();
    expect(await clientsCollection(db).countDocuments()).toBe(3);
    expect(await documentTypesCollection(db).countDocuments()).toBeGreaterThan(0);
  }, 20000);
});
