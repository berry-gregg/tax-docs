import { mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test, afterAll } from "bun:test";

const tempUploadsDir = await mkdtemp(join(tmpdir(), "tax-docs-uploads-"));
process.env.UPLOADS_DIR = tempUploadsDir;

const { saveUploadedFile, readStoredFile } = await import("../../src/server/files/storage.ts");
const { config } = await import("../../src/server/config.ts");

afterAll(async () => {
  await unlink(`${config.uploadsDir}/t-1.pdf`).catch(() => undefined);
  await rm(tempUploadsDir, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});

describe("file storage", () => {
  test("saveUploadedFile writes file and readStoredFile returns identical bytes", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const storagePath = await saveUploadedFile("t-1", bytes);
    expect(storagePath).toBe(`${config.uploadsDir}/t-1.pdf`);
    const read = await readStoredFile(storagePath);
    expect(read).toEqual(bytes);
  });
});
