import type { Db } from "mongodb";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { activitySchema, type Activity } from "../../shared/schemas/activity.ts";
import { clientSchema, type Client } from "../../shared/schemas/client.ts";
import { extractionFieldSchema, taxDocumentSchema, type ExtractionField, type TaxDocument } from "../../shared/schemas/document.ts";
import { documentTypeSchema, type DocumentType } from "../../shared/schemas/document-type.ts";
import { engagementSchema, type Engagement } from "../../shared/schemas/engagement.ts";
import { exportLineSchema, exportSchema, type EngineExport, type ExportLine } from "../../shared/schemas/export.ts";
import { requestItemSchema, requestTemplateSchema, type RequestItem, type RequestTemplate } from "../../shared/schemas/request.ts";
import {
  activitiesCollection,
  clientsCollection,
  collectionNames,
  documentTypesCollection,
  engagementsCollection,
  engineExportsCollection,
  requestItemsCollection,
  requestTemplatesCollection,
  taxDocumentsCollection,
  toStored,
} from "../db/collections.ts";
import { ENGINE_LINE_MAP } from "../export/engine-map.ts";
import { seedDocumentTypes, seedRequestTemplates } from "./definitions.ts";
import { type DemoCompany, type DemoFigureDocument, loadDemoFigures } from "./figures.ts";

const SEED_CREATED_AT = "2026-01-02T00:00:00.000Z";
const SEED_CONFIRMED_AT = "2026-01-02T00:15:00.000Z";
const HERO_NAME = "Northgate Millwork, Inc.";
const SPARE_NAME = "Alder Creek Design Studio LLC";

type ReviewStatus = ExtractionField["reviewStatus"];

const resetCollectionNames = Object.values(collectionNames).filter((name) => name !== collectionNames.records);

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function entityTypeFor(company: DemoCompany): Client["entityType"] {
  if (company.entityType === "S corporation") return "s-corp";
  if (company.entityType === "Limited liability company") return "llc";
  return "partnership";
}

function documentTypeById(documentTypeId: string): DocumentType {
  const documentType = seedDocumentTypes.find((candidate) => candidate.id === documentTypeId);
  if (!documentType) {
    throw new Error(`Missing seeded document type ${documentTypeId}`);
  }
  return documentType;
}

function requestTemplateFor(company: DemoCompany): RequestTemplate {
  const template = seedRequestTemplates.find((candidate) => candidate.filingType === company.filingType);
  if (!template) {
    throw new Error(`Missing seeded request template for ${company.filingType}`);
  }
  return template;
}

function fieldFor(documentType: DocumentType, key: string) {
  const field = documentType.fields.find((candidate) => candidate.key === key);
  if (!field) {
    throw new Error(`Missing field ${key} on ${documentType.id}`);
  }
  return field;
}

function regexPassFor(pattern: string | undefined, value: string | number | boolean): boolean | null {
  if (!pattern) return null;
  return new RegExp(pattern).test(String(value));
}

function extractionFields(
  figureDocument: DemoFigureDocument,
  reviewStatus: ReviewStatus,
): ExtractionField[] {
  if (!figureDocument.documentTypeId) return [];
  const documentType = documentTypeById(figureDocument.documentTypeId);
  return Object.entries(figureDocument.fields).map(([key, value]) => {
    const field = fieldFor(documentType, key);
    return extractionFieldSchema.parse({
      key,
      label: field.label,
      metadataType: field.metadataType,
      dataType: field.dataType,
      value,
      confidence: reviewStatus === "accepted" ? 0.99 : 0.9,
      sourceSnippet: `${field.label}: ${value}`,
      notFound: false,
      regexPass: regexPassFor(field.regex, value),
      reviewStatus,
    });
  });
}

