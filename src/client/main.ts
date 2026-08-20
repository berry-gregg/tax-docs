import "./styles/main.css";
import {
  clientListResponseSchema,
  documentListResponseSchema,
  inboxUnreadCountSchema,
} from "@shared/schemas/api";
import { healthResponseSchema } from "@shared/schemas/health";
import { getJson, startPolling } from "./app/api.ts";
import {
  emptyPaletteIndex,
  flattenPalette,
  searchPalette,
  type PaletteIndex,
} from "./app/command-palette.ts";
import { moduleFor, type PageModule } from "./app/pages/registry.ts";
import {
  renderApp,
  renderLoadError,
  renderPageSkeleton,
  renderPaletteResults,
} from "./app/render.ts";
import { parseRoute, type Route } from "./app/router.ts";

type InboxBadgeElement = Pick<HTMLElement, "hidden" | "textContent">;

export type InboxBadgeRefreshOptions = {
  fetchUnreadCount: () => Promise<number>;
  queryBadge: () => InboxBadgeElement | null;
  writeUnreadCount: (count: number) => void;
  logError?: (message: string) => void;
};

function applyInboxBadgeCount(badge: InboxBadgeElement, count: number): void {
  badge.textContent = count > 0 ? String(count) : "";
  badge.hidden = count === 0;
}

export type WorkspaceNode<T = unknown> = {
  className: string;
  innerHTML: string;
  localName: string;
  ownerDocument: {
    createElement(tagName: string): T;
  };
  replaceWith(node: T): void;
};

export type ReplaceWorkspaceBodyResult<T> = {
  changed: boolean;
  workspace: T | null;
};

/**
 * Poll ticks rewrite page HTML. Mutating `innerHTML` on the surviving `.workspace` node
 * leaves delegated click listeners in place, so one Waive/Add-item click fires once per
 * tick. Swap in a fresh node with the same class so old handlers die with the old element.
 */
export function replaceWorkspaceBody<T extends WorkspaceNode<T>>(
  workspace: T | null,
  previousBody: string,
  nextBody: string,
): ReplaceWorkspaceBodyResult<T> {
  if (!workspace || nextBody === previousBody) {
    return { changed: false, workspace };
  }

  const next = workspace.ownerDocument.createElement(workspace.localName);
  next.className = workspace.className;
  next.innerHTML = nextBody;
  workspace.replaceWith(next);
  return { changed: true, workspace: next };
}

export async function refreshInboxBadgeState({
  fetchUnreadCount,
  queryBadge,
  writeUnreadCount,
  logError,
}: InboxBadgeRefreshOptions): Promise<void> {
  try {
    const count = await fetchUnreadCount();
    writeUnreadCount(count);
    const badge = queryBadge();
    if (badge) {
      applyInboxBadgeCount(badge, count);
    }
  } catch (error) {
    logError?.(`Inbox unread count failed to load: ${messageFor(error)}`);
  }
}

const root = typeof document === "undefined" ? null : document.querySelector("#app");
let navCollapsed = false;
let paletteQuery = "";
let paletteActiveIndex = 0;
let paletteIndex: PaletteIndex = emptyPaletteIndex;
let paletteIndexRequested = false;
let inboxUnreadCount = 0;
let stopPolling: (() => void) | null = null;
/** Guards against a slow load painting over a newer navigation. */
let paintSequence = 0;
/** Last markup written into `.workspace`, so an unchanged poll tick leaves the DOM alone. */
let renderedBody = "";

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderShell(body: string): void {
  if (!root) {
    return;
  }

  root.innerHTML = renderApp({
    pathname: window.location.pathname,
    search: window.location.search,
    body,
    inboxUnreadCount,
    paletteIndex,
  });

  if (navCollapsed) {
    root.querySelector(".app")?.classList.add("is-collapsed");
  }

  renderedBody = body;
  bindShell();
  syncCollapseControl();
}

