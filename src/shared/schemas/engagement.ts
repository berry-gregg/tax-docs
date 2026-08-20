import { z } from "zod";

export const filingTypeSchema = z.enum(["1120-S", "1065"]);
export type FilingType = z.infer<typeof filingTypeSchema>;