function clientFor(company: DemoCompany, overrides: Pick<Client, "id" | "contactName" | "contactEmail" | "city" | "state">): Client {
  return clientSchema.parse({
    ...overrides,
    legalName: company.name,
    entityType: entityTypeFor(company),
    ein: company.ein,
    createdAt: SEED_CREATED_AT,
  });
}

function engagementFor(
  company: DemoCompany,
  clientId: string,
  status: Engagement["status"],
): Engagement {
  const id = `eng-${slug(company.name)}-${company.taxYear}`;
  return engagementSchema.parse({
    id,
    clientId,
    taxYear: company.taxYear,
    filingType: company.filingType,
    status,
    portalToken: `portal-${slug(company.name)}-${company.taxYear}`,
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  });
}

function requestItemsFromTemplate(
  engagement: Engagement,
  templateItems: RequestTemplate["items"],
  matchedByDocumentType: Map<string, string[]>,
): RequestItem[] {
  return templateItems.map((item, index) => {
    const matchedDocumentIds = matchedByDocumentType.get(item.documentTypeId) ?? [];
    return requestItemSchema.parse({
      id: `ri-${engagement.id}-${index + 1}`,
      engagementId: engagement.id,
      ...item,
      status: matchedDocumentIds.length > 0 ? "received" : "open",
      matchedDocumentIds,
      createdAt: SEED_CREATED_AT,
    });
  });
}

async function taxDocumentFor(params: {
  id: string;
  engagementId: string;
  requestItemId?: string;
  figureDocument: DemoFigureDocument;
  pipelineStatus: TaxDocument["pipelineStatus"];
  reviewStatus: ReviewStatus;
}): Promise<TaxDocument> {
  const file = await stat(params.figureDocument.file);
  const classification = params.figureDocument.documentTypeId
    ? {
        documentTypeId: params.figureDocument.documentTypeId,
        confidence: 0.99,
        reasoning: "Seeded from committed demo figures.",
      }
    : undefined;
  const fields = extractionFields(params.figureDocument, params.reviewStatus);
  return taxDocumentSchema.parse({
    id: params.id,
    engagementId: params.engagementId,
    requestItemId: params.requestItemId,
    filename: basename(params.figureDocument.file),
    mimeType: "application/pdf",
    size: file.size,
    storagePath: params.figureDocument.file,
    uploadedBy: "client",
    pipelineStatus: params.pipelineStatus,
    classification,
    extraction: fields.length > 0 ? { fields } : undefined,
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  });
}

function activity(params: Omit<Activity, "id" | "createdAt"> & { id: string; createdAt?: string }): Activity {
  return activitySchema.parse({
    ...params,
    createdAt: params.createdAt ?? SEED_CREATED_AT,
  });
}

function buildExportLines(engagement: Engagement, documents: TaxDocument[]): ExportLine[] {
  return ENGINE_LINE_MAP[engagement.filingType].map((lineDef) => {
    const matches = documents.flatMap((document) => {
      if (document.pipelineStatus !== "trusted") return [];
      if (document.classification?.documentTypeId !== lineDef.source.documentTypeId) return [];
      const field = document.extraction?.fields.find((candidate) => candidate.key === lineDef.source.fieldKey);
      if (!field || field.value === null) return [];
      return [{ documentId: document.id, fieldKey: field.key, value: field.editedValue ?? field.value }];
    });
    const numericValues = matches
      .map((match) => match.value)
      .filter((value): value is number => typeof value === "number");

    return exportLineSchema.parse({
      engineForm: lineDef.engineForm,
      lineId: lineDef.lineId,
      lineLabel: lineDef.lineLabel,
      value:
        matches.length === 0
          ? null
          : numericValues.length === matches.length
            ? numericValues.reduce((sum, value) => sum + value, 0)
            : matches[0]?.value ?? null,
      sourceRefs: matches.map(({ documentId, fieldKey }) => ({ documentId, fieldKey })),
    });
  });
}

