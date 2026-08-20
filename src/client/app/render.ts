import { brandMarkSrc } from "./brand.ts";
import {
  emptyPaletteIndex,
  flattenPalette,
  searchPalette,
  type PaletteGroup,
  type PaletteIndex,
} from "./command-palette.ts";
import { icons, paletteIcons } from "./icons.ts";
import { navIdForRoute, navItems, type NavItem } from "./nav.ts";
import { parseRoute, type Route } from "./router.ts";
import type { TaxDocument } from "../../shared/schemas/document.ts";

export type RenderInput = {
  pathname: string;
  /** Raw `window.location.search`, used to mark the current nav child (`?tab=needs-review`). */
  search?: string;
  /** Markup produced by the page module the registry resolved for this route. */
  body: string;
  inboxUnreadCount?: number;
  paletteIndex?: PaletteIndex;
};

export function renderApp(input: RenderInput): string {
  const route = parseRoute(input.pathname);

  if (route.page === "portal") {
    return renderChromeless(input.body);
  }

  return `<div class="app" data-app-shell="true">
    ${renderSidebar(route, `${input.pathname}${input.search ?? ""}`, input.inboxUnreadCount ?? 0)}
    <div class="workspace">
      ${input.body}
    </div>
    ${renderCommandPalette(input.paletteIndex ?? emptyPaletteIndex)}
  </div>`;
}

/** The client portal is not part of the firm's workspace: no sidebar, no palette, no nav. */
function renderChromeless(body: string): string {
  return `<div class="app app-chromeless" data-app-shell="portal">
    <div class="workspace workspace-portal">
      ${body}
    </div>
  </div>`;
}

function renderSidebar(route: Route, currentHref: string, inboxUnreadCount: number): string {
  const navId = navIdForRoute(route);
  const main = navItems.filter((item) => item.section === "main");
  const footer = navItems.filter((item) => item.section === "footer");
  const renderItem = (item: NavItem) => renderNavItem(item, navId, currentHref, inboxUnreadCount);

  return `<aside class="sidebar">
    <div class="sidebar-head">
      <a class="brand" href="/" data-nav-link>
        <img class="brand-mark" src="${brandMarkSrc}" alt="" width="20" height="20" />
        <span class="brand-name">Tax Docs</span>
      </a>
      <button class="icon-btn" type="button" data-collapse-nav aria-expanded="true" aria-label="Collapse navigation">${icons.collapse}</button>
    </div>
    <button class="nav-search" type="button" data-open-search>
      ${icons.search}
      <span>Search</span>
      <span class="nav-search-keys"><kbd>Ctrl</kbd><kbd>K</kbd></span>
    </button>
    <nav class="nav" aria-label="Product">
      ${main.map(renderItem).join("")}
    </nav>
    <div class="sidebar-foot">
      ${footer.map(renderItem).join("")}
    </div>
  </aside>`;
}

function renderNavItem(
  item: NavItem,
  navId: string | null,
  currentHref: string,
  inboxUnreadCount: number,
): string {
  const current = item.id === navId;
  const expanded = Boolean(item.children) && current;
  const groupClass = current ? "nav-group is-active" : "nav-group";
  const children = item.children ?? [];
  const matchedChild = children.findIndex((child) => child.href === currentHref);
  const currentChild = matchedChild === -1 ? 0 : matchedChild;

  return `<div data-nav-group="${item.id}" class="${groupClass}">
    <a class="nav-item" href="${item.href}" data-nav-link ${current ? 'aria-current="page"' : ""}>
      <span class="nav-icon">${icons[item.icon]}</span>
      <span class="nav-label">${escapeHtml(item.label)}</span>
      ${item.badge === "inbox-unread" ? renderInboxBadge(inboxUnreadCount) : ""}
    </a>
    ${
      expanded
        ? `<div class="nav-children">${children
            .map((child, index) => {
              const childClass = index === currentChild ? "nav-child is-current" : "nav-child";
              return `<a data-nav-child="${child.id}" class="${childClass}" href="${child.href}" data-nav-link><span class="nav-icon-spacer" aria-hidden="true"></span><span class="nav-label">${escapeHtml(child.label)}</span></a>`;
            })
            .join("")}</div>`
        : ""
    }
  </div>`;
}

