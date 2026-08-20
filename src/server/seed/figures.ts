import { z } from "zod";
import figures from "../../../demo-docs/figures.json";

export const figuresSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string().min(1),
      ein: z.string().min(1),
      entityType: z.string().min(1),
      filingType: z.enum(["1120-S", "1065"]),
      taxYear: z.number().int(),
      documents: z.array(
        z.object({
          file: z.string().min(1),
          documentTypeId: z.string().min(1).nullable(),
          fields: z.record(z.union([z.string(), z.number(), z.boolean()])),
        }),
      ),
    }),
  ),
});

export type DemoFigures = z.infer<typeof figuresSchema>;
export type DemoCompany = DemoFigures["companies"][number];
export type DemoFigureDocument = DemoCompany["documents"][number];

export function loadDemoFigures(): DemoFigures {
  return figuresSchema.parse(figures);
}