function exportFor(
  engagement: Engagement,
  client: Client,
  documents: TaxDocument[],
  status: EngineExport["status"],
): EngineExport {
  const lines = buildExportLines(engagement, documents);
  return exportSchema.parse({
    id: `export-${engagement.id}-${status}`,
    engagementId: engagement.id,
    status,
    lines,
    createdAt: SEED_CREATED_AT,
    confirmedAt: status === "sent" ? SEED_CONFIRMED_AT : undefined,
    payloadJson: JSON.stringify(
      {
        engine: "tax-engine-generic",
        filingType: engagement.filingType,
        taxYear: engagement.taxYear,
        client: { legalName: client.legalName, ein: client.ein },
        lines,
      },
      null,
      2,
    ),
  });
}

function requireCompany(name: string): DemoCompany {
  const company = loadDemoFigures().companies.find((candidate) => candidate.name === name);
  if (!company) {
    throw new Error(`Missing demo company ${name}`);
  }
  return company;
}

function requireFigureDocument(company: DemoCompany, documentTypeId: string): DemoFigureDocument {
  const document = company.documents.find((candidate) => candidate.documentTypeId === documentTypeId);
  if (!document) {
    throw new Error(`Missing ${documentTypeId} document for ${company.name}`);
  }
  return document;
}

function requireFigureDocuments(company: DemoCompany, documentTypeId: string): DemoFigureDocument[] {
  const documents = company.documents.filter((candidate) => candidate.documentTypeId === documentTypeId);
  if (documents.length === 0) {
    throw new Error(`Missing ${documentTypeId} documents for ${company.name}`);
  }
  return documents;
}

