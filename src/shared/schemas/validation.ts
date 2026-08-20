import { z } from "zod";

export const validationCheckSchema = z.object({
  checkId: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["pass", "warn"]),
  explanation: z.string(),
  relatedDocumentIds: z.array(z.string()),
});
export type ValidationCheck = z.infer<typeof validationCheckSchema>;
