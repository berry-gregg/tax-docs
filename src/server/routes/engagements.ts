import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { activitySchema, type Activity } from "../../shared/schemas/activity.ts";
import {
  engagementDetailSchema,
  engagementListResponseSchema,
  engagementListRowSchema,
} from "../../shared/schemas/api.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import { taxDocumentSchema } from "../../shared/schemas/document.ts";
import {
  createEngagementInputSchema,
  engagementSchema,
  engagementStatusSchema,
  type Engagement,
} from "../../shared/schemas/engagement.ts";
import {
  createRequestItemInputSchema,
  requestItemSchema,
  requestItemStatusSchema,
  requestTemplateSchema,
  type RequestItem,
} from "../../shared/schemas/request.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  requestTemplatesCollection,
  taxDocumentsCollection,
  toStored,
} from "../db/collections.ts";
import {
  buildDraftExportForEngagement,
  getLatestExportForEngagement,
} from "./exports.ts";
import { computeValidations } from "../validation/checks.ts";

export const engagementRoutes = new Hono();

const createEngagementWithItemsInputSchema = createEngagementInputSchema.extend({
  items: z.array(createRequestItemInputSchema).optional(),
});

const updateEngagementInputSchema = z.object({
  status: engagementStatusSchema,
});

const updateRequestItemInputSchema = z.object({
  status: requestItemStatusSchema.extract(["waived", "open"]).optional(),
  title: createRequestItemInputSchema.shape.title.optional(),
  description: createRequestItemInputSchema.shape.description.optional(),
  required: createRequestItemInputSchema.shape.required.optional(),
});

function zodIssueSummary(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

async function findEngagement(id: string) {
  const db = await connectDb();
  const doc = await engagementsCollection(db).findOne({ _id: id });

  if (!doc) {
    return null;
  }

  return fromStored(engagementSchema, doc);
}

engagementRoutes.get("/", async (c) => {
  const db = await connectDb();
  const engagementDocs = await engagementsCollection(db)
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  const engagements = await Promise.all(
    engagementDocs.map(async (doc) => {
      const engagement = fromStored(engagementSchema, doc);
      const [clientDoc, totalDocuments, needsReviewDocuments, openItems] = await Promise.all([
        clientsCollection(db).findOne({ _id: engagement.clientId }),
        taxDocumentsCollection(db).countDocuments({ engagementId: engagement.id }),
        taxDocumentsCollection(db).countDocuments({
          engagementId: engagement.id,
          pipelineStatus: "needs-review",
        }),
        requestItemsCollection(db).countDocuments({
          engagementId: engagement.id,
          status: "open",
        }),
      ]);
      const client = clientDoc ? fromStored(clientSchema, clientDoc) : null;

      return engagementListRowSchema.parse({
        ...engagement,
        clientName: client?.legalName ?? "Unknown client",
        docCounts: {
          total: totalDocuments,
          needsReview: needsReviewDocuments,
        },
        openItems,
      });
    }),
  );

  return c.json(engagementListResponseSchema.parse({ engagements }));
});

engagementRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createEngagementWithItemsInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const clientDoc = await clientsCollection(db).findOne({ _id: parsed.data.clientId });

  if (!clientDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const templateItems = parsed.data.items
    ? parsed.data.items
    : await (async () => {
        const templateDoc = await requestTemplatesCollection(db).findOne({
          filingType: parsed.data.filingType,
        });

        if (!templateDoc) {
          return [];
        }

        return fromStored(requestTemplateSchema, templateDoc).items;
      })();

  const now = new Date().toISOString();
  const engagement: Engagement = engagementSchema.parse({
    id: randomUUID(),
    clientId: parsed.data.clientId,
    taxYear: parsed.data.taxYear,
    filingType: parsed.data.filingType,
    status: "collecting",
    portalToken: randomUUID(),
    createdAt: now,
    updatedAt: now,
  });

  const requestItems: RequestItem[] = templateItems.map((item) =>
    requestItemSchema.parse({
      id: randomUUID(),
      engagementId: engagement.id,
      ...item,
      status: "open",
      matchedDocumentIds: [],
      createdAt: now,
    }),
  );
  const activity: Activity = activitySchema.parse({
    id: randomUUID(),
    engagementId: engagement.id,
    actor: "cpa",
    action: "request-sent",
    detail: `${requestItems.length} items requested`,
    direction: "outbound",
    createdAt: now,
  });

  await engagementsCollection(db).insertOne(toStored(engagement));
  if (requestItems.length > 0) {
    await requestItemsCollection(db).insertMany(requestItems.map((item) => toStored(item)));
  }
  await activitiesCollection(db).insertOne(toStored(activity));

  return c.json({ engagement }, 201);
});

