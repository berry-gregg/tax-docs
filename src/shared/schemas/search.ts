import { z } from "zod";

/**
 * `GET /api/search?q=` — the command palette's whole-database search. The server matches each
 * group on fields the row label may not contain (client EIN, type description), so the client
 * renders these results as-is instead of re-filtering them against the label.
 */
export const searchGroupIdSchema = z.enum([
  "Clients",
  "Engagements",
  "Documents",
  "Document types",
]);
export type SearchGroupId = z.infer<typeof searchGroupIdSchema>;

export const searchResultSchema = z.object({
  id: z.string().min(1),
  group: searchGroupIdSchema,
  label: z.string().min(1),
  href: z.string().min(1),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Query contract: trimmed, bounded; an empty or whitespace-only query yields no results. */
export const searchQuerySchema = z.object({
  q: z.string().max(100, "Search query must be 100 characters or fewer").optional().default(""),
});