async function buildSeedBook() {
  const heroCompany = requireCompany(HERO_NAME);
  const spareCompany = requireCompany(SPARE_NAME);

  const heroClient = clientFor(heroCompany, {
    id: "client-northgate-millwork",
    contactName: "Marcus T. Hale",
    contactEmail: "marcus@northgate.example",
    city: "Portland",
    state: "OR",
  });
  const spareClient = clientFor(spareCompany, {
    id: "client-alder-creek",
    contactName: "Elena M. Vasquez",
    contactEmail: "elena@aldercreek.example",
    city: "Bend",
    state: "OR",
  });
  const backgroundClient = clientSchema.parse({
    id: "client-summit-forge",
    legalName: "Summit Forge Components LLC",
    entityType: "partnership",
    ein: "81-2047193",
    contactName: "Nora Patel",
    contactEmail: "nora@summitforge.example",
    city: "Boise",
    state: "ID",
    createdAt: SEED_CREATED_AT,
  });

  const heroEngagement = engagementFor(heroCompany, heroClient.id, "collecting");
  const spareEngagement = engagementFor(spareCompany, spareClient.id, "in-review");
  const backgroundEngagement = engagementSchema.parse({
    id: "eng-summit-forge-2025",
    clientId: backgroundClient.id,
    taxYear: 2025,
    filingType: "1065",
    status: "exported",
    portalToken: "portal-summit-forge-2025",
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CONFIRMED_AT,
  });

  const heroBalanceSheet = requireFigureDocument(heroCompany, "dt-balance-sheet");
  const heroTrialBalance = requireFigureDocument(heroCompany, "dt-trial-balance");
  const heroMatched = new Map([
    ["dt-balance-sheet", ["doc-northgate-balance-sheet"]],
    ["dt-trial-balance", ["doc-northgate-trial-balance"]],
  ]);
  const heroItems = requestItemsFromTemplate(heroEngagement, requestTemplateFor(heroCompany).items, heroMatched);
  const heroItemByType = new Map(heroItems.map((item) => [item.documentTypeId, item]));
  const heroDocuments = [
    await taxDocumentFor({
      id: "doc-northgate-balance-sheet",
      engagementId: heroEngagement.id,
      requestItemId: heroItemByType.get("dt-balance-sheet")?.id,
      figureDocument: heroBalanceSheet,
      pipelineStatus: "trusted",
      reviewStatus: "accepted",
    }),
    await taxDocumentFor({
      id: "doc-northgate-trial-balance",
      engagementId: heroEngagement.id,
      requestItemId: heroItemByType.get("dt-trial-balance")?.id,
      figureDocument: heroTrialBalance,
      pipelineStatus: "trusted",
      reviewStatus: "accepted",
    }),
  ];

  const spareSeedDocuments = [
    requireFigureDocument(spareCompany, "dt-profit-loss"),
    requireFigureDocument(spareCompany, "dt-balance-sheet"),
    ...requireFigureDocuments(spareCompany, "dt-k1-1065"),
  ];
  const spareMatched = new Map<string, string[]>();
  spareSeedDocuments.forEach((document, index) => {
    const documentId = `doc-alder-creek-${index + 1}`;
    const ids = spareMatched.get(document.documentTypeId ?? "") ?? [];
    ids.push(documentId);
    spareMatched.set(document.documentTypeId ?? "", ids);
  });
  const spareTemplateItems = requestTemplateFor(spareCompany).items;
  const spareItems = requestItemsFromTemplate(spareEngagement, spareTemplateItems, spareMatched);
  const spareItemByType = new Map(spareItems.map((item) => [item.documentTypeId, item]));
  const spareDocuments = await Promise.all(
    spareSeedDocuments.map((figureDocument, index) => {
      const reviewStatus = figureDocument.documentTypeId === "dt-balance-sheet" ? "accepted" : "unreviewed";
      return taxDocumentFor({
        id: `doc-alder-creek-${index + 1}`,
        engagementId: spareEngagement.id,
        requestItemId: spareItemByType.get(figureDocument.documentTypeId ?? "")?.id,
        figureDocument,
        pipelineStatus: reviewStatus === "accepted" ? "trusted" : "needs-review",
        reviewStatus,
      });
    }),
  );

  const backgroundExport = exportSchema.parse({
    id: "export-summit-forge-sent",
    engagementId: backgroundEngagement.id,
    status: "sent",
    lines: [
      exportLineSchema.parse({
        engineForm: "Form 1065",
        lineId: "1a",
        lineLabel: "Gross receipts",
        value: 918400,
        sourceRefs: [],
      }),
    ],
    createdAt: SEED_CREATED_AT,
    confirmedAt: SEED_CONFIRMED_AT,
    payloadJson: JSON.stringify(
      {
        engine: "tax-engine-generic",
        filingType: backgroundEngagement.filingType,
        taxYear: backgroundEngagement.taxYear,
        client: { legalName: backgroundClient.legalName, ein: backgroundClient.ein },
        lines: [{ engineForm: "Form 1065", lineId: "1a", value: 918400 }],
      },
      null,
      2,
    ),
  });

  const draftExport = exportFor(heroEngagement, heroClient, heroDocuments, "draft");
  const activities = [
    activity({
      id: "act-northgate-request-sent",
      engagementId: heroEngagement.id,
      actor: "cpa",
      action: "request-sent",
      detail: `Portal link /portal/${heroEngagement.portalToken} sent with ${heroItems.length} requested items`,
      direction: "outbound",
      readAt: SEED_CREATED_AT,
    }),
    ...heroDocuments.flatMap((document, index) => [
      activity({
        id: `act-${document.id}-uploaded`,
        engagementId: heroEngagement.id,
        actor: "client",
        action: "document-uploaded",
        detail: `${document.filename} uploaded from portal`,
        direction: "inbound",
        documentId: document.id,
        readAt: index === 0 ? SEED_CREATED_AT : undefined,
      }),
      activity({
        id: `act-${document.id}-extracted`,
        engagementId: heroEngagement.id,
        actor: "agent",
        action: "document-extracted",
        detail: `${document.filename} — ${document.extraction?.fields.length ?? 0} fields extracted`,
        direction: "inbound",
        documentId: document.id,
        readAt: SEED_CREATED_AT,
      }),
    ]),
    activity({
      id: "act-alder-request-sent",
      engagementId: spareEngagement.id,
      actor: "cpa",
      action: "request-sent",
      detail: `Portal link /portal/${spareEngagement.portalToken} sent with ${spareItems.length} requested items`,
      direction: "outbound",
      readAt: SEED_CREATED_AT,
    }),
    ...spareDocuments.flatMap((document, index) => [
      activity({
        id: `act-${document.id}-uploaded`,
        engagementId: spareEngagement.id,
        actor: "client",
        action: "document-uploaded",
        detail: `${document.filename} uploaded from portal`,
        direction: "inbound",
        documentId: document.id,
        readAt: index < 2 ? undefined : SEED_CREATED_AT,
      }),
      activity({
        id: `act-${document.id}-extracted`,
        engagementId: spareEngagement.id,
        actor: "agent",
        action: "document-extracted",
        detail: `${document.filename} — ${document.extraction?.fields.length ?? 0} fields extracted`,
        direction: "inbound",
        documentId: document.id,
        readAt: document.pipelineStatus === "needs-review" ? undefined : SEED_CREATED_AT,
      }),
    ]),
    activity({
      id: "act-summit-export-sent",
      engagementId: backgroundEngagement.id,
      actor: "cpa",
      action: "sent-to-engine",
      detail: "Confirmed 2025 1065 export",
      direction: "outbound",
      readAt: SEED_CREATED_AT,
      createdAt: SEED_CONFIRMED_AT,
    }),
  ];

  return {
    clients: [heroClient, spareClient, backgroundClient],
    engagements: [heroEngagement, spareEngagement, backgroundEngagement],
    documentTypes: seedDocumentTypes,
    requestTemplates: seedRequestTemplates,
    requestItems: [...heroItems, ...spareItems],
    documents: [...heroDocuments, ...spareDocuments],
    activities,
    exports: [draftExport, backgroundExport],
  };
}

