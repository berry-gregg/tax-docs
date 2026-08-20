import { Hono } from "hono";
import { taxDocumentSchema } from "../../shared/schemas/document.ts";
import { metricsSchema } from "../../shared/schemas/api.ts";
import { connectDb } from "../db/client.ts";
import {
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
} from "../db/collections.ts";

export const metricsRoutes = new Hono();

const AUTO_PROCESSED_STATUSES = ["needs-review", "trusted"] as const;
const TERMINAL_ISH_STATUSES = [
  "needs-review",
  "trusted",
  "rejected",
  "unclassified",
  "failed",
] as const;
const NEEDS_REVIEW_STATUSES = ["needs-review", "unclassified"] as const;

metricsRoutes.get("/", async (c) => {
  const db = await connectDb();
  const documents = taxDocumentsCollection(db);
  const requestItems = requestItemsCollection(db);
  const engagements = engagementsCollection(db);

  const [documentsAutoProcessed, terminalishCount, needsReviewCount, outstandingRequests, activeClientIds] =
    await Promise.all([
      documents.countDocuments({ pipelineStatus: { $in: [...AUTO_PROCESSED_STATUSES] } }),
      documents.countDocuments({ pipelineStatus: { $in: [...TERMINAL_ISH_STATUSES] } }),
      documents.countDocuments({ pipelineStatus: { $in: [...NEEDS_REVIEW_STATUSES] } }),
      requestItems.countDocuments({ required: true, status: "open" }),
      engagements.distinct("clientId", { status: { $ne: "exported" } }),
    ]);

  const needsReviewDocs = await documents.find({ pipelineStatus: "needs-review" }).toArray();
  const fieldsAwaitingReview = needsReviewDocs
    .map((doc) => fromStored(taxDocumentSchema, doc))
    .reduce(
      (sum, doc) =>
        sum + (doc.extraction?.fields.filter((field) => field.reviewStatus === "unreviewed").length ?? 0),
      0,
    );

  const straightThroughRate =
    terminalishCount === 0 ? 0 : Math.round((100 * documentsAutoProcessed) / terminalishCount);

  return c.json(
    metricsSchema.parse({
      documentsAutoProcessed,
      fieldsAwaitingReview,
      straightThroughRate,
      needsReviewCount,
      outstandingRequests,
      activeClients: activeClientIds.length,
    }),
  );
});