function renderInboxBadge(count: number): string {
  return count > 0
    ? `<span class="badge" data-inbox-badge>${count}</span>`
    : `<span class="badge" data-inbox-badge hidden></span>`;
}

/**
 * The loading state is furniture, not the word "loading" — the shell is already on screen and the
 * skeleton keeps the layout from jumping when real rows land.
 */
export function renderPageSkeleton(): string {
  return `<div class="page-skeleton" data-page-loading aria-busy="true">
    <span class="skeleton-bar skeleton-bar-title"></span>
    <span class="skeleton-bar skeleton-bar-wide"></span>
    <span class="skeleton-bar skeleton-bar-row"></span>
    <span class="skeleton-bar skeleton-bar-row"></span>
    <span class="skeleton-bar skeleton-bar-row"></span>
  </div>`;
}

/** The real cause, verbatim. A generic apology would hide the only useful information. */
export function renderLoadError(message: string): string {
  return `<div class="load-error" data-load-error>
    <h1 class="page-title">This page could not load</h1>
    <p class="load-error-message">${escapeHtml(message)}</p>
    <button class="btn-secondary" type="button" data-retry>Try again</button>
  </div>`;
}

export function renderNotFound(): string {
  return `<div class="empty-page">
    <h1 class="page-title">Page not found</h1>
    <p class="muted">That route is not part of the product yet.</p>
    <a class="text-link" href="/" data-nav-link>Back to home${icons.arrow}</a>
  </div>`;
}

export type PageAction = {
  href: string;
  label: string;
  kind: "primary" | "secondary";
};

export function pageHeader(title: string, count?: string, actions: PageAction[] = []): string {
  return `<header class="page-header">
    <div>
      <h1 class="page-title">${escapeHtml(title)}${count ? ` <span class="count">${escapeHtml(count)}</span>` : ""}</h1>
    </div>
    <div class="page-actions">
      <button class="icon-btn" type="button" aria-label="More actions">${icons.dots}</button>
      ${actions
        .map((action) => {
          const cls = action.kind === "primary" ? "btn-primary" : "btn-secondary";
          return `<a class="${cls}" href="${action.href}" ${action.href.startsWith("/") ? "data-nav-link" : ""}>${escapeHtml(action.label)}</a>`;
        })
        .join("")}
    </div>
  </header>`;
}

export function tabs(items: { label: string; count?: number; current: boolean; href?: string }[]): string {
  return `<div class="tabs" role="tablist">
    ${items
      .map((item) => {
        const label = `${escapeHtml(item.label)}${item.count !== undefined ? ` <span class="count">${item.count}</span>` : ""}`;
        const cls = `tab${item.current ? " is-active" : ""}`;
        if (item.href) {
          return `<a class="${cls}" role="tab" href="${item.href}" data-nav-link aria-selected="${item.current ? "true" : "false"}">${label}</a>`;
        }
        return `<button class="${cls}" type="button" role="tab" aria-selected="${item.current ? "true" : "false"}">${label}</button>`;
      })
      .join("")}
  </div>`;
}

export function toolbar(placeholder: string): string {
  return `<div class="toolbar">
    <label class="search-field">
      ${icons.search}
      <input type="search" placeholder="${escapeHtml(placeholder)}" />
    </label>
    <button class="btn-ghost" type="button">${icons.filter} Add filter</button>
    <div class="toolbar-end">
      <button class="icon-btn" type="button" aria-label="Export">${icons.download}</button>
    </div>
  </div>`;
}

export function dataTable(headers: string[], rows: string[], footer: string): string {
  return `<div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
    <div class="table-foot">
      <span class="muted">${escapeHtml(footer)}</span>
    </div>
  </div>`;
}

export function entityCell(initials: string, title: string, detail: string): string {
  return `<div class="entity">
    <span class="avatar">${escapeHtml(initials)}</span>
    <span>
      <span class="list-row-title">${escapeHtml(title)}</span>
      <span class="muted">${escapeHtml(detail)}</span>
    </span>
  </div>`;
}

