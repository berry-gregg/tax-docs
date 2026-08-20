import { Hono } from "hono";
import { clientSchema } from "../../shared/schemas/client.ts";
import { documentTypeSchema } from "../../shared/schemas/document-type.ts";
import { taxDocumentSchema } from "../../shared/schemas/document.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import {
  searchQuerySchema,
  searchResponseSchema,
  type SearchResult,
} from "../../shared/schemas/search.ts";
import { zodIssueSummary } from "../../shared/zod-issue-summary.ts";
import { connectDb } from "../db/client.ts";
import {
  clientsCollection,
  documentTypesCollection,
  engagementsCollection,
  fromStored,
  taxDocumentsCollection,
} from "../db/collections.ts";

export const searchRoutes = new Hono();

const MAX_PER_GROUP = 8;
/** Upper bound on ids collected for `$in` joins so a broad query cannot balloon the batch. */
const MAX_JOIN_IDS = 50;

/** The query is untrusted user input — escape metacharacters so it only ever literal-matches. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-database palette search: case-insensitive substring match per group, capped at
 * `MAX_PER_GROUP` rows each. Joined-field matches (client name on engagements and documents,
 * type name on documents) resolve ids first and batch with `$in` — no per-row lookups.
 * A non-anchored case-insensitive regex cannot be served by a B-tree index, so this route
 * adds none; at palette scale the collection scans are bounded by the `.limit()` caps.
 */
searchRoutes.get("/", async (c) => {
  const parsed = searchQuerySchema.safeParse({ q: c.req.query("q") });
  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const query = parsed.data.q.trim();
  if (query.length === 0) {
    return c.json(searchResponseSchema.parse({ results: [] }));
  }

  const escaped = escapeRegExp(query);
  const rx = new RegExp(escaped, "i");
  const db = await connectDb();

  const [nameMatchedClientIds, nameMatchedTypeIds] = await Promise.all([
    clientsCollection(db)
      .find({ legalName: rx }, { projection: { _id: 1 } })
      .limit(MAX_JOIN_IDS)
      .map((doc) => doc._id)
      .toArray(),
    documentTypesCollection(db)
      .find({ name: rx }, { projection: { _id: 1 } })
      .limit(MAX_JOIN_IDS)
      .map((doc) => doc._id)
      .toArray(),
  ]);

  // Documents reach their client through the engagement, so a client-name match needs the
  // engagement ids of the matched clients before the documents query can run.
  const engagementIdsOfMatchedClients =
    nameMatchedClientIds.length > 0
      ? await engagementsCollection(db)
          .find({ clientId: { $in: nameMatchedClientIds } }, { projection: { _id: 1 } })
          .limit(MAX_JOIN_IDS)
          .map((doc) => doc._id)
          .toArray()
      : [];

  const [clientDocs, engagementDocs, documentDocs, typeDocs] = await Promise.all([
    clientsCollection(db)
      .find({ $or: [{ legalName: rx }, { ein: rx }] })
      .sort({ legalName: 1 })
      .limit(MAX_PER_GROUP)
      .toArray(),
    engagementsCollection(db)
      .find({
        $or: [
          { clientId: { $in: nameMatchedClientIds } },
          { filingType: rx },
          // taxYear is stored as a number; substring-match its string form server-side.
          { $expr: { $regexMatch: { input: { $toString: "$taxYear" }, regex: escaped, options: "i" } } },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(MAX_PER_GROUP)
      .toArray(),
    taxDocumentsCollection(db)
      .find({
        $or: [
          { filename: rx },
          { "classification.documentTypeId": { $in: nameMatchedTypeIds } },
          { engagementId: { $in: engagementIdsOfMatchedClients } },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(MAX_PER_GROUP)
      .toArray(),
    documentTypesCollection(db)
      .find({ $or: [{ name: rx }, { description: rx }] })
      .sort({ name: 1 })
      .limit(MAX_PER_GROUP)
      .toArray(),
  ]);

  const clients = clientDocs.map((doc) => fromStored(clientSchema, doc));
  const engagements = engagementDocs.map((doc) => fromStored(engagementSchema, doc));
  const documents = documentDocs.map((doc) => fromStored(taxDocumentSchema, doc));
  const documentTypes = typeDocs.map((doc) => fromStored(documentTypeSchema, doc));

  // Batch-load the rows the labels join on: engagements for document rows, then clients for both.
  const documentEngagementIds = [...new Set(documents.map((document) => document.engagementId))];
  const labelEngagementDocs =
    documentEngagementIds.length > 0
      ? await engagementsCollection(db)
          .find({ _id: { $in: documentEngagementIds } })
          .toArray()
      : [];
  const engagementById = new Map(
    [...engagementDocs, ...labelEngagementDocs].map((doc) => [
      doc._id,
      fromStored(engagementSchema, doc),
    ]),
  );

  const labelClientIds = [
    ...new Set([
      ...engagements.map((engagement) => engagement.clientId),
      ...[...engagementById.values()].map((engagement) => engagement.clientId),
    ]),
  ];
  const labelClientDocs =
    labelClientIds.length > 0
      ? await clientsCollection(db)
          .find({ _id: { $in: labelClientIds } })
          .toArray()
      : [];
  const clientNameById = new Map(
    labelClientDocs.map((doc) => [doc._id, fromStored(clientSchema, doc).legalName]),
  );

  const clientNameFor = (clientId: string): string =>
    clientNameById.get(clientId) ?? "Unknown client";

  const results: SearchResult[] = [
    ...clients.map((client) => ({
      id: client.id,
      group: "Clients" as const,
      label: client.legalName,
      href: `/clients/${client.id}`,
    })),
    ...engagements.map((engagement) => ({
      id: engagement.id,
      group: "Engagements" as const,
      label: `${clientNameFor(engagement.clientId)} · ${engagement.taxYear} ${engagement.filingType}`,
      href: `/engagements/${engagement.id}`,
    })),
    ...documents.map((document) => {
      const engagement = engagementById.get(document.engagementId);
      const clientName = engagement ? clientNameFor(engagement.clientId) : "Unknown client";
      return {
        id: document.id,
        group: "Documents" as const,
        label: `${document.filename} · ${clientName}`,
        href: `/documents/${document.id}`,
      };
    }),
    ...documentTypes.map((documentType) => ({
      id: documentType.id,
      group: "Document types" as const,
      label: documentType.name,
      href: "/settings?tab=document-types",
    })),
  ];

  return c.json(searchResponseSchema.parse({ results }));
});
