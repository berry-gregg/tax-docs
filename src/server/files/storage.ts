import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";

const PROJECT_ROOT = join(import.meta.dir, "../../..");

export async function saveUploadedFile(documentId: string, bytes: Uint8Array): Promise<string> {
  const storagePath = `${config.uploadsDir}/${documentId}.pdf`;
  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(storagePath, bytes);
  return storagePath;
}

export async function readStoredFile(storagePath: string): Promise<Uint8Array> {
  const resolvedPath = storagePath.startsWith("demo-docs/")
    ? join(PROJECT_ROOT, storagePath)
    : storagePath;
  return new Uint8Array(await readFile(resolvedPath));
}