function replaceBody(body: string): boolean {
  const workspace = root?.querySelector<HTMLElement>(".workspace") ?? null;
  const result = replaceWorkspaceBody(workspace, renderedBody, body);
  if (!result.changed || !result.workspace) {
    return false;
  }

  renderedBody = body;
  bindNavLinks(result.workspace);
  return true;
}

function bindPage(module: PageModule<unknown>, data: unknown, sequence: number): void {
  const workspace = root?.querySelector<HTMLElement>(".workspace");
  if (!workspace) {
    return;
  }

  module.bind?.(workspace, data, () => {
    if (sequence === paintSequence) {
      void paint();
    }
  });
}

async function paint(): Promise<void> {
  if (!root) {
    return;
  }

  const sequence = ++paintSequence;
  stopPolling?.();
  stopPolling = null;

  const route: Route = parseRoute(window.location.pathname);
  const module = moduleFor(route);

  renderShell(renderPageSkeleton());
  void refreshInboxBadge();

  try {
    const data = await module.load(route);
    if (sequence !== paintSequence) {
      return;
    }

    renderShell(module.render(data));
    await refreshInboxBadge();
    if (sequence !== paintSequence) {
      return;
    }
    bindPage(module, data, sequence);
    void refreshHealth();

    if (module.pollMs) {
      stopPolling = startPolling(async () => {
        if (sequence !== paintSequence) {
          return;
        }

        const next = await module.load(route);
        if (sequence !== paintSequence) {
          return;
        }

        if (replaceBody(module.render(next))) {
          bindPage(module, next, sequence);
        }
        await refreshInboxBadge();
      }, module.pollMs);
    }
  } catch (error) {
    if (sequence !== paintSequence) {
      return;
    }

    renderShell(renderLoadError(messageFor(error)));
    root.querySelector("[data-retry]")?.addEventListener("click", () => {
      void paint();
    });
  }
}

function navigate(href: string): void {
  window.history.pushState({}, "", href);
  setPalette(false);
  void paint();
}

function bindNavLinks(scope: ParentNode): void {
  scope.querySelectorAll<HTMLAnchorElement>("[data-nav-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/")) {
        return;
      }

      event.preventDefault();
      navigate(href);
    });
  });
}

function bindShell(): void {
  if (!root) {
    return;
  }

  bindNavLinks(root);

  root.querySelector("[data-collapse-nav]")?.addEventListener("click", () => {
    navCollapsed = !navCollapsed;
    root.querySelector(".app")?.classList.toggle("is-collapsed", navCollapsed);
    syncCollapseControl();
  });

  root.querySelectorAll("[data-open-search]").forEach((button) => {
    button.addEventListener("click", () => setPalette(true));
  });

  const palette = root.querySelector("[data-command-palette]");
  palette?.addEventListener("click", (event) => {
    if (event.target === palette) {
      setPalette(false);
    }
  });

  const input = root.querySelector<HTMLInputElement>("[data-command-input]");
  input?.addEventListener("input", () => {
    paletteQuery = input.value;
    paletteActiveIndex = 0;
    refreshPaletteResults();
  });
}

function paletteIsOpen(): boolean {
  const palette = root?.querySelector<HTMLElement>("[data-command-palette]");
  return Boolean(palette && !palette.hidden);
}

function setPalette(open: boolean): void {
  const palette = root?.querySelector<HTMLElement>("[data-command-palette]");
  if (!palette) {
    return;
  }

  palette.hidden = !open;
  paletteQuery = "";
  paletteActiveIndex = 0;

  if (!open) {
    return;
  }

  void ensurePaletteIndex();
  refreshPaletteResults();
  const input = root?.querySelector<HTMLInputElement>("[data-command-input]");
  if (input) {
    input.value = "";
    input.focus();
  }
}

/**
 * The palette searches entities the shell already fetched, so typing never fires a request. The
 * index is pulled the first time the palette opens.
 */
