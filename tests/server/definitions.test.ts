import { describe, expect, test } from "bun:test";
import { seedDocumentTypes, seedRequestTemplates } from "../../src/server/seed/definitions.ts";
import { documentTypeSchema } from "../../src/shared/schemas/document-type.ts";
import { requestTemplateSchema } from "../../src/shared/schemas/request.ts";

/** Required field keys from the Task 5 brief table — canonical contract for downstream tasks. */
const REQUIRED_FIELD_KEYS: Record<string, readonly string[]> = {
  "dt-profit-loss": [
    "business_name",
    "period_start",
    "period_end",
    "gross_receipts",
    "total_expenses",
    "net_income",
  ],
  "dt-balance-sheet": [
    "business_name",
    "period_end",
    "total_assets",
    "total_liabilities",
    "total_equity",
  ],
  "dt-trial-balance": ["business_name", "period_end", "total_debits", "total_credits"],
  "dt-941": [
    "business_name",
    "employer_ein",
    "quarter",
    "tax_year",
    "wages_tips_compensation",
  ],
  "dt-1099-nec": [
    "payer_name",
    "payer_tin",
    "recipient_name",
    "recipient_tin",
    "nonemployee_compensation",
    "tax_year",
  ],
  "dt-k1-1065": [
    "partnership_name",
    "partnership_ein",
    "partner_name",
    "ordinary_business_income",
    "tax_year",
  ],
  "dt-k1-1120s": [
    "corporation_name",
    "corporation_ein",
    "shareholder_name",
    "ordinary_business_income",
    "tax_year",
  ],
  "dt-fixed-assets": [
    "business_name",
    "period_end",
    "total_cost_basis",
    "total_accumulated_depreciation",
    "current_year_depreciation",
  ],
};

describe("seed definitions", () => {
  test("every seeded document type parses and is active", () => {
    for (const dt of seedDocumentTypes) {
      expect(documentTypeSchema.parse(dt).active).toBe(true);
    }
    expect(seedDocumentTypes.map((d) => d.id).sort()).toEqual([
      "dt-1099-nec",
      "dt-941",
      "dt-balance-sheet",
      "dt-fixed-assets",
      "dt-k1-1065",
      "dt-k1-1120s",
      "dt-profit-loss",
      "dt-trial-balance",
    ]);
  });

  test("every document type has the brief's required field keys marked required", () => {
    for (const [documentTypeId, requiredKeys] of Object.entries(REQUIRED_FIELD_KEYS)) {
      const dt = seedDocumentTypes.find((d) => d.id === documentTypeId);
      expect(dt).toBeDefined();
      for (const key of requiredKeys) {
        const field = dt!.fields.find((f) => f.key === key);
        expect(field).toBeDefined();
        expect(field?.required).toBe(true);
      }
    }
  });

  test("941 has the payroll tie fields with EIN regex", () => {
    const dt941 = seedDocumentTypes.find((d) => d.id === "dt-941");
    const ein = dt941?.fields.find((f) => f.key === "employer_ein");
    expect(ein?.regex).toBe("^\\d{2}-\\d{7}$");
    expect(dt941?.fields.some((f) => f.key === "wages_tips_compensation")).toBe(true);
  });

  test("templates parse and reference existing document types", () => {
    const ids = new Set(seedDocumentTypes.map((d) => d.id));
    for (const tpl of seedRequestTemplates) {
      requestTemplateSchema.parse(tpl);
      for (const item of tpl.items) expect(ids.has(item.documentTypeId)).toBe(true);
    }
    expect(seedRequestTemplates.map((t) => t.filingType).sort()).toEqual(["1065", "1120-S"]);
  });
});
