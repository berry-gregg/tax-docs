import { describe, expect, test } from "bun:test";
import { dialogOpen, refreshInboxBadgeState, replaceWorkspaceBody } from "../../src/client/main.ts";

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

describe("dialogOpen", () => {
  test("is true for the three live dialog hosts and false when they are hidden or absent", () => {
    const openModal = new FakeWorkspace();
    openModal.openSelectors.push("[data-new-engagement-modal]:not([hidden])");
    const sidePanel = new FakeWorkspace();
    sidePanel.openSelectors.push(".side-panel");
    const exportConfirm = new FakeWorkspace();
    exportConfirm.openSelectors.push("[data-export-confirm-modal]:not([hidden])");
    const hiddenModal = new FakeWorkspace();
    hiddenModal.openSelectors.push("[data-new-engagement-modal]");

    expect(dialogOpen(openModal)).toBe(true);
    expect(dialogOpen(sidePanel)).toBe(true);
    expect(dialogOpen(exportConfirm)).toBe(true);
    expect(dialogOpen(hiddenModal)).toBe(false);
    expect(dialogOpen(new FakeWorkspace())).toBe(false);
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

  test("skips replace while a new-engagement modal is open so poll does not steal focus", () => {
    const workspace = new FakeWorkspace();
    workspace.openSelectors.push("[data-new-engagement-modal]:not([hidden])");

    const result = replaceWorkspaceBody(workspace, "<p>old list</p>", "<p>draft typed into the modal</p>");

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
    expect(workspace.replaced).toBe(false);
  });

  test("skips replace while a schema-builder side panel is open", () => {
    const workspace = new FakeWorkspace();
    workspace.openSelectors.push(".side-panel");

    const result = replaceWorkspaceBody(workspace, "<p>old</p>", "<p>poll markup</p>");

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
  });

  test("skips replace while an export confirm modal is open", () => {
    const workspace = new FakeWorkspace();
    workspace.openSelectors.push("[data-export-confirm-modal]:not([hidden])");

    const result = replaceWorkspaceBody(workspace, "<p>old</p>", "<p>poll markup</p>");

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
  });

  test("replaces on the next tick after the dialog closes", () => {
    const host = { current: new FakeWorkspace() };
    host.current.parent = host;
    host.current.openSelectors.push("[data-new-engagement-modal]:not([hidden])");

    const skipped = replaceWorkspaceBody(host.current, "<p>old</p>", "<p>typed draft</p>");
    expect(skipped.changed).toBe(false);

    host.current.openSelectors = [];
    const resumed = replaceWorkspaceBody(host.current, "<p>old</p>", "<p>typed draft</p>");

    expect(resumed.changed).toBe(true);
    expect(resumed.workspace).not.toBe(skipped.workspace);
    expect(resumed.workspace?.innerHTML).toContain("typed draft");
  });

  test("a hidden new-engagement modal does not block replace", () => {
    const workspace = new FakeWorkspace();
    workspace.openSelectors.push("[data-new-engagement-modal]");

    const result = replaceWorkspaceBody(workspace, "<p>old</p>", "<p>fresh list</p>");

    expect(result.changed).toBe(true);
    expect(result.workspace?.innerHTML).toContain("fresh list");
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
  openSelectors: string[] = [];
  replaced = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(tagName = "div") {
    this.localName = tagName;
  }

  querySelector(selector: string): { selector: string } | null {
    return this.openSelectors.includes(selector) ? { selector } : null;
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
    this.replaced = true;
    if (this.parent) {
      this.parent.current = node;
      node.parent = this.parent;
    }
  }
}

function isFakeWorkspace(node: { dispatch?: unknown }): node is FakeWorkspace {
  return typeof node.dispatch === "function";
}
