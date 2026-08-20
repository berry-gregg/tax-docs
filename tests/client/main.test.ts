import { describe, expect, test } from "bun:test";
import { refreshInboxBadgeState } from "../../src/client/main.ts";

type Badge = {
  hidden: boolean;
  textContent: string;
};

describe("refreshInboxBadgeState", () => {
  test("queries the badge after awaiting the unread count and persists the count", async () => {
    const discardedBadge: Badge = { hidden: true, textContent: "" };
    const visibleBadge: Badge = { hidden: true, textContent: "" };
    let domReplaced = false;
    let queryCalls = 0;
    let persistedCount = 0;
    let resolveCount: (count: number) => void = () => {};

    const countPromise = new Promise<number>((resolve) => {
      resolveCount = resolve;
    });

    const refresh = refreshInboxBadgeState({
      fetchUnreadCount: () => countPromise,
      queryBadge: () => {
        queryCalls += 1;
        return domReplaced ? visibleBadge : discardedBadge;
      },
      writeUnreadCount: (count) => {
        persistedCount = count;
      },
    });

    expect(queryCalls).toBe(0);

    domReplaced = true;
    resolveCount(6);
    await refresh;

    expect(queryCalls).toBe(1);
    expect(persistedCount).toBe(6);
    expect(visibleBadge).toEqual({ hidden: false, textContent: "6" });
    expect(discardedBadge).toEqual({ hidden: true, textContent: "" });
  });
});
