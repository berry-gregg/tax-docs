import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { activitySchema } from "../../shared/schemas/activity.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import { exportSchema, type EngineExport } from "../../shared/schemas/export.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  engineExportsCollection,
  fromStored,
  toStored,
} from "../db/collections.ts";
import { buildExportLines } from "../export/engine-map.ts";

export const exportRoutes = new Hono();

type BuildExportResult =
  | { ok: true; exportRecord: EngineExport }
  | { ok: false; status: 404 | 409; error: string };

async function findExport(id: string): Promise<EngineExport | null> {
  const db = await connectDb();
  const doc = await engineExportsCollection(db).findOne({ _id: id });
  return doc ? fromStored(exportSchema, doc) : null;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "client";
}

export async function getLatestExportForEngagement(engagementId: string): Promise<EngineExport | null> {
  const db = await connectDb();
  const doc = await engineExportsCollection(db).findOne(
    { engagementId },
    { sort: { confirmedAt: -1, _id: -1 } },
  );
  return doc ? fromStored(exportSchema, doc) : null;
}

export async function buildDraftExportForEngagement(engagementId: string): Promise<BuildExportResult> {
  const db = await connectDb();
  const engagementDoc = await engagementsCollection(db).findOne({ _id: engagementId });
  if (!engagementDoc) {
    return { ok: false, status: 404, error: "Not found" };
  }

  const engagement = fromStored(engagementSchema, engagementDoc);
  const clientDoc = await clientsCollection(db).findOne({ _id: engagement.clientId });
  if (!clientDoc) {
    return { ok: false, status: 404, error: "Not found" };
  }

  const client = fromStored(clientSchema, clientDoc);
  const lines = await buildExportLines(engagement.id);
  if (lines.every((line) => line.value === null)) {
    return { ok: false, status: 409, error: "No trusted documents to export" };
  }

  const payloadJson = JSON.stringify(
    {
      engine: "tax-engine-generic",
      filingType: engagement.filingType,
      taxYear: engagement.taxYear,
      client: { legalName: client.legalName, ein: client.ein },
      lines,
    },
    null,
    2,
  );
  const existingDraft = await engineExportsCollection(db).findOne({
    engagementId: engagement.id,
    status: "draft",
  });
  const exportRecord = exportSchema.parse({
    id: existingDraft?._id ?? randomUUID(),
    engagementId: engagement.id,
    status: "draft",
    lines,
    payloadJson,
  });

  await engineExportsCollection(db).replaceOne(
    { _id: exportRecord.id },
    toStored(exportRecord),
    { upsert: true },
  );

  return { ok: true, exportRecord };
}

exportRoutes.post("/:id/confirm", async (c) => {
  const db = await connectDb();
  const exportRecord = await findExport(c.req.param("id"));
  if (!exportRecord) {
    return c.json({ error: "Not found" }, 404);
  }
  if (exportRecord.status !== "draft") {
    return c.json({ error: "Export must be draft before confirm" }, 409);
  }

  const engagementDoc = await engagementsCollection(db).findOne({ _id: exportRecord.engagementId });
  if (!engagementDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const now = new Date().toISOString();
  const sentExport = exportSchema.parse({
    ...exportRecord,
    status: "sent",
    confirmedAt: now,
  });
  const engagement = fromStored(engagementSchema, engagementDoc);
  const exportedEngagement = engagementSchema.parse({
    ...engagement,
    status: "exported",
    updatedAt: now,
  });
  const activity = activitySchema.parse({
    id: randomUUID(),
    engagementId: engagement.id,
    actor: "cpa",
    action: "sent-to-engine",
    detail: `Confirmed ${engagement.taxYear} ${engagement.filingType} export`,
    direction: "outbound",
    createdAt: now,
  });

  await engineExportsCollection(db).replaceOne({ _id: sentExport.id }, toStored(sentExport));
  await engagementsCollection(db).replaceOne({ _id: exportedEngagement.id }, toStored(exportedEngagement));
  await activitiesCollection(db).insertOne(toStored(activity));

  return c.json({ export: sentExport });
});

exportRoutes.get("/:id/payload", async (c) => {
  const db = await connectDb();
  const exportRecord = await findExport(c.req.param("id"));
  if (!exportRecord) {
    return c.json({ error: "Not found" }, 404);
  }

  const engagementDoc = await engagementsCollection(db).findOne({ _id: exportRecord.engagementId });
  if (!engagementDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const engagement = fromStored(engagementSchema, engagementDoc);
  const clientDoc = await clientsCollection(db).findOne({ _id: engagement.clientId });
  if (!clientDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const client = fromStored(clientSchema, clientDoc);
  const filename = [
    safeFilenamePart(client.legalName),
    engagement.taxYear,
    safeFilenamePart(engagement.filingType),
  ].join("-");

  return c.text(exportRecord.payloadJson, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}.json"`,
  });
});
