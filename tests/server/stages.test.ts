import { describe, expect, test } from "bun:test";
import { fenceUntrusted } from "../../src/server/ai/fences.ts";
import {
  pdfFilePart,
  type OpenRouterClient,
  type StructuredRequest,
  type UserPart,
} from "../../src/server/ai/openrouter.ts";
import {
  classifyResultSchema,
  qualityResultSchema,
  rawExtractionSchema,
  runClassifyStage,
  runExtractStage,
  runQualityStage,
} from "../../src/server/pipeline/stages.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";
import { fieldDefSchema } from "../../src/shared/schemas/metadata.ts";

const DOC = { filename: "W-2.pdf", bytes: new Uint8Array([37, 80, 68, 70]) };

const form941: DocumentType = documentTypeSchema.parse({
  id: "dt-941",
  name: "Form 941",
  description: "Employer's quarterly federal tax return.",
  active: true,
  createdBy: "seed",
  createdAt: "2026-01-01T00:00:00.000Z",
  fields: [
    fieldDefSchema.parse({
      key: "employer_ein",
      label: "Employer EIN",
      metadataType: "ein-tin",
      dataType: "string",
      required: true,
      regex: "^\\d{2}-\\d{7}$",
      description: "Employer identification number in the EIN field.",
    }),
    fieldDefSchema.parse({
      key: "wages_tips_compensation",
      label: "Wages, tips, and compensation",
      metadataType: "dollar-amount",
      dataType: "double",
      required: true,
      description: "Line 2 — total wages, tips, and other compensation.",
    }),
  ],
});

const formW2: DocumentType = documentTypeSchema.parse({
  id: "dt-w2",
  name: "Form W-2",
  description: "Wage and tax statement.",
  active: true,
  createdBy: "seed",
  createdAt: "2026-01-01T00:00:00.000Z",
  fields: [
    fieldDefSchema.parse({
      key: "wages",
      label: "Wages",
      metadataType: "dollar-amount",
      dataType: "double",
      required: true,
      description: "Box 1 wages",
    }),
  ],
});

type RecordedRequest = {
  system: string;
  parts: UserPart[];
  schemaName: string;
};

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

function textOf(parts: UserPart[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function expectDocumentParts(parts: UserPart[]): void {
  expect(parts[0]).toEqual(pdfFilePart(DOC.filename, DOC.bytes));
  expect(parts[1]).toEqual({ type: "text", text: fenceUntrusted("filename", DOC.filename) });
  expect(textOf(parts)).toContain("UNTRUSTED DATA.");
}

describe("runQualityStage", () => {
  test("sends a static system prompt about relevance and legibility with fenced filename parts", async () => {
    const canned = {
      relevant: true,
      legible: true,
      confidence: 0.92,
      reason: "Quarterly federal payroll return",
    };
    const { ai, requests } = stubClient([canned]);

    const result = await runQualityStage(ai, DOC);

    expect(result).toEqual(canned);
    expect(qualityResultSchema.parse(result)).toEqual(canned);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.system.toLowerCase()).toContain("relevant");
    expect(req.system.toLowerCase()).toContain("business tax engagement");
    expect(req.system.toLowerCase()).toContain("legib");
    expect(req.system).not.toContain(DOC.filename);
    expect(req.system).not.toContain("UNTRUSTED DATA.");
    expectDocumentParts(req.parts);
    expect(req.parts).toHaveLength(2);
  });
});

describe("runClassifyStage", () => {
  test("lists each candidate id and tells the model not to force a match", async () => {
    const canned = {
      documentTypeId: "dt-941",
      confidence: 0.87,
      reasoning: "Matches Form 941 layout",
    };
    const { ai, requests } = stubClient([canned]);

    const result = await runClassifyStage(ai, DOC, [form941, formW2]);

    expect(result).toEqual(canned);
    expect(classifyResultSchema.parse(result)).toEqual(canned);
    const req = requests[0]!;
    expect(req.system).toContain(
      "return null documentTypeId if no candidate confidently matches — do not force a match",
    );
    expect(req.system).not.toContain("dt-941");
    expect(req.system).not.toContain("dt-w2");
    expect(req.system).not.toContain(DOC.filename);
    expectDocumentParts(req.parts);
    const catalog = [
      "dt-941 — Form 941: Employer's quarterly federal tax return.",
      "dt-w2 — Form W-2: Wage and tax statement.",
    ].join("\n");
    expect(req.parts[2]).toEqual({
      type: "text",
      text: fenceUntrusted("document-type-catalog", catalog),
    });
    const userText = textOf(req.parts);
    expect(userText).toContain("dt-941 — Form 941: Employer's quarterly federal tax return.");
    expect(userText).toContain("dt-w2 — Form W-2: Wage and tax statement.");
  });
});

describe("runExtractStage", () => {
  test("system prompt forbids invention; user parts include file, fenced filename, and regex format pattern", async () => {
    const canned = {
      fields: [
        {
          key: "employer_ein",
          value: "12-3456789",
          confidence: 0.9,
          sourceSnippet: "12-3456789",
        },
        {
          key: "wages_tips_compensation",
          value: "512000",
          confidence: 0.8,
          sourceSnippet: "512000",
        },
      ],
    };
    const { ai, requests } = stubClient([canned]);

    const result = await runExtractStage(ai, DOC, form941);

    expect(result).toEqual(canned);
    expect(rawExtractionSchema.parse(result)).toEqual(canned);
    const req = requests[0]!;
    expect(req.system).toContain("NEVER invent");
    expect(req.system).toContain(
      "value must be a verbatim-groundable string from the document; use null and an empty sourceSnippet when not present",
    );
    expect(req.system).not.toContain("employer_ein");
    expect(req.system).not.toContain(DOC.filename);
    expect(req.system).not.toContain("UNTRUSTED DATA.");
    expectDocumentParts(req.parts);
    const catalog = [
      "employer_ein (ein-tin, string): Employer identification number in the EIN field.",
      "format pattern: ^\\d{2}-\\d{7}$",
      "wages_tips_compensation (dollar-amount, double): Line 2 — total wages, tips, and other compensation.",
    ].join("\n");
    expect(req.parts[2]).toEqual({
      type: "text",
      text: fenceUntrusted("field-catalog", catalog),
    });
    const userText = textOf(req.parts);
    expect(userText).toContain(
      "employer_ein (ein-tin, string): Employer identification number in the EIN field.",
    );
    expect(userText).toContain("format pattern: ^\\d{2}-\\d{7}$");
    expect(userText).toContain(
      "wages_tips_compensation (dollar-amount, double): Line 2 — total wages, tips, and other compensation.",
    );
    expect(userText).not.toContain("format pattern: undefined");
  });
});