engagementRoutes.post("/:id/export", async (c) => {
  const result = await buildDraftExportForEngagement(c.req.param("id"));

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json({ export: result.exportRecord });
});

engagementRoutes.get("/:id/export", async (c) => {
  const engagement = await findEngagement(c.req.param("id"));

  if (!engagement) {
    return c.json({ error: "Not found" }, 404);
  }

  const exportRecord = await getLatestExportForEngagement(engagement.id);
  if (!exportRecord) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ export: exportRecord });
});
engagementRoutes.get("/:id/validations", async (c) => {
  const id = c.req.param("id");
  const engagement = await findEngagement(id);

  if (!engagement) {
    return c.json({ error: "Not found" }, 404);
  }

  const checks = await computeValidations(id);

  return c.json({ checks });
});

engagementRoutes.get("/:id", async (c) => {
  const db = await connectDb();
  const id = c.req.param("id");
  const engagement = await findEngagement(id);

  if (!engagement) {
    return c.json({ error: "Not found" }, 404);
  }

  const [clientDoc, requestItemDocs, documentDocs, activityDocs] = await Promise.all([
    clientsCollection(db).findOne({ _id: engagement.clientId }),
    requestItemsCollection(db).find({ engagementId: id }).sort({ title: 1 }).toArray(),
    taxDocumentsCollection(db).find({ engagementId: id }).sort({ createdAt: -1 }).toArray(),
    activitiesCollection(db).find({ engagementId: id }).sort({ createdAt: -1 }).toArray(),
  ]);

  if (!clientDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const client = fromStored(clientSchema, clientDoc);
  const requestItems = requestItemDocs.map((doc) => fromStored(requestItemSchema, doc));
  const documents = documentDocs.map((doc) => fromStored(taxDocumentSchema, doc));
  const activity = activityDocs.map((doc) => fromStored(activitySchema, doc));

  return c.json(
    engagementDetailSchema.parse({ engagement, client, requestItems, documents, activity }),
  );
});

engagementRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateEngagementInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const id = c.req.param("id");
  const existing = await findEngagement(id);

  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  const engagement = engagementSchema.parse({
    ...existing,
    status: parsed.data.status,
    updatedAt: new Date().toISOString(),
  });

  await engagementsCollection(db).replaceOne({ _id: id }, toStored(engagement));

  return c.json({ engagement });
});

engagementRoutes.post("/:id/request-items", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createRequestItemInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const engagementId = c.req.param("id");
  const engagement = await findEngagement(engagementId);

  if (!engagement) {
    return c.json({ error: "Not found" }, 404);
  }

  const item = requestItemSchema.parse({
    id: randomUUID(),
    engagementId,
    ...parsed.data,
    status: "open",
    matchedDocumentIds: [],
    createdAt: new Date().toISOString(),
  });

  await requestItemsCollection(db).insertOne(toStored(item));

  return c.json({ item }, 201);
});

engagementRoutes.patch("/:id/request-items/:itemId", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateRequestItemInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const engagementId = c.req.param("id");
  const itemId = c.req.param("itemId");
  const engagement = await findEngagement(engagementId);

  if (!engagement) {
    return c.json({ error: "Not found" }, 404);
  }

  const existingDoc = await requestItemsCollection(db).findOne({
    _id: itemId,
    engagementId,
  });

  if (!existingDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const existing = fromStored(requestItemSchema, existingDoc);
  const item = requestItemSchema.parse({
    ...existing,
    ...parsed.data,
  });

  await requestItemsCollection(db).replaceOne({ _id: itemId }, toStored(item));

  return c.json({ item });
});

engagementRoutes.delete("/:id/request-items/:itemId", async (c) => {
  const db = await connectDb();
  const engagementId = c.req.param("id");
  const itemId = c.req.param("itemId");
  const engagement = await findEngagement(engagementId);

  if (!engagement) {
    return c.json({ error: "Not found" }, 404);
  }

  const result = await requestItemsCollection(db).deleteOne({
    _id: itemId,
    engagementId,
  });

  if (result.deletedCount === 0) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.body(null, 204);
});
