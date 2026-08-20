import type { ZodError } from "zod";

/** One sentence of Zod issue text for HTTP and client surfaces. Never the raw JSON dump. */
export function zodIssueSummary(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