export function listRow(opts: {
  href: string;
  initials?: string;
  title: string;
  meta: string;
  trailing?: string;
}): string {
  return `<a class="list-row" href="${opts.href}" data-nav-link>
    ${opts.initials ? `<span class="avatar">${escapeHtml(opts.initials)}</span>` : `<span class="avatar-spacer" aria-hidden="true"></span>`}
    <span class="list-row-body">
      <span class="list-row-title">${escapeHtml(opts.title)}</span>
      <span class="muted">${escapeHtml(opts.meta)}</span>
    </span>
    ${opts.trailing ?? ""}
  </a>`;
}

export function railWidget(title: string, detail: string, href: string): string {
  return `<a class="rail-widget" href="${href}" data-nav-link>
    <span class="section-title">${escapeHtml(title)}</span>
    <span class="muted">${escapeHtml(detail)}</span>
  </a>`;
}

export function emptyState(message: string): string {
  return `<div class="wash-card empty-state">
    <p class="muted">${escapeHtml(message)}</p>
  </div>`;
}

type PipelineStatus = TaxDocument["pipelineStatus"];

const pipelineLabels: Record<PipelineStatus, string> = {
  received: "Received",
  "quality-review": "Quality review",
  classifying: "Classifying",
  extracting: "Extracting",
  "needs-review": "Needs review",
  unclassified: "Unclassified",
  trusted: "Trusted",
  rejected: "Rejected",
  failed: "Failed",
};

/** Semantic tones only — the highlighter is reserved for actions and live counts. */
const pipelineTones: Record<PipelineStatus, "processing" | "warning" | "success" | "halted"> = {
  received: "processing",
  "quality-review": "processing",
  classifying: "processing",
  extracting: "processing",
  "needs-review": "warning",
  unclassified: "warning",
  trusted: "success",
  rejected: "halted",
  failed: "halted",
};

export function pipelineChip(status: PipelineStatus): string {
  return `<span class="chip chip-${pipelineTones[status]}">${escapeHtml(pipelineLabels[status])}</span>`;
}

export function initialsFor(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return "—";
  }

  const first = words[0] as string;
  const second = words[1];

  return `${first[0] ?? ""}${second?.[0] ?? ""}`.toUpperCase() || "—";
}

function renderCommandPalette(index: PaletteIndex): string {
  return `<div class="palette" hidden data-command-palette>
    <div class="palette-panel" role="dialog" aria-modal="true" aria-label="Search Tax Docs">
      <div class="palette-header">
        <label class="palette-field">
          <span class="palette-label">Search Tax Docs</span>
          <input
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            placeholder="Where do you want to go?"
            data-command-input
            autocomplete="off"
          />
          <span class="palette-search-icon">${icons.searchLg}</span>
        </label>
      </div>
      ${renderPaletteResults(searchPalette("", index), 0)}
    </div>
  </div>`;
}

export function renderPaletteResults(groups: PaletteGroup[], activeIndex: number): string {
  if (groups.length === 0) {
    return `<div class="palette-results" id="palette-list" role="listbox" data-palette-results>
      <p class="muted palette-empty">No matching pages or documents</p>
    </div>`;
  }

  let index = -1;
  const items = flattenPalette(groups);
  const safeIndex = Math.min(Math.max(activeIndex, 0), items.length - 1);

  return `<div class="palette-results" id="palette-list" role="listbox" data-palette-results>
    ${groups
      .map(
        (entry) => `<div class="palette-group" role="group" aria-label="${escapeHtml(entry.id)}">
          <div class="palette-group-label">${escapeHtml(entry.id)}</div>
          ${entry.items
            .map((item) => {
              index += 1;
              const active = index === safeIndex;
              return `<a
                class="palette-item${active ? " is-active" : ""}"
                href="${item.href}"
                role="option"
                id="palette-item-${index}"
                data-nav-link
                data-palette-index="${String(index)}"
                ${active ? 'data-palette-active="true" aria-selected="true"' : 'aria-selected="false"'}
              >
                <span class="palette-item-icon">${paletteIcons[item.icon]}</span>
                <span class="palette-item-label">${escapeHtml(item.label)}</span>
              </a>`;
            })
            .join("")}
        </div>`,
      )
      .join("")}
  </div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
