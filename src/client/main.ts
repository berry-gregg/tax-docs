import "./styles/main.css";
import { inboxUnreadCountSchema, metricsSchema } from "@shared/schemas/api";
import { healthResponseSchema } from "@shared/schemas/health";
import { searchResponseSchema, type SearchResult } from "@shared/schemas/search";
import { getJson, startPolling } from "./app/api.ts";
import { flattenPalette, searchPalette } from "./app/command-palette.ts";
import { clearNewEngagementDraftIfLeft } from "./app/pages/new-engagement.ts";
import { moduleFor, type PageModule } from "./app/pages/registry.ts";
import {
  renderApp,
  renderLoadError,
  renderPageSkeleton,
  renderPaletteResults,
} from "./app/render.ts";
import { parseRoute, type Route } from "./app/router.ts";

type BadgeElement = Pick<HTMLElement, "hidden" | "textContent">;

/** One refresh recipe for every live nav badge (inbox unread, documents needs-review). */
export type BadgeRefreshOptions = {
  fetchCount: () => Promise<number>;
  queryBadge: () => BadgeElement | null;
  writeCount: (count: number) => void;
  logError?: (message: string) => void;
};

function applyBadgeCount(badge: BadgeElement, count: number): void {
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
  querySelector(selector: string): unknown;
  replaceWith(node: T): void;
};

const OPEN_DIALOG_SELECTORS = [
  "[data-new-engagement-modal]:not([hidden])",
  ".side-panel",
  "[data-export-confirm-modal]:not([hidden])",
  // Portal waive note: a poll repaint while the client types would steal focus mid-note.
  "[data-portal-waive-form]:not([hidden])",
  // Message compose boxes (inbox + portal): pause repaints while the user is typing in one.
  "[data-preserve-focus]:focus-within",
] as const;

/** Poll must not swap `.workspace` while a modal or side panel holds focus. */
export function dialogOpen(workspace: { querySelector(selector: string): unknown } | null): boolean {
  if (!workspace) {
    return false;
  }

  return OPEN_DIALOG_SELECTORS.some((selector) => workspace.querySelector(selector) != null);
}

/**
 * Escape closes a dialog by clicking its existing close/cancel control so the page's own close
 * path runs (new-engagement Cancel clears the draft singleton and strips `?new=1`, export Cancel
 * hides the confirm modal, schema-builder Close empties its slot). The new-engagement success
 * step renders no Cancel button, so the backdrop is its fallback — the page's click handler
 * treats a click on the modal element itself as close. Order is stacking order: a modal sits
 * above the side panel, so only the topmost match is clicked.
 */
const ESCAPE_CLOSE_SELECTORS = [
  "[data-new-engagement-modal]:not([hidden]) [data-close-new-engagement]",
  "[data-new-engagement-modal]:not([hidden])",
  "[data-export-confirm-modal]:not([hidden]) [data-export-cancel]",
  ".side-panel [data-schema-close]",
] as const;

export type EscapeCloseHost = { querySelector(selector: string): unknown };

export function closeOpenDialog(host: EscapeCloseHost | null): boolean {
  if (!host) {
    return false;
  }

  for (const selector of ESCAPE_CLOSE_SELECTORS) {
    const control = host.querySelector(selector);
    if (isClickable(control)) {
      control.click();
      return true;
    }
  }

  return false;
}

function isClickable(value: unknown): value is { click(): void } {
  return (
    typeof value === "object" &&
    value !== null &&
    "click" in value &&
    typeof (value as { click: unknown }).click === "function"
  );
}

export type ShellKeydownEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
};

export type ShellKeydownDeps = {
  /** Chromeless routes (client portal) render no palette; ⌘K must fall through to the browser there. */
  paletteExists(): boolean;
  paletteIsOpen(): boolean;
  setPalette(open: boolean): void;
  movePaletteSelection(delta: number): void;
  activatePaletteSelection(): void;
  dialogHost(): EscapeCloseHost | null;
};

/**
 * Window-level keyboard shell. Dialog Escape must live here: handlers bound to `.workspace`
 * never fire when focus sits on `document.body` (keydown bubbles up from the target, not down
 * through descendants), which is exactly where focus lands after a repaint.
 */
export function handleShellKeydown(event: ShellKeydownEvent, deps: ShellKeydownDeps): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    if (!deps.paletteExists()) {
      return;
    }

    event.preventDefault();
    deps.setPalette(!deps.paletteIsOpen());
    return;
  }

  if (event.key === "Escape") {
    if (deps.paletteIsOpen()) {
      event.preventDefault();
      deps.setPalette(false);
      return;
    }

    if (closeOpenDialog(deps.dialogHost())) {
      event.preventDefault();
    }
    return;
  }

  if (!deps.paletteIsOpen()) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    deps.movePaletteSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    deps.movePaletteSelection(-1);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    deps.activatePaletteSelection();
  }
}

export type PaletteSearchTimer = {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
};

export type PaletteSearchOptions = {
  fetchResults(query: string): Promise<SearchResult[]>;
  onResults(results: SearchResult[]): void;
  debounceMs?: number;
  /** Injectable clock for tests; defaults to the real setTimeout/clearTimeout. */
  timer?: PaletteSearchTimer;
  logError?(message: string): void;
};

export type PaletteSearch = {
  setQuery(query: string): void;
  reset(): void;
};

const realTimer: PaletteSearchTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

const PALETTE_DEBOUNCE_MS = 175;

/**
 * Debounced entity search behind the command palette. Each keystroke re-arms one timer; only
 * the query that survives the debounce window fetches. A sequence number guards ordering: a
 * response is dropped unless it belongs to the most recently fired fetch, so a slow stale
 * response can never overwrite a newer one. An empty query clears the entity rows without a
 * request and invalidates anything still in flight.
 */
