import { z } from "zod";

export const recordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
});

export const createRecordInputSchema = recordSchema.pick({ title: true });

export type RecordItem = z.infer<typeof recordSchema>;
export type CreateRecordInput = z.infer<typeof createRecordInputSchema>;
