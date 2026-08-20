import { z } from "zod";

const nullableValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();

export const exportLineSchema = z.object({
  engineForm: z.string().min(1),
  lineId: z.string().min(1),
  lineLabel: z.string().min(1),
  value: nullableValueSchema,
  sourceRefs: z.array(
    z.object({
      documentId: z.string().min(1),
      fieldKey: z.string().min(1),
    }),
  ),
});
export type ExportLine = z.infer<typeof exportLineSchema>;

export const exportSchema = z.object({
  id: z.string().min(1),
  engagementId: z.string().min(1),
  status: z.enum(["draft", "sent"]),
  lines: z.array(exportLineSchema),
  confirmedAt: z.string().datetime().optional(),
  payloadJson: z.string(),
});
export type EngineExport = z.infer<typeof exportSchema>;