export function createPaletteSearch({
  fetchResults,
  onResults,
  debounceMs = PALETTE_DEBOUNCE_MS,
  timer = realTimer,
  logError,
}: PaletteSearchOptions): PaletteSearch {
  let sequence = 0;
  let pendingTimer: unknown = null;

  function clearPending(): void {
    if (pendingTimer !== null) {
      timer.clear(pendingTimer);
      pendingTimer = null;
    }
  }

  function setQuery(query: string): void {
    clearPending();
    const trimmed = query.trim();

    if (trimmed.length === 0) {
      sequence += 1;
      onResults([]);
      return;
    }

    pendingTimer = timer.set(() => {
      pendingTimer = null;
      const fired = ++sequence;
      fetchResults(trimmed).then(
        (results) => {
          if (fired === sequence) {
            onResults(results);
          }
        },
        (error: unknown) => {
          if (fired === sequence) {
            logError?.(`Palette search failed: ${messageFor(error)}`);
          }
        },
      );
    }, debounceMs);
  }

  function reset(): void {
    clearPending();
    sequence += 1;
    onResults([]);
  }

  return { setQuery, reset };
}

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
  if (!workspace || nextBody === previousBody || dialogOpen(workspace)) {
    return { changed: false, workspace };
  }

  const next = workspace.ownerDocument.createElement(workspace.localName);
  next.className = workspace.className;
  next.innerHTML = nextBody;
  workspace.replaceWith(next);
  return { changed: true, workspace: next };
}

export async function refreshBadgeState({
  fetchCount,
  queryBadge,
  writeCount,
  logError,
}: BadgeRefreshOptions): Promise<void> {
  try {
    const count = await fetchCount();
    writeCount(count);
    const badge = queryBadge();
    if (badge) {
      applyBadgeCount(badge, count);
    }
  } catch (error) {
    logError?.(`Nav badge count failed to load: ${messageFor(error)}`);
  }
}

const root = typeof document === "undefined" ? null : document.querySelector("#app");
let navCollapsed = false;
let paletteQuery = "";
let paletteActiveIndex = 0;
/** Entity rows from the latest `/api/search` response for the current palette query. */
let paletteEntityResults: SearchResult[] = [];
let inboxUnreadCount = 0;
let documentsNeedsReviewCount = 0;
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
    documentsNeedsReviewCount,
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
  clearNewEngagementDraftIfLeft(window.location.pathname, window.location.search);
  const module = moduleFor(route);

  renderShell(renderPageSkeleton());
  void refreshNavBadges();

  try {
    const data = await module.load(route);
    if (sequence !== paintSequence) {
      return;
    }

    renderShell(module.render(data));
    await refreshNavBadges();
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
        await refreshNavBadges();
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
    // Actions and Pages filter on the keystroke; entity rows land when the debounced fetch does.
    refreshPaletteResults();
    paletteSearch.setQuery(paletteQuery);
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
  // Opening or closing drops the previous query's entity rows and cancels any in-flight fetch.
  paletteSearch.reset();

  if (!open) {
    return;
  }

  refreshPaletteResults();
  const input = root?.querySelector<HTMLInputElement>("[data-command-input]");
  if (input) {
    input.value = "";
    input.focus();
  }
}

/**
 * The palette searches the whole database: every keystroke debounces one `GET /api/search?q=`
 * fetch (clients, engagements, documents, document types), while the static Actions and Pages
 * groups keep filtering locally for instant feedback.
 */
const paletteSearch = createPaletteSearch({
  fetchResults: async (query) => {
    const payload = await getJson(
      `/api/search?q=${encodeURIComponent(query)}`,
      searchResponseSchema,
    );
    return payload.results;
  },
  onResults: (results) => {
    paletteEntityResults = results;
    refreshPaletteResults();
  },
  logError: (message) => console.error(message),
});

function refreshPaletteResults(): void {
  const current = root?.querySelector("[data-palette-results]");
  if (!current) {
    return;
  }

  const groups = searchPalette(paletteQuery, paletteEntityResults);
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
  const items = flattenPalette(searchPalette(paletteQuery, paletteEntityResults));
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
  await refreshBadgeState({
    fetchCount: async () => {
      const payload = await getJson("/api/inbox/unread-count", inboxUnreadCountSchema);
      return payload.count;
    },
    queryBadge: () => root?.querySelector<HTMLElement>("[data-inbox-badge]") ?? null,
    writeCount: (count) => {
      inboxUnreadCount = count;
    },
    logError: (message) => console.error(message),
  });
}

/** The documents pill mirrors the Needs review tab: `needsReviewCount` from `/api/metrics`. */
async function refreshDocumentsBadge(): Promise<void> {
  await refreshBadgeState({
    fetchCount: async () => {
      const payload = await getJson("/api/metrics", metricsSchema);
      return payload.needsReviewCount;
    },
    queryBadge: () => root?.querySelector<HTMLElement>("[data-documents-badge]") ?? null,
    writeCount: (count) => {
      documentsNeedsReviewCount = count;
    },
    logError: (message) => console.error(message),
  });
}

async function refreshNavBadges(): Promise<void> {
  await Promise.all([refreshInboxBadge(), refreshDocumentsBadge()]);
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
    handleShellKeydown(event, {
      paletteExists: () => root?.querySelector("[data-command-palette]") != null,
      paletteIsOpen,
      setPalette,
      movePaletteSelection,
      activatePaletteSelection,
      dialogHost: () => root?.querySelector<HTMLElement>(".workspace") ?? null,
    });
  });

  void paint();
}
