import { z } from "zod";
import { fieldDefSchema } from "./metadata.ts";

export const documentTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  active: z.boolean(),
  createdBy: z.enum(["seed", "cpa"]),
  fields: z.array(fieldDefSchema).min(1),
  createdAt: z.string().datetime(),
});
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const createDocumentTypeInputSchema = documentTypeSchema
  .pick({ name: true, description: true, fields: true })
  .extend({ active: z.boolean().default(true) });
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeInputSchema>;

export const updateDocumentTypeInputSchema = documentTypeSchema
  .pick({ name: true, description: true, active: true, fields: true })
  .partial();
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeInputSchema>;
