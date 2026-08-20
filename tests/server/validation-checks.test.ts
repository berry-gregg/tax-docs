import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import {
  clientsCollection,
  engagementsCollection,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../../src/server/db/collections.ts";
import type { Client } from "../../src/shared/schemas/client.ts";
import type { TaxDocument } from "../../src/shared/schemas/document.ts";
import type { Engagement } from "../../src/shared/schemas/engagement.ts";
import type { RequestItem } from "../../src/shared/schemas/request.ts";
import { validationCheckSchema, type ValidationCheck } from "../../src/shared/schemas/validation.ts";

const now = "2026-01-01T00:00:00.000Z";

const client: Client = {
  id: "client-validation",
  legalName: "Validation Supply Co.",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Riley Moore",
  contactEmail: "riley@example.test",
  city: "Austin",
  state: "TX",
  createdAt: now,
};

const engagement: Engagement = {
  id: "engagement-validation",
  clientId: client.id,
  taxYear: 2026,
  filingType: "1120-S",
  status: "in-review",
  portalToken: "portal-validation",
  createdAt: now,
  updatedAt: now,
};

type FieldValue = string | number | boolean | null;

function extractionField(key: string, value: FieldValue, editedValue?: Exclude<FieldValue, null>) {
  return {
    key,
    label: key,
    metadataType: typeof value === "number" ? ("dollar-amount" as const) : ("free-text" as const),
    dataType: typeof value === "number" ? ("double" as const) : ("string" as const),
    value,
    confidence: 0.98,
    sourceSnippet: `${key}: ${value ?? ""}`,
    notFound: value === null,
    regexPass: null,
    reviewStatus: editedValue === undefined ? ("accepted" as const) : ("edited" as const),
    ...(editedValue === undefined ? {} : { editedValue }),
  };
}

function document(
  id: string,
  documentTypeId: string,
  fields: ReturnType<typeof extractionField>[],
  pipelineStatus: TaxDocument["pipelineStatus"] = "needs-review",
): TaxDocument {
  return {
    id,
    engagementId: engagement.id,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    size: 100,
    storagePath: `data/uploads/${id}.pdf`,
    uploadedBy: "cpa",
    pipelineStatus,
    classification: {
      documentTypeId,
      confidence: 0.99,
      reasoning: "Seeded test document",
    },
    extraction: { fields },
    createdAt: now,
    updatedAt: now,
  };
}

function requestItem(id: string, title: string, status: RequestItem["status"]): RequestItem {
  return {
    id,
    engagementId: engagement.id,
    documentTypeId: "dt-profit-loss",
    title,
    description: `${title} description`,
    required: true,
    status,
    matchedDocumentIds: [],
    createdAt: now,
  };
}

async function clearCollections() {
  const db = await connectDb();
  await Promise.all([
    clientsCollection(db).deleteMany({}),
    engagementsCollection(db).deleteMany({}),
    requestItemsCollection(db).deleteMany({}),
    taxDocumentsCollection(db).deleteMany({}),
  ]);
}

async function seedBase() {
  const db = await connectDb();
  await clientsCollection(db).insertOne(toStored(client));
  await engagementsCollection(db).insertOne(toStored(engagement));
}

async function fetchChecks(): Promise<ValidationCheck[]> {
  const app = createApp();
  const response = await app.request(`/api/engagements/${engagement.id}/validations`);
  const body = await response.json();

  expect(response.status).toBe(200);
  return body.checks.map((check: unknown) => validationCheckSchema.parse(check));
}

beforeEach(async () => {
  await clearCollections();
  await seedBase();
});

afterEach(async () => {
  await clearCollections();
  await disconnectDb();
});

describe("validation checks", () => {
  test("returns pass checks for tied documents and omits absent inputs", async () => {
    const db = await connectDb();
    await taxDocumentsCollection(db).insertMany([
      toStored(
        document("doc-balance-sheet", "dt-balance-sheet", [
          extractionField("total_assets", 1000),
          extractionField("total_liabilities", 400),
          extractionField("total_equity", 600),
        ]),
      ),
      toStored(
        document("doc-trial-balance", "dt-trial-balance", [
          extractionField("total_debits", 750),
          extractionField("total_credits", 750),
        ]),
      ),
      toStored(
        document("doc-profit-loss", "dt-profit-loss", [
          extractionField("gross_receipts", 1000),
          extractionField("total_expenses", 300),
          extractionField("net_income", 600, 700),
        ]),
      ),
    ]);
    await requestItemsCollection(db).insertOne(toStored(requestItem("item-received", "P&L", "received")));

    const checks = await fetchChecks();

    expect(checks).toContainEqual(
      expect.objectContaining({
        checkId: "balance-sheet-ties",
        status: "pass",
        relatedDocumentIds: ["doc-balance-sheet"],
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        checkId: "trial-balance-ties",
        status: "pass",
        relatedDocumentIds: ["doc-trial-balance"],
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        checkId: "pl-foots",
        status: "pass",
        relatedDocumentIds: ["doc-profit-loss"],
      }),
    );
    expect(checks).toContainEqual(expect.objectContaining({ checkId: "missing-required-items", status: "pass" }));
    expect(checks.map((check) => check.checkId)).not.toContain("payroll-tie");
    expect(checks.every((check) => check.status === "pass" || check.status === "warn")).toBe(true);
  });

  test("warns on payroll discrepancy with both compared figures", async () => {
    const db = await connectDb();
    await taxDocumentsCollection(db).insertMany([
      toStored(
        document("doc-profit-loss", "dt-profit-loss", [
          extractionField("salaries_wages", 500000),
          extractionField("officer_compensation", 12000),
        ]),
      ),
      toStored(
        document("doc-941-q1", "dt-941", [extractionField("wages_tips_compensation", 250000)]),
      ),
      toStored(
        document("doc-941-q2", "dt-941", [extractionField("wages_tips_compensation", 280500)]),
      ),
    ]);

    const payrollTie = (await fetchChecks()).find((check) => check.checkId === "payroll-tie");

    expect(payrollTie).toMatchObject({
      status: "warn",
      relatedDocumentIds: ["doc-profit-loss", "doc-941-q1", "doc-941-q2"],
    });
    expect(payrollTie?.explanation).toContain("$530,500");
    expect(payrollTie?.explanation).toContain("$512,000");
    expect(payrollTie?.explanation).toContain("$18,500");
  });

  test("warns on EIN mismatches while excluding recipient TINs and ignored documents", async () => {
    const db = await connectDb();
    await taxDocumentsCollection(db).insertMany([
      toStored(document("doc-941", "dt-941", [extractionField("employer_ein", "12-3456789")])),
      toStored(document("doc-k1", "dt-k1-1120s", [extractionField("corporation_ein", "98-7654321")])),
      toStored(document("doc-1099", "dt-1099-nec", [extractionField("recipient_tin", "111-22-3333")])),
      toStored(document("doc-failed", "dt-941", [extractionField("employer_ein", "00-0000000")], "failed")),
    ]);

    const einConsistency = (await fetchChecks()).find((check) => check.checkId === "ein-consistency");

    expect(einConsistency).toMatchObject({
      status: "warn",
      relatedDocumentIds: ["doc-941", "doc-k1"],
    });
    expect(einConsistency?.explanation).toContain("123456789");
    expect(einConsistency?.explanation).toContain("987654321");
    expect(einConsistency?.explanation).not.toContain("111223333");
    expect(einConsistency?.explanation).not.toContain("000000000");
  });

  test("omits checks when inputs are absent instead of inventing passes", async () => {
    const checks = await fetchChecks();

    expect(checks.map((check) => check.checkId)).toEqual(["missing-required-items"]);
    expect(checks[0]?.status).toBe("pass");
  });

  test("warns for open required request items", async () => {
    const db = await connectDb();
    await requestItemsCollection(db).insertMany([
      toStored(requestItem("item-open-pl", "Profit & loss statement", "open")),
      toStored(requestItem("item-open-941", "Quarterly 941s", "open")),
      toStored(requestItem("item-waived", "Waived K-1", "waived")),
    ]);

    const missing = (await fetchChecks()).find((check) => check.checkId === "missing-required-items");

    expect(missing).toMatchObject({
      status: "warn",
      relatedDocumentIds: [],
    });
    expect(missing?.explanation).toContain("Profit & loss statement");
    expect(missing?.explanation).toContain("Quarterly 941s");
    expect(missing?.explanation).not.toContain("Waived K-1");
  });
});
