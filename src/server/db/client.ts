import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { config } from "../config.ts";
import { ensureIndexes } from "./collections.ts";

let client: MongoClient | null = null;
let db: Db | null = null;
let memoryServer: MongoMemoryServer | null = null;

async function resolveMongoUri(): Promise<string> {
  if (config.mongodbUri) {
    return config.mongodbUri;
  }

  memoryServer = await MongoMemoryServer.create();
  return memoryServer.getUri();
}

export async function connectDb(): Promise<Db> {
  if (db) {
    return db;
  }

  const uri = await resolveMongoUri();
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(config.mongodbDbName);
  await ensureIndexes(db);
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("Database is not connected. Call connectDb() first.");
  }

  return db;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }

  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
