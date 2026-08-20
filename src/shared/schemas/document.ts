import { z } from "zod";
import { dataTypeSchema, metadataTypeSchema } from "./metadata.ts";

const nullableValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();

export const pipelineStatusSchema = z.enum([
  "received",
  "quality-review",
  "rejected",
  "classifying",
  "unclassified",
  "extracting",
  "needs-review",
  "trusted",
  "failed",
]);
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;

export const extractionFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  metadataType: metadataTypeSchema,
  dataType: dataTypeSchema,
  value: nullableValueSchema,
  confidence: z.number().min(0).max(1),
  sourceSnippet: z.string(),
  notFound: z.boolean(),
  regexPass: z.boolean().nullable(),
  reviewStatus: z.enum(["unreviewed", "accepted", "edited"]),
  editedValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ExtractionField = z.infer<typeof extractionFieldSchema>;

export const taxDocumentSchema = z.object({
  id: z.string().min(1),
  engagementId: z.string().min(1),
  requestItemId: z.string().min(1).optional(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  storagePath: z.string().min(1),
  uploadedBy: z.enum(["client", "cpa"]),
  pipelineStatus: pipelineStatusSchema,
  rejection: z
    .object({
      kind: z.enum(["irrelevant", "unreadable"]),
      reason: z.string().min(1),
    })
    .optional(),
  classification: z
    .object({
      documentTypeId: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    })
    .optional(),
  extraction: z
    .object({
      fields: z.array(extractionFieldSchema),
    })
    .optional(),
  failure: z
    .object({
      message: z.string().min(1),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxDocument = z.infer<typeof taxDocumentSchema>;
