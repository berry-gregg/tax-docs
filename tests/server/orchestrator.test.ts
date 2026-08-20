import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { unlink } from "node:fs/promises";
import type {
  OpenRouterClient,
  StructuredRequest,
  UserPart,
} from "../../src/server/ai/openrouter.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  activitiesCollection,
  documentTypesCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { saveUploadedFile } from "../../src/server/files/storage.ts";
import { reclassifyDocument, runPipeline } from "../../src/server/pipeline/orchestrator.ts";
import { createRunner } from "../../src/server/pipeline/runner.ts";
import { activitySchema, type Activity } from "../../src/shared/schemas/activity.ts";
import { taxDocumentSchema, type TaxDocument } from "../../src/shared/schemas/document.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import { engagementSchema, type Engagement } from "../../src/shared/schemas/engagement.ts";
import { requestItemSchema, type RequestItem } from "../../src/shared/schemas/request.ts";

const ENGAGEMENT_ID = "eng-orchestrator";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

const form941: DocumentType = documentTypeSchema.parse({
  id: "dt-941",
  name: "Form 941",
  description: "Employer's quarterly federal tax return.",
  active: true,
  createdBy: "seed",
  createdAt: "2026-01-01T00:00:00.000Z",
  fields: [
    {
      key: "employer_ein",
      label: "Employer EIN",
      metadataType: "ein-tin",
      dataType: "string",
      required: true,
      regex: "^\\d{2}-\\d{7}$",
      description: "Employer identification number.",
    },
    {
      key: "wages_tips_compensation",
      label: "Wages, tips, and compensation",
      metadataType: "dollar-amount",
      dataType: "double",
      required: true,
      description: "Line 2 — total wages, tips, and other compensation.",
    },
    {
      key: "quarter_end_date",
      label: "Quarter end date",
      metadataType: "date",
      dataType: "date",
      required: false,
      description: "Last day of the reported quarter.",
    },
  ],
});

const retiredType: DocumentType = documentTypeSchema.parse({
  id: "dt-retired",
  name: "Retired form",
  description: "A document type the firm switched off.",
  active: false,
  createdBy: "cpa",
  createdAt: "2026-01-01T00:00:00.000Z",
  fields: [
    {
      key: "legacy_total",
      label: "Legacy total",
      metadataType: "total",
      dataType: "double",
      required: true,
      description: "Unused.",
    },
  ],
});

