import { describe, expect, test } from "bun:test";
import {
  CLASSIFY_CONFIDENCE_THRESHOLD,
  MAX_UPLOAD_BYTES,
  POLL_INTERVAL_MS,
  REGEX_FAIL_CONFIDENCE_CAP,
} from "../../src/shared/constants.ts";

describe("shared constants", () => {
  test("pipeline thresholds are sane", () => {
    expect(CLASSIFY_CONFIDENCE_THRESHOLD).toBe(0.6);
    expect(REGEX_FAIL_CONFIDENCE_CAP).toBeLessThan(CLASSIFY_CONFIDENCE_THRESHOLD);
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
    expect(POLL_INTERVAL_MS).toBe(2000);
  });
});