async function ensurePaletteIndex(): Promise<void> {
  if (paletteIndexRequested) {
    return;
  }

  paletteIndexRequested = true;

  try {
    const [documents, clients] = await Promise.all([
      getJson("/api/documents", documentListResponseSchema),
      getJson("/api/clients", clientListResponseSchema),
    ]);

    paletteIndex = {
      documents: documents.documents.map((row) => ({
        id: row.id,
        label: `${row.documentTypeName ?? "Unclassified"} · ${row.clientName}`,
        href: `/engagements/${row.engagementId}/review/${row.id}`,
      })),
      clients: clients.clients.map((client) => ({
        id: client.id,
        label: client.legalName,
        href: `/clients/${client.id}`,
      })),
    };

    refreshPaletteResults();
  } catch (error) {
    paletteIndexRequested = false;
    console.error(`Command palette index failed to load: ${messageFor(error)}`);
  }
}

function refreshPaletteResults(): void {
  const current = root?.querySelector("[data-palette-results]");
  if (!current) {
    return;
  }

  const groups = searchPalette(paletteQuery, paletteIndex);
  const items = flattenPalette(groups);
  paletteActiveIndex =
    items.length > 0 ? Math.min(Math.max(paletteActiveIndex, 0), items.length - 1) : 0;

  current.outerHTML = renderPaletteResults(groups, paletteActiveIndex);
  bindPaletteResults();
  syncActiveDescendant();
}

function syncCollapseControl(): void {
  const button = root?.querySelector<HTMLButtonElement>("[data-collapse-nav]");
  if (!button) {
    return;
  }

  button.setAttribute("aria-label", navCollapsed ? "Expand navigation" : "Collapse navigation");
  button.setAttribute("aria-expanded", navCollapsed ? "false" : "true");
}

function bindPaletteResults(): void {
  const results = root?.querySelector("[data-palette-results]");
  if (results) {
    bindNavLinks(results);
  }
}

function syncActiveDescendant(): void {
  const input = root?.querySelector<HTMLInputElement>("[data-command-input]");
  const active = root?.querySelector<HTMLElement>("[data-palette-active='true']");
  if (input) {
    input.setAttribute("aria-activedescendant", active?.id ?? "");
  }
}

function movePaletteSelection(delta: number): void {
  const items = flattenPalette(searchPalette(paletteQuery, paletteIndex));
  if (items.length === 0) {
    return;
  }

  paletteActiveIndex = (paletteActiveIndex + delta + items.length) % items.length;
  refreshPaletteResults();
}

function activatePaletteSelection(): void {
  const active = root?.querySelector<HTMLAnchorElement>("[data-palette-active='true']");
  active?.click();
}

async function refreshInboxBadge(): Promise<void> {
  await refreshInboxBadgeState({
    fetchUnreadCount: async () => {
      const payload = await getJson("/api/inbox/unread-count", inboxUnreadCountSchema);
      return payload.count;
    },
    queryBadge: () => root?.querySelector<HTMLElement>("[data-inbox-badge]") ?? null,
    writeUnreadCount: (count) => {
      inboxUnreadCount = count;
    },
    logError: (message) => console.error(message),
  });
}

async function refreshHealth(): Promise<void> {
  const statusEl = root?.querySelector<HTMLElement>("[data-api-status]");
  const dbEl = root?.querySelector<HTMLElement>("[data-db-status]");
  if (!statusEl) {
    return;
  }

  statusEl.dataset.state = "loading";

  try {
    const payload = await getJson("/api/health", healthResponseSchema);
    statusEl.textContent = payload.status;
    statusEl.dataset.state = "ready";
    if (dbEl) {
      dbEl.textContent = payload.database;
    }
  } catch (error) {
    statusEl.textContent = messageFor(error);
    statusEl.dataset.state = "error";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    void paint();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setPalette(!paletteIsOpen());
      return;
    }

    if (!paletteIsOpen()) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPalette(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      movePaletteSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      movePaletteSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      activatePaletteSelection();
    }
  });

  void paint();
}