async function insertSeedBook(db: Db): Promise<void> {
  const seedBook = await buildSeedBook();
  await documentTypesCollection(db).insertMany(
    seedBook.documentTypes.map((item) => toStored(documentTypeSchema.parse(item))),
  );
  await requestTemplatesCollection(db).insertMany(
    seedBook.requestTemplates.map((item) => toStored(requestTemplateSchema.parse(item))),
  );
  await clientsCollection(db).insertMany(seedBook.clients.map((item) => toStored(clientSchema.parse(item))));
  await engagementsCollection(db).insertMany(
    seedBook.engagements.map((item) => toStored(engagementSchema.parse(item))),
  );
  await requestItemsCollection(db).insertMany(
    seedBook.requestItems.map((item) => toStored(requestItemSchema.parse(item))),
  );
  await taxDocumentsCollection(db).insertMany(
    seedBook.documents.map((item) => toStored(taxDocumentSchema.parse(item))),
  );
  await activitiesCollection(db).insertMany(seedBook.activities.map((item) => toStored(activitySchema.parse(item))));
  await engineExportsCollection(db).insertMany(seedBook.exports.map((item) => toStored(exportSchema.parse(item))));
}

export async function seedIfEmpty(db: Db): Promise<boolean> {
  const [documentTypeCount, clientCount] = await Promise.all([
    documentTypesCollection(db).countDocuments(),
    clientsCollection(db).countDocuments(),
  ]);
  // The seed owns the domain book; either existing definitions or clients mean the app is not empty.
  if (documentTypeCount > 0 || clientCount > 0) {
    return false;
  }

  await insertSeedBook(db);
  return true;
}

export async function resetAndSeed(db: Db): Promise<void> {
  await Promise.all(
    resetCollectionNames.map(async (name) => {
      try {
        await db.collection(name).drop();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("ns not found")) {
          throw error;
        }
      }
    }),
  );
  await insertSeedBook(db);
}
