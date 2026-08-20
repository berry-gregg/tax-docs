import { z } from "zod";

export const metricsSchema = z.object({
  documentsAutoProcessed: z.number().int().nonnegative(),
  fieldsAwaitingReview: z.number().int().nonnegative(),
  straightThroughRate: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  outstandingRequests: z.number().int().nonnegative(),
  activeClients: z.number().int().nonnegative(),
});
export type Metrics = z.infer<typeof metricsSchema>;
