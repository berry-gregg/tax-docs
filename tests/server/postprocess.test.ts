import { describe, expect, test } from "bun:test";
import { REGEX_FAIL_CONFIDENCE_CAP } from "../../src/shared/constants.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import { fieldDefSchema, type FieldDef } from "../../src/shared/schemas/metadata.ts";
import { coerceValue, finalizeFields } from "../../src/server/pipeline/postprocess.ts";
import type { RawExtraction } from "../../src/server/pipeline/stages.ts";

const EIN_REGEX = "^\\d{2}-\\d{7}$";

function field(def: FieldDef): FieldDef {
  return fieldDefSchema.parse(def);
}

function docType(fields: FieldDef[]): DocumentType {
  return documentTypeSchema.parse({
    id: "dt-941",
    name: "Form 941",
    description: "Quarterly payroll return",
    active: true,
    createdBy: "seed",
    fields,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

const employerEin = field({
  key: "employer_ein",
  label: "Employer EIN",
  metadataType: "ein-tin",
  dataType: "string",
  required: true,
  regex: EIN_REGEX,
  description: "Box b employer identification number",
});

const wages = field({
  key: "wages_tips_compensation",
  label: "Wages, tips, and compensation",
  metadataType: "dollar-amount",
  dataType: "double",
  required: true,
  description: "Line 2 total wages",
});

const employeeCount = field({
  key: "employee_count",
  label: "Employee count",
  metadataType: "quantity",
  dataType: "int",
  required: false,
  description: "Number of employees",
});

const corrected = field({
  key: "is_corrected",
  label: "Corrected return",
  metadataType: "boolean-flag",
  dataType: "boolean",
  required: false,
  description: "Corrected-return checkbox",
});

const periodStart = field({
  key: "period_start",
  label: "Period start",
  metadataType: "date",
  dataType: "date",
  required: false,
  description: "Period start date",
});

const businessName = field({
  key: "business_name",
  label: "Business name",
  metadataType: "business-name",
  dataType: "string",
  required: true,
  description: "Employer name",
});

describe("coerceValue", () => {
  test("parses currency with $ and commas as double", () => {
    expect(coerceValue("$1,234.56", "double")).toBe(1234.56);
  });

  test("treats parentheses as a negative double", () => {
    expect(coerceValue("(500.00)", "double")).toBe(-500);
  });

  test("parses parenthesized currency as a negative double", () => {
    expect(coerceValue("($1,234.56)", "double")).toBe(-1234.56);
  });

  test("parseFloat after strip keeps trailing units like percent", () => {
    expect(coerceValue("5.4%", "double")).toBe(5.4);
  });

  test("parses an integer after the same numeric stripping", () => {
    expect(coerceValue("1,234", "int")).toBe(1234);
    expect(coerceValue("(500.00)", "int")).toBe(-500);
  });

  test("returns null when a double-stripped value is not an integer", () => {
    expect(coerceValue("12.5", "int")).toBeNull();
  });

  test("maps true/false/yes/no/x/checked to booleans", () => {
    expect(coerceValue("true", "boolean")).toBe(true);
    expect(coerceValue("YES", "boolean")).toBe(true);
    expect(coerceValue("x", "boolean")).toBe(true);
    expect(coerceValue("Checked", "boolean")).toBe(true);
    expect(coerceValue("false", "boolean")).toBe(false);
    expect(coerceValue("no", "boolean")).toBe(false);
  });

  test("returns a timezone-stable ISO date string", () => {
    expect(coerceValue("2024-03-15", "date")).toBe("2024-03-15");
    expect(coerceValue("3/15/2024", "date")).toBe("2024-03-15");
  });

  test("returns null when the value is uncoercible for the dataType", () => {
    expect(coerceValue("n/a", "double")).toBeNull();
    expect(coerceValue("maybe", "boolean")).toBeNull();
    expect(coerceValue("not-a-date", "date")).toBeNull();
  });

  test("returns the raw string for string dataType", () => {
    expect(coerceValue("12-3456789", "string")).toBe("12-3456789");
  });
});

describe("finalizeFields", () => {
  test("drops raw fields whose key is not in the document type", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "employer_ein",
          value: "12-3456789",
          confidence: 0.9,
          sourceSnippet: "12-3456789",
        },
        {
          key: "totally_unknown",
          value: "nope",
          confidence: 0.99,
          sourceSnippet: "nope",
        },
      ],
    };

    const result = finalizeFields(raw, docType([employerEin]));

    expect(result.map((f) => f.key)).toEqual(["employer_ein"]);
  });

  test("emits every document-type field exactly once; missing required keys are notFound", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "employer_ein",
          value: "12-3456789",
          confidence: 0.9,
          sourceSnippet: "EIN 12-3456789",
        },
      ],
    };

    const result = finalizeFields(raw, docType([businessName, employerEin, wages]));

    expect(result.map((f) => f.key)).toEqual(["business_name", "employer_ein", "wages_tips_compensation"]);
    const missingName = result.find((f) => f.key === "business_name");
    expect(missingName).toMatchObject({
      value: null,
      notFound: true,
      confidence: 0,
      sourceSnippet: "",
      label: "Business name",
      metadataType: "business-name",
      dataType: "string",
    });
    const missingWages = result.find((f) => f.key === "wages_tips_compensation");
    expect(missingWages).toMatchObject({
      value: null,
      notFound: true,
      confidence: 0,
      sourceSnippet: "",
    });
  });

  test("coerces a dollar amount field to a number", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "wages_tips_compensation",
          value: "$1,234.56",
          confidence: 0.88,
          sourceSnippet: "Line 2  $1,234.56",
        },
      ],
    };

    const [wagesField] = finalizeFields(raw, docType([wages]));
    expect(wagesField).toMatchObject({
      key: "wages_tips_compensation",
      value: 1234.56,
      notFound: false,
      confidence: 0.88,
      sourceSnippet: "Line 2  $1,234.56",
      regexPass: null,
    });
  });

  test("marks uncoercible values as notFound with a null value", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "wages_tips_compensation",
          value: "see schedule",
          confidence: 0.7,
          sourceSnippet: "see schedule",
        },
      ],
    };

    const [wagesField] = finalizeFields(raw, docType([wages]));
    expect(wagesField).toMatchObject({
      value: null,
      notFound: true,
      confidence: 0.7,
      sourceSnippet: "see schedule",
    });
  });

  test("passes EIN regex 12-3456789 and leaves confidence uncapped", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "employer_ein",
          value: "12-3456789",
          confidence: 0.91,
          sourceSnippet: "12-3456789",
        },
      ],
    };

    const [ein] = finalizeFields(raw, docType([employerEin]));
    expect(ein).toMatchObject({
      value: "12-3456789",
      notFound: false,
      regexPass: true,
      confidence: 0.91,
    });
  });

  test("fails EIN regex 123456789 and caps confidence at REGEX_FAIL_CONFIDENCE_CAP", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "employer_ein",
          value: "123456789",
          confidence: 0.95,
          sourceSnippet: "123456789",
        },
      ],
    };

    const [ein] = finalizeFields(raw, docType([employerEin]));
    expect(ein.regexPass).toBe(false);
    expect(ein.value).toBe("123456789");
    expect(ein.notFound).toBe(false);
    expect(ein.confidence).toBe(REGEX_FAIL_CONFIDENCE_CAP);
    expect(ein.confidence).toBe(0.4);
  });

  test("does not raise a below-cap confidence when regex fails", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "employer_ein",
          value: "123456789",
          confidence: 0.2,
          sourceSnippet: "123456789",
        },
      ],
    };

    const [ein] = finalizeFields(raw, docType([employerEin]));
    expect(ein.confidence).toBe(0.2);
  });

  test("sets regexPass null on fields without a regex", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "wages_tips_compensation",
          value: "100",
          confidence: 0.8,
          sourceSnippet: "100",
        },
      ],
    };

    const [wagesField] = finalizeFields(raw, docType([wages]));
    expect(wagesField.regexPass).toBeNull();
  });

  test("always sets reviewStatus to unreviewed", () => {
    const raw: RawExtraction = {
      fields: [
        {
          key: "employer_ein",
          value: "12-3456789",
          confidence: 0.9,
          sourceSnippet: "12-3456789",
        },
        {
          key: "employee_count",
          value: "12",
          confidence: 0.8,
          sourceSnippet: "12",
        },
        {
          key: "is_corrected",
          value: "yes",
          confidence: 0.7,
          sourceSnippet: "X",
        },
        {
          key: "period_start",
          value: "2024-03-15",
          confidence: 0.6,
          sourceSnippet: "2024-03-15",
        },
      ],
    };

    const result = finalizeFields(
      raw,
      docType([employerEin, employeeCount, corrected, periodStart, businessName]),
    );

    expect(result.every((f) => f.reviewStatus === "unreviewed")).toBe(true);
    expect(result.find((f) => f.key === "employee_count")?.value).toBe(12);
    expect(result.find((f) => f.key === "is_corrected")?.value).toBe(true);
    expect(result.find((f) => f.key === "period_start")?.value).toBe("2024-03-15");
  });
});
