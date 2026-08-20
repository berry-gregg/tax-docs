import { z } from "zod";
import { filingTypeSchema } from "./engagement.ts";

export const requestTemplateItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  documentTypeId: z.string().min(1),
  required: z.boolean(),
});

export const requestTemplateSchema = z.object({
  id: z.string().min(1),
  filingType: filingTypeSchema,
  items: z.array(requestTemplateItemSchema).min(1),
});
export type RequestTemplate = z.infer<typeof requestTemplateSchema>;

export const requestItemStatusSchema = z.enum(["open", "received", "needs-attention", "waived"]);

export const requestItemSchema = z.object({
  id: z.string().min(1),
  engagementId: z.string().min(1),
  documentTypeId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  required: z.boolean(),
  status: requestItemStatusSchema,
  matchedDocumentIds: z.array(z.string()),
});
export type RequestItem = z.infer<typeof requestItemSchema>;

export const createRequestItemInputSchema = requestItemSchema.pick({
  documentTypeId: true,
  title: true,
  description: true,
  required: true,
});
export type CreateRequestItemInput = z.infer<typeof createRequestItemInputSchema>;
