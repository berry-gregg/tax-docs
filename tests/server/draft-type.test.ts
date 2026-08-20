import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { createApp } from "../../src/server/app.ts";
import { fenceUntrusted } from "../../src/server/ai/fences.ts";
import {
  pdfFilePart,
  type OpenRouterClient,
  type StructuredRequest,
  type UserPart,
} from "../../src/server/ai/openrouter.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  documentTypesCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import { saveUploadedFile } from "../../src/server/files/storage.ts";
import { draftTypeResultSchema, runDraftTypeStage } from "../../src/server/pipeline/stages.ts";
import { taxDocumentSchema, type TaxDocument } from "../../src/shared/schemas/document.ts";
import {
  createDocumentTypeInputSchema,
  type CreateDocumentTypeInput,
} from "../../src/shared/schemas/document-type.ts";
import { metadataTypeSchema } from "../../src/shared/schemas/metadata.ts";

const DOC = { filename: "mystery-statement.pdf", bytes: new Uint8Array([37, 80, 68, 70]) };

const CANNED_DRAFT = {
  name: "Brokerage Consolidated Statement",
  description: "Year-end consolidated brokerage statement summarising proceeds and dividends.",
  fields: [
    {
      key: "account_holder",
      label: "Account holder",
      metadataType: "person-name" as const,
      description: "Name of the account holder shown in the statement header.",
    },
    {
      key: "statement_date",
      label: "Statement date",
      metadataType: "date" as const,
      description: "Closing date of the statement period.",
    },
    {
      key: "total_proceeds",
      label: "Total proceeds",
      metadataType: "total" as const,
      description: "Total gross proceeds reported for the period.",
    },
    {
      key: "shares_sold",
      label: "Shares sold",
      metadataType: "quantity" as const,
      description: "Number of shares sold during the period.",
    },
  ],
};

type RecordedRequest = { system: string; parts: UserPart[]; schemaName: string };

function stubClient(canned: unknown[]): { ai: OpenRouterClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const ai: OpenRouterClient = {
    async completeStructured<T>(req: StructuredRequest<T>): Promise<T> {
      requests.push({ system: req.system, parts: req.parts, schemaName: req.schemaName });
      const next = canned[index];
      index += 1;
      if (next === undefined) throw new Error(`unexpected completeStructured call #${index}`);
      return req.schema.parse(next);
    },
  };
  return { ai, requests };
}

function failingClient(message: string): OpenRouterClient {
  return {
    completeStructured() {
      return Promise.reject(new Error(message));
    },
  };
}

const storagePaths: string[] = [];

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    documentTypesCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
}

