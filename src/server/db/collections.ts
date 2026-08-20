import type { Db } from "mongodb";

export const collectionNames = {
  records: "records",
} as const;

export function recordsCollection(db: Db) {
  return db.collection<{
    _id: string;
    title: string;
    createdAt: string;
  }>(collectionNames.records);
}
