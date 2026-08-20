import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { zodIssueSummary } from "../../src/shared/zod-issue-summary.ts";

describe("zodIssueSummary", () => {
  test("joins issue messages into one sentence for the CPA", () => {
    const parsed = z
      .object({ name: z.string().min(1), fields: z.array(z.string()).min(1) })
      .safeParse({ name: "", fields: [] });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("expected Zod failure");
    }

    const summary = zodIssueSummary(parsed.error);
    expect(summary).toContain("at least");
    expect(summary).toContain("; ");
    expect(summary).not.toContain('"code"');
  });
});
