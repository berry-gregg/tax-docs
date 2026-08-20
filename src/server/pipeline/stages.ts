import { z } from "zod";
import { fenceUntrusted } from "../ai/fences.ts";
import { pdfFilePart, type OpenRouterClient, type UserPart } from "../ai/openrouter.ts";
import type { DocumentType } from "../../shared/schemas/document-type.ts";
import type { FieldDef } from "../../shared/schemas/metadata.ts";

export const qualityResultSchema = z.object({
  relevant: z.boolean(),
  legible: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type QualityResult = z.infer<typeof qualityResultSchema>;

export const classifyResultSchema = z.object({
  documentTypeId: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type ClassifyResult = z.infer<typeof classifyResultSchema>;

export const rawExtractionSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string().min(1),
      value: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      sourceSnippet: z.string(),
    }),
  ),
});
export type RawExtraction = z.infer<typeof rawExtractionSchema>;

type StageDocument = { filename: string; bytes: Uint8Array };

const QUALITY_SYSTEM =
  "Decide whether this document is relevant to a business tax engagement and whether it is legible enough to read. Set relevant and legible independently. Provide a confidence between 0 and 1 and a short reason.";

const CLASSIFY_SYSTEM =
  "Classify the document against the candidate document types listed in the user message as id — name: description lines. You must return null documentTypeId if no candidate confidently matches — do not force a match.";

const EXTRACT_SYSTEM =
  "Extract each listed field from the document. value must be a verbatim-groundable string from the document; use null and an empty sourceSnippet when not present — NEVER invent.";

function documentParts(doc: StageDocument): UserPart[] {
  return [
    pdfFilePart(doc.filename, doc.bytes),
    { type: "text", text: fenceUntrusted("filename", doc.filename) },
  ];
}

function candidateCatalog(candidates: DocumentType[]): string {
  return candidates.map((c) => `${c.id} — ${c.name}: ${c.description}`).join("\n");
}

function fieldLine(field: FieldDef): string {
  const line = `${field.key} (${field.metadataType}, ${field.dataType}): ${field.description}`;
  return field.regex ? `${line}\nformat pattern: ${field.regex}` : line;
}

function fieldCatalog(docType: DocumentType): string {
  return docType.fields.map(fieldLine).join("\n");
}

export async function runQualityStage(
  ai: OpenRouterClient,
  doc: StageDocument,
): Promise<QualityResult> {
  return ai.completeStructured({
    system: QUALITY_SYSTEM,
    parts: documentParts(doc),
    schemaName: "quality_result",
    schema: qualityResultSchema,
  });
}

export async function runClassifyStage(
  ai: OpenRouterClient,
  doc: StageDocument,
  candidates: DocumentType[],
): Promise<ClassifyResult> {
  return ai.completeStructured({
    system: CLASSIFY_SYSTEM,
    parts: [...documentParts(doc), { type: "text", text: candidateCatalog(candidates) }],
    schemaName: "classify_result",
    schema: classifyResultSchema,
  });
}

export async function runExtractStage(
  ai: OpenRouterClient,
  doc: StageDocument,
  docType: DocumentType,
): Promise<RawExtraction> {
  return ai.completeStructured({
    system: EXTRACT_SYSTEM,
    parts: [...documentParts(doc), { type: "text", text: fieldCatalog(docType) }],
    schemaName: "raw_extraction",
    schema: rawExtractionSchema,
  });
}
