const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const absoluteDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

export type ConfidenceTier = "high" | "medium" | "low";

export function formatConfidence(value: number): { pct: string; tier: ConfidenceTier } {
  const tier: ConfidenceTier = value >= 0.9 ? "high" : value >= 0.7 ? "medium" : "low";

  return { pct: `${Math.round(value * 100)}%`, tier };
}

/**
 * A timestamp we cannot parse says so. Guessing a distance would be a confident invention.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "Unknown date";
  }

  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  }
  if (elapsed < WEEK_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
  }

  return absoluteDateFormatter.format(new Date(then));
}