const engagement: Engagement = engagementSchema.parse({
  id: ENGAGEMENT_ID,
  clientId: "client-orchestrator",
  taxYear: 2026,
  filingType: "1120-S",
  status: "collecting",
  portalToken: "token-orchestrator",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function requestItem(partial: Partial<RequestItem> & { id: string }): RequestItem {
  return requestItemSchema.parse({
    engagementId: ENGAGEMENT_ID,
    documentTypeId: form941.id,
    title: `Item ${partial.id}`,
    description: "Upload the quarterly payroll return.",
    required: true,
    status: "open",
    matchedDocumentIds: [],
    createdAt: "2026-02-01T00:00:00.000Z",
    ...partial,
  });
}

type ScriptedResponse = unknown | Error;

type RecordedCall = {
  schemaName: string;
  parts: UserPart[];
  documentStatusAtCall: TaxDocument["pipelineStatus"] | "missing";
};

/**
 * Scripted stand-in for the OpenRouter client. It also snapshots the document's persisted
 * pipeline status at call time, which is how the tests prove every transition hit Mongo
 * before the next stage started.
 */
function scriptedAi(
  responses: ScriptedResponse[],
  documentId: string,
): { ai: OpenRouterClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;

  const ai: OpenRouterClient = {
    async completeStructured<T>(req: StructuredRequest<T>): Promise<T> {
      const db = await connectDb();
      const stored = await taxDocumentsCollection(db).findOne({ _id: documentId });
      calls.push({
        schemaName: req.schemaName,
        parts: req.parts,
        documentStatusAtCall: stored
          ? fromStored(taxDocumentSchema, stored).pipelineStatus
          : "missing",
      });

      const next = responses[index];
      index += 1;
      if (next === undefined) {
        throw new Error(`unscripted completeStructured call #${index} (${req.schemaName})`);
      }
      if (next instanceof Error) {
        throw next;
      }
      return req.schema.parse(next);
    },
  };

  return { ai, calls };
}

function textOf(parts: UserPart[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

const storagePaths: string[] = [];

async function seedDocument(
  partial: Partial<TaxDocument> & { id: string },
): Promise<TaxDocument> {
  const storagePath = await saveUploadedFile(partial.id, PDF_BYTES);
  storagePaths.push(storagePath);
  const document = taxDocumentSchema.parse({
    engagementId: ENGAGEMENT_ID,
    filename: "form-941-q1.pdf",
    mimeType: "application/pdf",
    size: PDF_BYTES.byteLength,
    storagePath,
    uploadedBy: "client",
    pipelineStatus: "received",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...partial,
  });
  const db = await connectDb();
  await taxDocumentsCollection(db).insertOne(toStored(document));
  return document;
}

async function loadDocument(id: string): Promise<TaxDocument> {
  const db = await connectDb();
  const stored = await taxDocumentsCollection(db).findOne({ _id: id });
  if (!stored) throw new Error(`document ${id} disappeared`);
  return fromStored(taxDocumentSchema, stored);
}

async function loadItem(id: string): Promise<RequestItem> {
  const db = await connectDb();
  const stored = await requestItemsCollection(db).findOne({ _id: id });
  if (!stored) throw new Error(`request item ${id} disappeared`);
  return fromStored(requestItemSchema, stored);
}

async function loadEngagement(): Promise<Engagement> {
  const db = await connectDb();
  const stored = await engagementsCollection(db).findOne({ _id: ENGAGEMENT_ID });
  if (!stored) throw new Error("engagement disappeared");
  return fromStored(engagementSchema, stored);
}

async function loadActivities(): Promise<Activity[]> {
  const db = await connectDb();
  const docs = await activitiesCollection(db).find({}).toArray();
  return docs.map((doc) => fromStored(activitySchema, doc));
}

async function actionsLogged(): Promise<string[]> {
  return (await loadActivities()).map((entry) => entry.action);
}

beforeEach(async () => {
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    documentTypesCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
  await engagementsCollection(db).insertOne(toStored(engagement));
  await documentTypesCollection(db).insertOne(toStored(form941));
  await documentTypesCollection(db).insertOne(toStored(retiredType));
});

afterEach(async () => {
  await Promise.all(storagePaths.map((path) => unlink(path).catch(() => undefined)));
  storagePaths.length = 0;
  const db = await connectDb();
  await Promise.all([
    activitiesCollection(db).deleteMany({}),
    documentTypesCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
  await disconnectDb();
});

describe("runPipeline happy path", () => {
  test("walks received to needs-review, matching the oldest open checklist item and bumping the engagement", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-oldest", createdAt: "2026-01-05T00:00:00.000Z" })),
    );
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-newer", createdAt: "2026-02-05T00:00:00.000Z" })),
    );
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-other-type", documentTypeId: "dt-retired" })),
    );
    const document = await seedDocument({ id: "doc-happy" });

    const { ai, calls } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.95, reason: "Quarterly payroll return" },
        { documentTypeId: form941.id, confidence: 0.91, reasoning: "Form 941 layout" },
        {
          fields: [
            {
              key: "employer_ein",
              value: "12-3456789",
              confidence: 0.94,
              sourceSnippet: "EIN 12-3456789",
            },
            {
              key: "wages_tips_compensation",
              value: "$512,000.00",
              confidence: 0.88,
              sourceSnippet: "Line 2 512,000.00",
            },
          ],
        },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect(calls.map((call) => call.schemaName)).toEqual([
      "quality_result",
      "classify_result",
      "raw_extraction",
    ]);
    expect(calls.map((call) => call.documentStatusAtCall)).toEqual([
      "quality-review",
      "classifying",
      "extracting",
    ]);
    expect(textOf(calls[1]!.parts)).toContain(form941.id);
    expect(textOf(calls[1]!.parts)).not.toContain(retiredType.id);

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("needs-review");
    expect(finished.classification).toEqual({
      documentTypeId: form941.id,
      confidence: 0.91,
      reasoning: "Form 941 layout",
    });
    expect(finished.requestItemId).toBe("item-oldest");
    expect(finished.updatedAt > document.updatedAt).toBe(true);
    expect(finished.extraction?.fields.map((field) => field.key)).toEqual([
      "employer_ein",
      "wages_tips_compensation",
      "quarter_end_date",
    ]);
    expect(finished.extraction?.fields[1]).toMatchObject({
      value: 512000,
      notFound: false,
    });
    expect(finished.extraction?.fields[2]).toMatchObject({
      value: null,
      notFound: true,
      confidence: 0,
    });

    expect(await loadItem("item-oldest")).toMatchObject({
      status: "received",
      matchedDocumentIds: [document.id],
    });
    expect((await loadItem("item-newer")).status).toBe("open");
    expect((await loadEngagement()).status).toBe("in-review");

    const activities = await loadActivities();
    expect(activities.length).toBeGreaterThanOrEqual(1);
    const matched = activities.find((entry) => entry.action === "checklist-item-matched");
    // Visible in the inbox thread: it is the client's request being fulfilled.
    expect(matched).toMatchObject({
      actor: "agent",
      direction: "inbound",
      requestItemId: "item-oldest",
    });
    const extracted = activities.find((entry) => entry.action === "document-extracted");
    expect(extracted).toMatchObject({ actor: "agent", direction: "inbound", documentId: document.id });
    expect(extracted?.detail).toContain("3");
    expect(extracted?.detail).toContain("1 not found");
  });

  test("marks an already-linked checklist item received without stealing another item", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-linked" })));
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-untouched" })));
    const document = await seedDocument({ id: "doc-prelinked", requestItemId: "item-linked" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.8, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect((await loadDocument(document.id)).requestItemId).toBe("item-linked");
    expect(await loadItem("item-linked")).toMatchObject({
      status: "received",
      matchedDocumentIds: [document.id],
    });
    expect((await loadItem("item-untouched")).status).toBe("open");
  });

  test("matches the earliest-created open item, not whichever landed in the collection first", async () => {
    const db = await connectDb();
    // Inserted newest-first so a natural-order scan would pick the wrong item.
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-later", createdAt: "2026-03-01T00:00:00.000Z" })),
    );
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-earlier", createdAt: "2026-01-05T00:00:00.000Z" })),
    );
    const document = await seedDocument({ id: "doc-oldest-wins" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.9, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect((await loadDocument(document.id)).requestItemId).toBe("item-earlier");
    expect(await loadItem("item-earlier")).toMatchObject({
      status: "received",
      matchedDocumentIds: [document.id],
    });
    expect(await loadItem("item-later")).toMatchObject({
      status: "open",
      matchedDocumentIds: [],
    });
  });

  test("leaves a pre-linked checklist item alone when its type does not match the classification", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-wrong-type", documentTypeId: retiredType.id })),
    );
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-right-type" })));
    const document = await seedDocument({
      id: "doc-type-mismatch",
      filename: "bank-statement.pdf",
      requestItemId: "item-wrong-type",
    });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "A tax document" },
        { documentTypeId: form941.id, confidence: 0.9, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("needs-review");
    expect(finished.requestItemId).toBe("item-wrong-type");
    expect(await loadItem("item-wrong-type")).toMatchObject({
      status: "open",
      matchedDocumentIds: [],
    });
    expect(await loadItem("item-right-type")).toMatchObject({
      status: "open",
      matchedDocumentIds: [],
    });
    expect(await actionsLogged()).not.toContain("checklist-item-matched");
  });

  test("leaves a non-collecting engagement status alone", async () => {
    const db = await connectDb();
    await engagementsCollection(db).replaceOne(
      { _id: ENGAGEMENT_ID },
      toStored(engagementSchema.parse({ ...engagement, status: "ready-to-export" })),
    );
    const document = await seedDocument({ id: "doc-no-bump" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.8, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect((await loadDocument(document.id)).pipelineStatus).toBe("needs-review");
    expect((await loadEngagement()).status).toBe("ready-to-export");
  });
});

describe("runPipeline multi-file matching", () => {
  test("a second file of the same type appends to the already-received item", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(
      toStored(
        requestItem({
          id: "item-multi",
          status: "received",
          matchedDocumentIds: ["doc-first"],
        }),
      ),
    );
    const document = await seedDocument({ id: "doc-second", filename: "form-941-q2.pdf" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.92, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect((await loadDocument(document.id)).requestItemId).toBe("item-multi");
    expect(await loadItem("item-multi")).toMatchObject({
      status: "received",
      matchedDocumentIds: ["doc-first", document.id],
    });

    const matched = (await loadActivities()).find(
      (entry) => entry.action === "checklist-item-matched",
    );
    expect(matched).toMatchObject({ requestItemId: "item-multi", direction: "inbound" });
    expect(matched?.detail).toContain("form-941-q2.pdf");
  });

  test("an open item still wins over an older received item of the same type", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(
      toStored(
        requestItem({
          id: "item-full",
          status: "received",
          matchedDocumentIds: ["doc-first"],
          createdAt: "2026-01-05T00:00:00.000Z",
        }),
      ),
    );
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-still-open", createdAt: "2026-02-05T00:00:00.000Z" })),
    );
    const document = await seedDocument({ id: "doc-prefers-open" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.92, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect((await loadDocument(document.id)).requestItemId).toBe("item-still-open");
    expect(await loadItem("item-still-open")).toMatchObject({
      status: "received",
      matchedDocumentIds: [document.id],
    });
    expect(await loadItem("item-full")).toMatchObject({
      matchedDocumentIds: ["doc-first"],
    });
  });

  test("a waived item never collects files", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(
      toStored(requestItem({ id: "item-waived", status: "waived" })),
    );
    const document = await seedDocument({ id: "doc-vs-waived" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.92, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("needs-review");
    expect(finished.requestItemId).toBeUndefined();
    expect(await loadItem("item-waived")).toMatchObject({
      status: "waived",
      matchedDocumentIds: [],
    });
    expect(await actionsLogged()).not.toContain("checklist-item-matched");
  });
});

describe("runPipeline rejection lane", () => {
  test("an irrelevant document is rejected and flips its checklist item to needs-attention", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-rejected" })));
    const document = await seedDocument({
      id: "doc-irrelevant",
      filename: "vacation-photo.pdf",
      requestItemId: "item-rejected",
    });

    const { ai, calls } = scriptedAi(
      [
        {
          relevant: false,
          legible: true,
          confidence: 0.97,
          reason: "A holiday photo, not a tax document",
        },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect(calls).toHaveLength(1);
    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("rejected");
    expect(finished.rejection).toEqual({
      kind: "irrelevant",
      reason: "A holiday photo, not a tax document",
    });
    expect(finished.classification).toBeUndefined();

    expect((await loadItem("item-rejected")).status).toBe("needs-attention");

    const activities = await loadActivities();
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      action: "document-rejected",
      actor: "agent",
      direction: "inbound",
      engagementId: ENGAGEMENT_ID,
      documentId: document.id,
    });
    expect(activities[0]?.detail).toContain("A holiday photo, not a tax document");
  });

  test("an illegible but relevant document is rejected as unreadable", async () => {
    const document = await seedDocument({ id: "doc-illegible" });

    const { ai } = scriptedAi(
      [{ relevant: true, legible: false, confidence: 0.7, reason: "Scan is too blurry to read" }],
      document.id,
    );

    await runPipeline(document.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("rejected");
    expect(finished.rejection?.kind).toBe("unreadable");
    expect(await actionsLogged()).toEqual(["document-rejected"]);
  });
});

describe("runPipeline unclassified lane", () => {
  test("low classify confidence stores the classification and stops at unclassified", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-unmatched" })));
    const document = await seedDocument({ id: "doc-low-confidence" });

    const { ai, calls } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Looks like a tax form" },
        { documentTypeId: form941.id, confidence: 0.4, reasoning: "Might be a 941" },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    expect(calls).toHaveLength(2);
    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("unclassified");
    expect(finished.classification).toEqual({
      documentTypeId: form941.id,
      confidence: 0.4,
      reasoning: "Might be a 941",
    });
    expect(finished.extraction).toBeUndefined();
    expect(finished.requestItemId).toBeUndefined();
    expect((await loadItem("item-unmatched")).status).toBe("open");

    const activities = await loadActivities();
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      action: "document-unclassified",
      actor: "agent",
      direction: "inbound",
      documentId: document.id,
    });
  });

  test("a null documentTypeId lands in unclassified", async () => {
    const document = await seedDocument({ id: "doc-null-type" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Some statement" },
        { documentTypeId: null, confidence: 0.99, reasoning: "No candidate matches" },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("unclassified");
    expect(finished.classification?.documentTypeId).toBeNull();
    expect(await actionsLogged()).toEqual(["document-unclassified"]);
  });

  test("a document type id that is not an active candidate lands in unclassified, not failed", async () => {
    const document = await seedDocument({ id: "doc-unknown-type" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Some statement" },
        { documentTypeId: retiredType.id, confidence: 0.99, reasoning: "Retired type" },
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("unclassified");
    expect(finished.classification?.documentTypeId).toBe(retiredType.id);
    expect(await actionsLogged()).toEqual(["document-unclassified"]);
  });
});

describe("runPipeline failure lane", () => {
  test("a throwing extract stage lands in failed with the underlying message", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-failed" })));
    const document = await seedDocument({ id: "doc-extract-throws" });

    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.95, reasoning: "Form 941" },
        new Error('OpenRouter request for "raw_extraction" failed with status 429: rate limited'),
      ],
      document.id,
    );

    await runPipeline(document.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("failed");
    expect(finished.failure?.message).toBe(
      'OpenRouter request for "raw_extraction" failed with status 429: rate limited',
    );
    expect(finished.classification?.documentTypeId).toBe(form941.id);

    const activities = await loadActivities();
    const failed = activities.find((entry) => entry.action === "document-failed");
    expect(failed).toMatchObject({ actor: "agent" });
    expect(failed?.detail).toContain("rate limited");
  });

  test("a missing stored file fails the document instead of leaving it mid-state", async () => {
    const db = await connectDb();
    const document = taxDocumentSchema.parse({
      id: "doc-missing-file",
      engagementId: ENGAGEMENT_ID,
      filename: "ghost.pdf",
      mimeType: "application/pdf",
      size: 10,
      storagePath: "data/uploads/doc-missing-file-does-not-exist.pdf",
      uploadedBy: "cpa",
      pipelineStatus: "received",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    await taxDocumentsCollection(db).insertOne(toStored(document));

    const { ai, calls } = scriptedAi([], document.id);

    await runPipeline(document.id, { ai });

    expect(calls).toHaveLength(0);
    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("failed");
    expect(finished.failure?.message.length ?? 0).toBeGreaterThan(0);
    expect(await actionsLogged()).toEqual(["document-failed"]);
  });

  test("a missing document surfaces its own error rather than failing silently", async () => {
    const { ai } = scriptedAi([], "doc-nowhere");

    await expect(runPipeline("doc-nowhere", { ai })).rejects.toThrow("doc-nowhere");
  });
});

const bankStatement: DocumentType = documentTypeSchema.parse({
  id: "dt-bank-statement",
  name: "Bank statement",
  description: "Monthly business bank statement.",
  active: true,
  createdBy: "seed",
  createdAt: "2026-01-01T00:00:00.000Z",
  fields: [
    {
      key: "ending_balance",
      label: "Ending balance",
      metadataType: "dollar-amount",
      dataType: "double",
      required: true,
      description: "Statement ending balance.",
    },
  ],
});

const staleBankField = {
  key: "ending_balance",
  label: "Ending balance",
  metadataType: "dollar-amount" as const,
  dataType: "double" as const,
  value: 4200,
  confidence: 0.7,
  sourceSnippet: "Ending balance 4,200.00",
  notFound: false,
  regexPass: null,
  reviewStatus: "unreviewed" as const,
};

describe("reclassifyDocument", () => {
  test("overwrites classification with the reviewer's choice, relinks the checklist, and re-extracts", async () => {
    const db = await connectDb();
    await documentTypesCollection(db).insertOne(toStored(bankStatement));
    await requestItemsCollection(db).insertOne(
      toStored(
        requestItem({
          id: "item-bank",
          documentTypeId: bankStatement.id,
          status: "received",
          matchedDocumentIds: ["doc-misclassified"],
        }),
      ),
    );
    await requestItemsCollection(db).insertOne(toStored(requestItem({ id: "item-941" })));
    const document = await seedDocument({
      id: "doc-misclassified",
      pipelineStatus: "needs-review",
      requestItemId: "item-bank",
      classification: {
        documentTypeId: bankStatement.id,
        confidence: 0.62,
        reasoning: "Columns of running balances",
      },
      extraction: { fields: [staleBankField] },
      failure: { message: "a stale failure from an earlier run" },
    });

    const { ai, calls } = scriptedAi(
      [
        {
          fields: [
            {
              key: "employer_ein",
              value: "12-3456789",
              confidence: 0.94,
              sourceSnippet: "EIN 12-3456789",
            },
          ],
        },
      ],
      document.id,
    );

    await reclassifyDocument(document.id, form941.id, { ai });

    // Extract-only continuation: no quality or classify calls, and the status had already
    // hit Mongo as extracting before the model ran.
    expect(calls.map((call) => call.schemaName)).toEqual(["raw_extraction"]);
    expect(calls.map((call) => call.documentStatusAtCall)).toEqual(["extracting"]);

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("needs-review");
    expect(finished.classification).toEqual({
      documentTypeId: form941.id,
      confidence: 1,
      reasoning: "Reclassified by reviewer",
    });
    expect(finished.failure).toBeUndefined();
    expect(finished.extraction?.fields.map((field) => field.key)).toEqual([
      "employer_ein",
      "wages_tips_compensation",
      "quarter_end_date",
    ]);

    // The wrong-type item released the document; the right-type open item collected it.
    expect(finished.requestItemId).toBe("item-941");
    expect(await loadItem("item-bank")).toMatchObject({
      status: "open",
      matchedDocumentIds: [],
    });
    expect(await loadItem("item-941")).toMatchObject({
      status: "received",
      matchedDocumentIds: [document.id],
    });

    const activities = await loadActivities();
    const reclassified = activities.find((entry) => entry.action === "document-reclassified");
    expect(reclassified).toMatchObject({
      actor: "cpa",
      direction: "internal",
      documentId: document.id,
    });
    expect(reclassified?.detail).toContain("Form 941");
    expect(activities.map((entry) => entry.action)).toContain("document-extracted");
  });

  test("unlinking leaves a multi-document item received for its remaining files", async () => {
    const db = await connectDb();
    await documentTypesCollection(db).insertOne(toStored(bankStatement));
    await requestItemsCollection(db).insertOne(
      toStored(
        requestItem({
          id: "item-multi-bank",
          documentTypeId: bankStatement.id,
          status: "received",
          matchedDocumentIds: ["doc-other-statement", "doc-second-statement"],
        }),
      ),
    );
    const document = await seedDocument({
      id: "doc-second-statement",
      pipelineStatus: "needs-review",
      requestItemId: "item-multi-bank",
      classification: {
        documentTypeId: bankStatement.id,
        confidence: 0.7,
        reasoning: "Bank statement layout",
      },
      extraction: { fields: [staleBankField] },
    });

    const { ai } = scriptedAi([{ fields: [] }], document.id);

    await reclassifyDocument(document.id, form941.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("needs-review");
    // No open Form 941 item exists, so the document ends unlinked.
    expect(finished.requestItemId).toBeUndefined();
    expect(await loadItem("item-multi-bank")).toMatchObject({
      status: "received",
      matchedDocumentIds: ["doc-other-statement"],
    });
  });

  test("a throwing extract stage lands in failed with the underlying message", async () => {
    const document = await seedDocument({
      id: "doc-reclassify-throws",
      pipelineStatus: "needs-review",
      classification: {
        documentTypeId: bankStatement.id,
        confidence: 0.6,
        reasoning: "Bank statement layout",
      },
      extraction: { fields: [staleBankField] },
    });

    const { ai } = scriptedAi(
      [new Error('OpenRouter request for "raw_extraction" failed with status 429: rate limited')],
      document.id,
    );

    await reclassifyDocument(document.id, form941.id, { ai });

    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("failed");
    expect(finished.failure?.message).toContain("rate limited");
    expect(await actionsLogged()).toContain("document-failed");
  });

  test("an inactive target type fails the document with the real cause instead of extracting", async () => {
    const document = await seedDocument({
      id: "doc-reclassify-retired",
      pipelineStatus: "needs-review",
      classification: {
        documentTypeId: bankStatement.id,
        confidence: 0.6,
        reasoning: "Bank statement layout",
      },
    });

    const { ai, calls } = scriptedAi([], document.id);

    await reclassifyDocument(document.id, retiredType.id, { ai });

    expect(calls).toHaveLength(0);
    const finished = await loadDocument(document.id);
    expect(finished.pipelineStatus).toBe("failed");
    expect(finished.failure?.message).toContain(retiredType.id);
    // The reviewer's choice never landed, so the prior classification survives.
    expect(finished.classification?.documentTypeId).toBe(bankStatement.id);
  });

  test("a missing document surfaces its own error rather than failing silently", async () => {
    const { ai } = scriptedAi([], "doc-reclassify-nowhere");

    await expect(reclassifyDocument("doc-reclassify-nowhere", form941.id, { ai })).rejects.toThrow(
      "doc-reclassify-nowhere",
    );
  });
});

describe("createRunner", () => {
  test("start returns immediately and drives the document to a terminal state", async () => {
    const document = await seedDocument({ id: "doc-runner" });
    const { ai } = scriptedAi(
      [
        { relevant: true, legible: true, confidence: 0.9, reason: "Payroll return" },
        { documentTypeId: form941.id, confidence: 0.95, reasoning: "Form 941" },
        { fields: [] },
      ],
      document.id,
    );

    const runner = createRunner({ ai });
    expect(runner.start(document.id)).toBeUndefined();

    const finished = await waitForStatus(document.id, "needs-review");
    expect(finished.pipelineStatus).toBe("needs-review");
  });

  test("startReclassify returns immediately and drives the extract-only continuation to needs-review", async () => {
    const document = await seedDocument({
      id: "doc-runner-reclassify",
      pipelineStatus: "needs-review",
      classification: {
        documentTypeId: bankStatement.id,
        confidence: 0.6,
        reasoning: "Bank statement layout",
      },
      extraction: { fields: [staleBankField] },
    });
    const { ai } = scriptedAi([{ fields: [] }], document.id);

    const runner = createRunner({ ai });
    expect(runner.startReclassify(document.id, form941.id)).toBeUndefined();

    await waitFor(async () => {
      const current = await loadDocument(document.id);
      return current.classification?.documentTypeId === form941.id
        && current.pipelineStatus === "needs-review";
    });
    const finished = await loadDocument(document.id);
    expect(finished.classification?.reasoning).toBe("Reclassified by reviewer");
    expect(finished.extraction?.fields.map((field) => field.key)).toEqual([
      "employer_ein",
      "wages_tips_compensation",
      "quarter_end_date",
    ]);
  });

  test("logs and swallows a rejected run so an unknown document never crashes the server", async () => {
    const { ai } = scriptedAi([], "doc-unknown-runner");
    const runner = createRunner({ ai });
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => runner.start("doc-unknown-runner")).not.toThrow();
      await waitFor(() => logged.mock.calls.length > 0);
      expect(logged.mock.calls.flat().join(" ")).toContain("doc-unknown-runner");
    } finally {
      logged.mockRestore();
    }
  });
});

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("condition never became true");
}

async function waitForStatus(
  id: string,
  status: TaxDocument["pipelineStatus"],
): Promise<TaxDocument> {
  await waitFor(async () => (await loadDocument(id)).pipelineStatus === status);
  return loadDocument(id);
}