async function insertDocument(
  id: string,
  pipelineStatus: TaxDocument["pipelineStatus"],
): Promise<TaxDocument> {
  const storagePath = await saveUploadedFile(id, DOC.bytes);
  storagePaths.push(storagePath);
  const document = taxDocumentSchema.parse({
    id,
    engagementId: "eng-draft-type",
    filename: DOC.filename,
    mimeType: "application/pdf",
    size: DOC.bytes.byteLength,
    storagePath,
    uploadedBy: "client",
    pipelineStatus,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
  const db = await connectDb();
  await taxDocumentsCollection(db).insertOne(toStored(document));
  return document;
}

beforeEach(async () => {
  storagePaths.length = 0;
  await clearCollections();
});

afterEach(async () => {
  await Promise.all(storagePaths.map((path) => unlink(path).catch(() => undefined)));
  await clearCollections();
  await disconnectDb();
});

describe("runDraftTypeStage", () => {
  test("asks for structure only with the metadataType enum in a trusted system prompt", async () => {
    const { ai, requests } = stubClient([CANNED_DRAFT]);

    const result = await runDraftTypeStage(ai, DOC);

    expect(result).toEqual(CANNED_DRAFT);
    expect(draftTypeResultSchema.parse(result)).toEqual(CANNED_DRAFT);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.schemaName).toBe("draft_type_result");
    expect(req.system).toContain("snake_case");
    expect(req.system).toContain("do not propose values, only structure");
    for (const metadataType of metadataTypeSchema.options) {
      expect(req.system).toContain(metadataType);
    }
    expect(req.system).not.toContain(DOC.filename);
    expect(req.system).not.toContain("UNTRUSTED DATA.");
    expect(req.parts).toEqual([
      pdfFilePart(DOC.filename, DOC.bytes),
      { type: "text", text: fenceUntrusted("filename", DOC.filename) },
    ]);
  });

  test("rejects a draft whose field key is not snake_case", () => {
    expect(
      draftTypeResultSchema.safeParse({
        ...CANNED_DRAFT,
        fields: [{ ...CANNED_DRAFT.fields[0]!, key: "Account Holder" }],
      }).success,
    ).toBe(false);
  });
});

describe("POST /api/documents/:id/draft-type", () => {
  test("drafts a document type with defaulted dataTypes without creating it", async () => {
    const { ai, requests } = stubClient([CANNED_DRAFT]);
    const app = createApp({ ai });
    const document = await insertDocument("doc-unclassified-draft", "unclassified");

    const response = await app.request(`/api/documents/${document.id}/draft-type`, {
      method: "POST",
    });
    const body = await response.json() as { draft: CreateDocumentTypeInput };

    expect(response.status).toBe(200);
    expect(createDocumentTypeInputSchema.parse(body.draft)).toEqual(body.draft);
    expect(body.draft).toEqual({
      name: CANNED_DRAFT.name,
      description: CANNED_DRAFT.description,
      active: true,
      fields: [
        {
          key: "account_holder",
          label: "Account holder",
          metadataType: "person-name",
          dataType: "string",
          required: false,
          description: "Name of the account holder shown in the statement header.",
        },
        {
          key: "statement_date",
          label: "Statement date",
          metadataType: "date",
          dataType: "date",
          required: false,
          description: "Closing date of the statement period.",
        },
        {
          key: "total_proceeds",
          label: "Total proceeds",
          metadataType: "total",
          dataType: "double",
          required: false,
          description: "Total gross proceeds reported for the period.",
        },
        {
          key: "shares_sold",
          label: "Shares sold",
          metadataType: "quantity",
          dataType: "int",
          required: false,
          description: "Number of shares sold during the period.",
        },
      ],
    });
    for (const field of body.draft.fields) {
      expect(field.regex).toBeUndefined();
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]!.parts[0]).toEqual(pdfFilePart(DOC.filename, DOC.bytes));
    expect(requests[0]!.parts[1]).toEqual({
      type: "text",
      text: fenceUntrusted("filename", DOC.filename),
    });

    const db = await connectDb();
    expect(await documentTypesCollection(db).countDocuments({})).toBe(0);
    const stored = await taxDocumentsCollection(db).findOne({ _id: document.id });
    expect(stored?.pipelineStatus).toBe("unclassified");
  });

  test("refuses to draft for a document that is not unclassified", async () => {
    const { ai, requests } = stubClient([CANNED_DRAFT]);
    const app = createApp({ ai });
    const document = await insertDocument("doc-needs-review-draft", "needs-review");

    const response = await app.request(`/api/documents/${document.id}/draft-type`, {
      method: "POST",
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("unclassified");
    expect(requests).toEqual([]);
  });

  test("returns 404 for an unknown document", async () => {
    const { ai } = stubClient([CANNED_DRAFT]);
    const app = createApp({ ai });

    const response = await app.request("/api/documents/doc-missing/draft-type", { method: "POST" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  test("surfaces the underlying cause when the draft stage fails", async () => {
    const app = createApp({ ai: failingClient("OpenRouter request timed out") });
    const document = await insertDocument("doc-draft-failure", "unclassified");

    const response = await app.request(`/api/documents/${document.id}/draft-type`, {
      method: "POST",
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain("OpenRouter request timed out");
  });
});
