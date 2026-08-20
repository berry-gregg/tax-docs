import { describe, expect, test } from "bun:test";
import { refreshInboxBadgeState, replaceWorkspaceBody } from "../../src/client/main.ts";

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

describe("replaceWorkspaceBody", () => {
  test("returns unchanged when the markup is the same so poll does not rebind", () => {
    const workspace = new FakeWorkspace();
    workspace.innerHTML = "<p>same</p>";

    const result = replaceWorkspaceBody(workspace, "<p>same</p>", "<p>same</p>");

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
  });

  test("first paint from empty markup still returns a node to bind", () => {
    const workspace = new FakeWorkspace();

    const result = replaceWorkspaceBody(workspace, "", "<button type='button'>Add item</button>");

    expect(result.changed).toBe(true);
    expect(result.workspace).not.toBeNull();
    expect(result.workspace).not.toBe(workspace);
    expect(result.workspace?.innerHTML).toContain("Add item");
  });

  test("keeps the portal workspace class on the replacement node", () => {
    const workspace = new FakeWorkspace();
    workspace.className = "workspace workspace-portal";

    const result = replaceWorkspaceBody(workspace, "", "<p>portal</p>");

    expect(result.workspace?.className).toBe("workspace workspace-portal");
  });

  test("a second replace then bind does not stack click handlers on the surviving node", () => {
    const host = { current: new FakeWorkspace() };
    host.current.parent = host;

    let clicks = 0;
    const bind = (node: FakeWorkspace) => {
      node.addEventListener("click", () => {
        clicks += 1;
      });
    };

    const first = replaceWorkspaceBody(host.current, "", "<button type='button'>Add item</button>");
    if (!first.workspace || !isFakeWorkspace(first.workspace)) {
      throw new Error("first replace must yield a workspace");
    }
    host.current = first.workspace;
    bind(host.current);

    const second = replaceWorkspaceBody(host.current, "<button type='button'>Add item</button>", "<button type='button'>Waive</button>");
    if (!second.changed || !second.workspace || !isFakeWorkspace(second.workspace)) {
      throw new Error("changed poll markup must yield a new workspace");
    }
    host.current = second.workspace;
    bind(host.current);

    host.current.dispatch("click");

    expect(clicks).toBe(1);
    expect(host.current).not.toBe(first.workspace);
  });
});

class FakeDocument {
  createElement(tagName: string): FakeWorkspace {
    return new FakeWorkspace(tagName);
  }
}

class FakeWorkspace {
  className = "";
  innerHTML = "";
  localName: string;
  ownerDocument = new FakeDocument();
  parent: { current: FakeWorkspace } | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(tagName = "div") {
    this.localName = tagName;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  replaceWith(node: FakeWorkspace): void {
    if (this.parent) {
      this.parent.current = node;
      node.parent = this.parent;
    }
  }
}

function isFakeWorkspace(node: { dispatch?: unknown }): node is FakeWorkspace {
  return typeof node.dispatch === "function";
}
