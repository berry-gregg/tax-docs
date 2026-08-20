import { describe, expect, test } from "bun:test";
import {
  closeOpenDialog,
  createPaletteSearch,
  dialogOpen,
  handleShellKeydown,
  refreshBadgeState,
  replaceWorkspaceBody,
  type ShellKeydownDeps,
} from "../../src/client/main.ts";
import { renderNewEngagementModal } from "../../src/client/app/pages/new-engagement.ts";
import type { SearchResult } from "../../src/shared/schemas/search.ts";

type Badge = {
  hidden: boolean;
  textContent: string;
};

describe("refreshBadgeState", () => {
  test("queries the badge after awaiting the count and persists the count", async () => {
    const discardedBadge: Badge = { hidden: true, textContent: "" };
    const visibleBadge: Badge = { hidden: true, textContent: "" };
    let domReplaced = false;
    let queryCalls = 0;
    let persistedCount = 0;
    let resolveCount: (count: number) => void = () => {};

    const countPromise = new Promise<number>((resolve) => {
      resolveCount = resolve;
    });

    const refresh = refreshBadgeState({
      fetchCount: () => countPromise,
      queryBadge: () => {
        queryCalls += 1;
        return domReplaced ? visibleBadge : discardedBadge;
      },
      writeCount: (count) => {
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
  test("is true for the live dialog hosts and false when they are hidden or absent", () => {
    const openModal = new FakeWorkspace();
    openModal.openSelectors.push("[data-new-engagement-modal]:not([hidden])");
    const portalWaive = new FakeWorkspace();
    portalWaive.openSelectors.push("[data-portal-waive-form]:not([hidden])");
    const sidePanel = new FakeWorkspace();
    sidePanel.openSelectors.push(".side-panel");
    const exportConfirm = new FakeWorkspace();
    exportConfirm.openSelectors.push("[data-export-confirm-modal]:not([hidden])");
    const hiddenModal = new FakeWorkspace();
    hiddenModal.openSelectors.push("[data-new-engagement-modal]");

    expect(dialogOpen(openModal)).toBe(true);
    expect(dialogOpen(portalWaive)).toBe(true);
    expect(dialogOpen(sidePanel)).toBe(true);
    expect(dialogOpen(exportConfirm)).toBe(true);
    expect(dialogOpen(hiddenModal)).toBe(false);
    expect(dialogOpen(new FakeWorkspace())).toBe(false);
  });

  test("is true while focus sits inside a data-preserve-focus container (compose boxes)", () => {
    const composeFocused = new FakeWorkspace();
    composeFocused.openSelectors.push("[data-preserve-focus]:focus-within");

    expect(dialogOpen(composeFocused)).toBe(true);
  });
});

const NEW_ENGAGEMENT_CANCEL = "[data-new-engagement-modal]:not([hidden]) [data-close-new-engagement]";
const NEW_ENGAGEMENT_BACKDROP = "[data-new-engagement-modal]:not([hidden])";
const EXPORT_CANCEL = "[data-export-confirm-modal]:not([hidden]) [data-export-cancel]";
const SCHEMA_CLOSE = ".side-panel [data-schema-close]";

class FakeControl {
  clicks = 0;
  click(): void {
    this.clicks += 1;
  }
}

class FakeDialogHost {
  controls = new Map<string, FakeControl>();

  add(selector: string): FakeControl {
    const control = new FakeControl();
    this.controls.set(selector, control);
    return control;
  }

  querySelector(selector: string): FakeControl | null {
    return this.controls.get(selector) ?? null;
  }
}

describe("closeOpenDialog", () => {
  test("Escape path clicks the new-engagement Cancel control, not the backdrop", () => {
    const host = new FakeDialogHost();
    const cancel = host.add(NEW_ENGAGEMENT_CANCEL);
    const backdrop = host.add(NEW_ENGAGEMENT_BACKDROP);

    expect(closeOpenDialog(host)).toBe(true);
    expect(cancel.clicks).toBe(1);
    expect(backdrop.clicks).toBe(0);
  });

  test("success step has no Cancel, so the backdrop takes the close click", () => {
    const host = new FakeDialogHost();
    const backdrop = host.add(NEW_ENGAGEMENT_BACKDROP);

    expect(closeOpenDialog(host)).toBe(true);
    expect(backdrop.clicks).toBe(1);
  });

  test("Escape path clicks the export-confirm Cancel control", () => {
    const host = new FakeDialogHost();
    const cancel = host.add(EXPORT_CANCEL);

    expect(closeOpenDialog(host)).toBe(true);
    expect(cancel.clicks).toBe(1);
  });

  test("Escape path clicks the schema-builder side panel close control", () => {
    const host = new FakeDialogHost();
    const close = host.add(SCHEMA_CLOSE);

    expect(closeOpenDialog(host)).toBe(true);
    expect(close.clicks).toBe(1);
  });

  test("reports unhandled when no dialog is open and when the host is null", () => {
    expect(closeOpenDialog(new FakeDialogHost())).toBe(false);
    expect(closeOpenDialog(null)).toBe(false);
  });

  test("only the topmost dialog closes when a modal sits over the side panel", () => {
    const host = new FakeDialogHost();
    const modalCancel = host.add(NEW_ENGAGEMENT_CANCEL);
    const panelClose = host.add(SCHEMA_CLOSE);

    expect(closeOpenDialog(host)).toBe(true);
    expect(modalCancel.clicks).toBe(1);
    expect(panelClose.clicks).toBe(0);
  });

  test("the success step really renders no Cancel control but keeps the backdrop hook", () => {
    const html = renderNewEngagementModal({
      step: "success",
      mode: "existing",
      selectedClientId: "client-1",
      taxYear: 2025,
      filingType: "1120-S",
      clients: [],
      documentTypes: [],
      items: [],
      portalToken: "portal-token",
      engagementId: "eng-1",
    });

    expect(html).not.toContain("data-close-new-engagement");
    expect(html).toContain("data-new-engagement-modal");
  });
});

type KeyInit = Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey">>;

class FakeKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  prevented = false;

  constructor(key: string, init: KeyInit = {}) {
    this.key = key;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
  }

  preventDefault(): void {
    this.prevented = true;
  }
}

function makeShell(overrides: Partial<ShellKeydownDeps> = {}): {
  deps: ShellKeydownDeps;
  calls: string[];
  host: FakeDialogHost;
} {
  const calls: string[] = [];
  const host = new FakeDialogHost();
  const deps: ShellKeydownDeps = {
    paletteExists: () => true,
    paletteIsOpen: () => false,
    setPalette: (open) => calls.push(`setPalette:${open}`),
    movePaletteSelection: (delta) => calls.push(`move:${delta}`),
    activatePaletteSelection: () => calls.push("activate"),
    dialogHost: () => host,
    ...overrides,
  };
  return { deps, calls, host };
}

describe("handleShellKeydown", () => {
  test("Escape closes the open dialog through its existing close control", () => {
    const { deps, host } = makeShell();
    const cancel = host.add(NEW_ENGAGEMENT_CANCEL);
    const event = new FakeKeyEvent("Escape");

    handleShellKeydown(event, deps);

    expect(cancel.clicks).toBe(1);
    expect(event.prevented).toBe(true);
  });

  test("Escape with no open dialog is a no-op and leaves the browser default alone", () => {
    const { deps, calls } = makeShell();
    const event = new FakeKeyEvent("Escape");

    handleShellKeydown(event, deps);

    expect(event.prevented).toBe(false);
    expect(calls).toEqual([]);
  });

  test("Escape closes the palette before touching a dialog underneath", () => {
    const { deps, calls, host } = makeShell({ paletteIsOpen: () => true });
    const cancel = host.add(NEW_ENGAGEMENT_CANCEL);
    const event = new FakeKeyEvent("Escape");

    handleShellKeydown(event, deps);

    expect(calls).toEqual(["setPalette:false"]);
    expect(cancel.clicks).toBe(0);
    expect(event.prevented).toBe(true);
  });

  test("Ctrl-K and Meta-K toggle the palette on firm pages", () => {
    const opened = makeShell();
    const openEvent = new FakeKeyEvent("k", { ctrlKey: true });
    handleShellKeydown(openEvent, opened.deps);
    expect(opened.calls).toEqual(["setPalette:true"]);
    expect(openEvent.prevented).toBe(true);

    const closed = makeShell({ paletteIsOpen: () => true });
    const closeEvent = new FakeKeyEvent("K", { metaKey: true });
    handleShellKeydown(closeEvent, closed.deps);
    expect(closed.calls).toEqual(["setPalette:false"]);
    expect(closeEvent.prevented).toBe(true);
  });

  test("Ctrl-K on the chromeless portal falls through to the browser", () => {
    const { deps, calls } = makeShell({ paletteExists: () => false });
    const event = new FakeKeyEvent("k", { ctrlKey: true });

    handleShellKeydown(event, deps);

    expect(event.prevented).toBe(false);
    expect(calls).toEqual([]);
  });

  test("palette navigation keys only act while the palette is open", () => {
    const closedShell = makeShell();
    handleShellKeydown(new FakeKeyEvent("ArrowDown"), closedShell.deps);
    expect(closedShell.calls).toEqual([]);

    const openShell = makeShell({ paletteIsOpen: () => true });
    handleShellKeydown(new FakeKeyEvent("ArrowDown"), openShell.deps);
    handleShellKeydown(new FakeKeyEvent("ArrowUp"), openShell.deps);
    handleShellKeydown(new FakeKeyEvent("Enter"), openShell.deps);
    expect(openShell.calls).toEqual(["move:1", "move:-1", "activate"]);
  });
});

type ScheduledTimer = { fn: () => void; ms: number; cleared: boolean };

class FakeTimer {
  scheduled: ScheduledTimer[] = [];

  set(fn: () => void, ms: number): unknown {
    const entry: ScheduledTimer = { fn, ms, cleared: false };
    this.scheduled.push(entry);
    return entry;
  }

  clear(id: unknown): void {
    (id as ScheduledTimer).cleared = true;
  }

  fireLast(): void {
    const entry = this.scheduled.at(-1);
    if (entry && !entry.cleared) {
      // One-shot semantics: a fired timer is spent and no longer pending.
      entry.cleared = true;
      entry.fn();
    }
  }

  get pending(): ScheduledTimer[] {
    return this.scheduled.filter((entry) => !entry.cleared);
  }
}

function clientResult(id: string): SearchResult {
  return { id, group: "Clients", label: `Client ${id}`, href: `/clients/${id}` };
}

describe("createPaletteSearch", () => {
  test("debounces keystrokes: only the final query fetches, once, after the delay", async () => {
    const timer = new FakeTimer();
    const fetched: string[] = [];
    const painted: SearchResult[][] = [];

    const search = createPaletteSearch({
      fetchResults: (query) => {
        fetched.push(query);
        return Promise.resolve([clientResult(query)]);
      },
      onResults: (results) => painted.push(results),
      debounceMs: 175,
      timer,
    });

    search.setQuery("n");
    search.setQuery("no");
    search.setQuery("nor");

    expect(fetched).toEqual([]);
    expect(timer.pending).toHaveLength(1);
    expect(timer.pending[0]?.ms).toBe(175);

    timer.fireLast();
    await Promise.resolve();

    expect(fetched).toEqual(["nor"]);
    expect(painted).toEqual([[clientResult("nor")]]);
  });

  test("an empty query clears results without fetching and discards the in-flight fetch", async () => {
    const timer = new FakeTimer();
    let resolveFetch: (results: SearchResult[]) => void = () => {};
    const painted: SearchResult[][] = [];

    const search = createPaletteSearch({
      fetchResults: () =>
        new Promise<SearchResult[]>((resolve) => {
          resolveFetch = resolve;
        }),
      onResults: (results) => painted.push(results),
      timer,
    });

    search.setQuery("northwind");
    timer.fireLast();
    search.setQuery("   ");

    expect(painted).toEqual([[]]);
    expect(timer.pending).toHaveLength(0);

    resolveFetch([clientResult("stale")]);
    await Promise.resolve();

    expect(painted).toEqual([[]]);
  });

  test("a stale response never overwrites a newer one", async () => {
    const timer = new FakeTimer();
    const resolvers = new Map<string, (results: SearchResult[]) => void>();
    const painted: SearchResult[][] = [];

    const search = createPaletteSearch({
      fetchResults: (query) =>
        new Promise<SearchResult[]>((resolve) => {
          resolvers.set(query, resolve);
        }),
      onResults: (results) => painted.push(results),
      timer,
    });

    search.setQuery("alpha");
    timer.fireLast();
    search.setQuery("beta");
    timer.fireLast();

    resolvers.get("beta")?.([clientResult("beta")]);
    await Promise.resolve();
    resolvers.get("alpha")?.([clientResult("alpha")]);
    await Promise.resolve();

    expect(painted).toEqual([[clientResult("beta")]]);
  });

  test("a failed fetch logs the cause and leaves the current results alone", async () => {
    const timer = new FakeTimer();
    const logged: string[] = [];
    const painted: SearchResult[][] = [];

    const search = createPaletteSearch({
      fetchResults: () => Promise.reject(new Error("db unreachable")),
      onResults: (results) => painted.push(results),
      logError: (message) => logged.push(message),
      timer,
    });

    search.setQuery("northwind");
    timer.fireLast();
    await Promise.resolve();

    expect(painted).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("db unreachable");
  });

  test("reset cancels the pending fetch and empties the results", () => {
    const timer = new FakeTimer();
    const fetched: string[] = [];
    const painted: SearchResult[][] = [];

    const search = createPaletteSearch({
      fetchResults: (query) => {
        fetched.push(query);
        return Promise.resolve([]);
      },
      onResults: (results) => painted.push(results),
      timer,
    });

    search.setQuery("northwind");
    search.reset();
    timer.fireLast();

    expect(fetched).toEqual([]);
    expect(painted).toEqual([[]]);
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

  test("skips replace while a message compose box holds focus so typing survives the poll", () => {
    const workspace = new FakeWorkspace();
    workspace.openSelectors.push("[data-preserve-focus]:focus-within");

    const result = replaceWorkspaceBody(workspace, "<p>old thread</p>", "<p>new message arrived</p>");

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
    expect(workspace.replaced).toBe(false);
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
