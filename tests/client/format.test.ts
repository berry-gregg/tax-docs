import { describe, expect, test } from "bun:test";
import { formatConfidence, formatMoney, formatRelativeTime } from "../../src/client/app/format.ts";

describe("formatMoney", () => {
  test("renders dollars and cents with thousands separators", () => {
    expect(formatMoney(1234.56)).toBe("$1,234.56");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(186400)).toBe("$186,400.00");
  });

  test("keeps the sign on a negative amount", () => {
    expect(formatMoney(-42.1)).toBe("-$42.10");
  });
});

describe("formatConfidence", () => {
  test("rounds to a percent and tiers at 0.9 and 0.7", () => {
    expect(formatConfidence(0.94)).toEqual({ pct: "94%", tier: "high" });
    expect(formatConfidence(0.9)).toEqual({ pct: "90%", tier: "high" });
    expect(formatConfidence(0.7)).toEqual({ pct: "70%", tier: "medium" });
    expect(formatConfidence(0.89)).toEqual({ pct: "89%", tier: "medium" });
    expect(formatConfidence(0.69)).toEqual({ pct: "69%", tier: "low" });
    expect(formatConfidence(0)).toEqual({ pct: "0%", tier: "low" });
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-03-12T12:00:00.000Z");

  test("counts back in minutes, hours, and days", () => {
    expect(formatRelativeTime("2026-03-12T11:58:00.000Z", now)).toBe("2m ago");
    expect(formatRelativeTime("2026-03-12T10:00:00.000Z", now)).toBe("2h ago");
    expect(formatRelativeTime("2026-03-09T12:00:00.000Z", now)).toBe("3d ago");
  });

  test("collapses the last minute to just now", () => {
    expect(formatRelativeTime("2026-03-12T11:59:30.000Z", now)).toBe("just now");
  });

  test("falls back to an absolute date beyond a week", () => {
    expect(formatRelativeTime("2026-01-04T12:00:00.000Z", now)).toBe("Jan 4, 2026");
  });

  test("an unparseable timestamp says so instead of inventing a distance", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("Unknown date");
  });
});
