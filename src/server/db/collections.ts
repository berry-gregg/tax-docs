import type { Collection, Db } from "mongodb";
import type { z } from "zod";
import type { Activity } from "../../shared/schemas/activity.ts";
import type { Client } from "../../shared/schemas/client.ts";
import type { TaxDocument } from "../../shared/schemas/document.ts";
import type { DocumentType } from "../../shared/schemas/document-type.ts";
import type { Engagement } from "../../shared/schemas/engagement.ts";
import type { EngineExport } from "../../shared/schemas/export.ts";
import type { RequestItem, RequestTemplate } from "../../shared/schemas/request.ts";

export type StoredDoc<T extends { id: string }> = Omit<T, "id"> & { _id: string };

export function fromStored<T extends { id: string }>(schema: z.ZodType<T>, doc: StoredDoc<T>): T {
  const { _id, ...rest } = doc;
  return schema.parse({ id: _id, ...rest });
}

export function toStored<T extends { id: string }>(item: T): StoredDoc<T> {
  const { id, ...rest } = item;
  return { _id: id, ...rest } as StoredDoc<T>;
}

export const collectionNames = {
  records: "records",
  clients: "clients",
  engagements: "engagements",
  documentTypes: "documentTypes",
  requestTemplates: "requestTemplates",
  requestItems: "requestItems",
  taxDocuments: "taxDocuments",
  activities: "activities",
  engineExports: "engineExports",
} as const;

export function recordsCollection(db: Db) {
  return db.collection<{
    _id: string;
    title: string;
    createdAt: string;
  }>(collectionNames.records);
}

export function clientsCollection(db: Db): Collection<StoredDoc<Client>> {
  return db.collection<StoredDoc<Client>>(collectionNames.clients);
}

export function engagementsCollection(db: Db): Collection<StoredDoc<Engagement>> {
  return db.collection<StoredDoc<Engagement>>(collectionNames.engagements);
}

export function documentTypesCollection(db: Db): Collection<StoredDoc<DocumentType>> {
  return db.collection<StoredDoc<DocumentType>>(collectionNames.documentTypes);
}

export function requestTemplatesCollection(db: Db): Collection<StoredDoc<RequestTemplate>> {
  return db.collection<StoredDoc<RequestTemplate>>(collectionNames.requestTemplates);
}

export function requestItemsCollection(db: Db): Collection<StoredDoc<RequestItem>> {
  return db.collection<StoredDoc<RequestItem>>(collectionNames.requestItems);
}

export function taxDocumentsCollection(db: Db): Collection<StoredDoc<TaxDocument>> {
  return db.collection<StoredDoc<TaxDocument>>(collectionNames.taxDocuments);
}

export function activitiesCollection(db: Db): Collection<StoredDoc<Activity>> {
  return db.collection<StoredDoc<Activity>>(collectionNames.activities);
}

export function engineExportsCollection(db: Db): Collection<StoredDoc<EngineExport>> {
  return db.collection<StoredDoc<EngineExport>>(collectionNames.engineExports);
}
