import { z } from "zod";

export const entityTypeSchema = z.enum(["s-corp", "partnership", "c-corp", "llc"]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const clientSchema = z.object({
  id: z.string().min(1),
  legalName: z.string().min(1),
  entityType: entityTypeSchema,
  ein: z.string().min(1),
  contactName: z.string().min(1),
  contactEmail: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Client = z.infer<typeof clientSchema>;

export const createClientInputSchema = clientSchema.omit({ id: true, createdAt: true });
export type CreateClientInput = z.infer<typeof createClientInputSchema>;
