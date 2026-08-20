import { greetingFor } from "./greeting.ts";
import { brandMarkSrc } from "./brand.ts";
import { flattenPalette, searchPalette, type PaletteGroup } from "./command-palette.ts";
import { icons, paletteIcons } from "./icons.ts";
import { navItems, type NavItem } from "./nav.ts";
import { pageForPath, type PageId } from "./router.ts";
import { clients, documents, inboxItems, reviewQueue } from "./fixtures.ts";
import type { DocumentRow } from "../../shared/schemas/shell.ts";

export type RenderInput = {
  pathname: string;
  now?: Date;
};

export function renderApp(input: RenderInput): string {
  const page = pageForPath(input.pathname);
  const now = input.now ?? new Date();

  return `<div class="app" data-app-shell="true">
    ${renderSidebar(page)}
    <div class="workspace">
      ${renderPage(page, now)}
    </div>
    ${renderCommandPalette()}
  </div>`;
}

function renderPage(page: PageId | "not-found", now: Date): string {
  switch (page) {
    case "home":
      return renderHome(now);
    case "inbox":
      return renderInbox();
    case "documents":
      return renderDocuments();
    case "review":
      return renderReview();
    case "clients":
      return renderClients();
    case "settings":
      return renderSettings();
    case "not-found":
      return renderNotFound();
  }
}

function renderSidebar(page: PageId | "not-found"): string {
  const main = navItems.filter((item) => item.section === "main");
  const footer = navItems.filter((item) => item.section === "footer");

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
      ${main.map((item) => renderNavItem(item, page)).join("")}
    </nav>
    <div class="sidebar-foot">
      ${footer.map((item) => renderNavItem(item, page)).join("")}
    </div>
  </aside>`;
}

function renderNavItem(item: NavItem, page: PageId | "not-found"): string {
  const current = item.id === page;
  const expanded = Boolean(item.children) && current;
  const groupClass = current ? "nav-group is-active" : "nav-group";

  return `<div data-nav-group="${item.id}" class="${groupClass}">
    <a class="nav-item" href="${item.href}" data-nav-link ${current ? 'aria-current="page"' : ""}>
      <span class="nav-icon">${icons[item.icon]}</span>
      <span class="nav-label">${escapeHtml(item.label)}</span>
      ${item.badge ? `<span class="badge">${item.badge}</span>` : ""}
    </a>
    ${
      expanded && item.children
        ? `<div class="nav-children">${item.children
            .map((child, index) => {
              const childClass = index === 0 ? "nav-child is-current" : "nav-child";
              return `<a data-nav-child="${child.id}" class="${childClass}" href="${child.href}" data-nav-link><span class="nav-icon-spacer" aria-hidden="true"></span><span class="nav-label">${escapeHtml(child.label)}</span></a>`;
            })
            .join("")}</div>`
        : ""
    }
  </div>`;
}

function renderHome(now: Date): string {
  const greeting = greetingFor(now);
  const recent = documents;

  return `<div class="page-home">
    <div class="home-main">
      <p class="eyebrow">${escapeHtml(greeting)}</p>
      <h1 class="page-title">3 documents need review</h1>
      <div class="wash-card">
        <p class="wash-title">W-2, 1099-NEC, and K-1 packages are waiting</p>
        <p class="muted">Open review to confirm extracted fields before anything is marked trusted.</p>
      </div>
      <section class="stack">
        <h2 class="section-title">Recent documents</h2>
        <div class="row-list">
          ${recent.map((doc) => renderDocumentRow(doc)).join("")}
        </div>
        <a class="text-link" href="/documents" data-nav-link>View all documents${icons.arrow}</a>
      </section>
    </div>
    <aside class="rail">
      <a class="btn-primary btn-block" href="/documents" data-nav-link>Request documents</a>
      <button class="btn-secondary btn-block" type="button">Upload</button>
      <a class="btn-secondary btn-block" href="/review" data-nav-link>Open review</a>
      ${railWidget("Active clients", "3 engaged this week", "/clients")}
      ${railWidget("Review queue", "3 awaiting confirmation", "/review")}
      ${railWidget("Requests", "1 outstanding request", "/inbox")}
    </aside>
  </div>`;
}

function renderDocumentRow(doc: DocumentRow): string {
  return `<a class="list-row" href="/review" data-nav-link>
    <span class="avatar">${escapeHtml(doc.initials)}</span>
    <span class="list-row-body">
      <span class="list-row-title">${escapeHtml(doc.type)} · ${escapeHtml(doc.client)}</span>
      <span class="muted">${escapeHtml(doc.date)} · ${escapeHtml(doc.name)}</span>
    </span>
    <span class="status status-${doc.status}">${escapeHtml(doc.statusLabel)}</span>
  </a>`;
}

function railWidget(title: string, detail: string, href: string): string {
  return `<a class="rail-widget" href="${href}" data-nav-link>
    <span class="section-title">${escapeHtml(title)}</span>
    <span class="muted">${escapeHtml(detail)}</span>
  </a>`;
}

function renderInbox(): string {
  return `${pageHeader("Inbox", "3", [{ href: "/documents", label: "Request documents", kind: "primary" }])}
    <div class="row-list">
      ${inboxItems
        .map(
          (item) => `<a class="list-row" href="/review" data-nav-link>
            <span class="list-row-body">
              <span class="list-row-title">${escapeHtml(item.title)}</span>
              <span class="muted">${escapeHtml(item.detail)} · ${escapeHtml(item.when)}</span>
            </span>
          </a>`,
        )
        .join("")}
    </div>`;
}

function renderDocuments(): string {
  return `${pageHeader("Documents", String(documents.length), [
      { href: "#", label: "Reminders 1", kind: "secondary" },
      { href: "/documents", label: "Request documents", kind: "primary" },
    ])}
    ${tabs([
      { label: "All", count: documents.length, current: true },
      { label: "Needs review", count: 3, current: false },
      { label: "Trusted", count: 1, current: false },
    ])}
    ${toolbar("Search documents…")}
    ${dataTable(
      ["Document", "Date", "Client", "Type", "Status"],
      documents.map(
        (doc) => `<tr>
          <td>${entityCell(doc.initials, `${doc.type} · ${doc.client}`, doc.name)}</td>
          <td>${escapeHtml(doc.date)}</td>
          <td>${escapeHtml(doc.client)}<div class="muted">${escapeHtml(doc.clientMeta)}</div></td>
          <td>${escapeHtml(doc.type)}</td>
          <td><span class="status status-${doc.status}">${escapeHtml(doc.statusLabel)}</span></td>
        </tr>`,
      ),
      "1–4 of 4 documents",
    )}`;
}

function renderReview(): string {
  return `${pageHeader("Review", String(reviewQueue.length), [
      { href: "#", label: "Settings", kind: "secondary" },
      { href: "/review", label: "Export selected", kind: "primary" },
    ])}
    ${tabs([
      { label: "Needs review", count: 1, current: true },
      { label: "Ready to export", count: 1, current: false },
      { label: "Waiting for client", count: 1, current: false },
    ])}
    ${toolbar("Search the queue…")}
    ${dataTable(
      ["Document", "Date", "Client", "Category", "Extracted", "Queue"],
      reviewQueue.map(
        (row) => `<tr>
          <td>${entityCell(row.type.slice(0, 2), row.name, row.type)}</td>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.client)}<div class="muted">${escapeHtml(row.clientMeta)}</div></td>
          <td>${escapeHtml(row.category)}</td>
          <td>${escapeHtml(row.amountLabel)}</td>
          <td><span class="status status-${row.queue}">${escapeHtml(row.queueLabel)}</span></td>
        </tr>`,
      ),
      "1–3 of 3 documents",
    )}`;
}

function renderClients(): string {
  return `${pageHeader("Clients", String(clients.length), [
      { href: "#", label: "Team updates", kind: "secondary" },
      { href: "/clients", label: "Invite client", kind: "primary" },
    ])}
    ${tabs([
      { label: "All", count: clients.length, current: true },
      { label: "Entities", count: clients.length, current: false },
    ])}
    ${toolbar("Filter by…")}
    ${dataTable(
      ["Name", "Role", "Location", "Reviewer"],
      clients.map(
        (row) => `<tr>
          <td>${entityCell(row.initials, row.name, row.email)}</td>
          <td>${escapeHtml(row.role)}</td>
          <td>${escapeHtml(row.location)}</td>
          <td>${escapeHtml(row.reviewer)}</td>
        </tr>`,
      ),
      "1–3 of 3 clients",
    )}`;
}

function renderSettings(): string {
  return `${pageHeader("Company settings")}
    ${tabs([
      { label: "Company profile", current: true },
      { label: "Security", current: false },
    ])}
    <section class="settings-block">
      <h2 class="section-title">Company profile</h2>
      <dl class="definition-grid">
        <div><dt>Business legal name</dt><dd>Tax Docs LLP</dd></div>
        <div><dt>Workspace</dt><dd>Local development</dd></div>
        <div><dt>API</dt><dd data-api-status data-state="loading">Checking API</dd></div>
        <div><dt>Database</dt><dd data-db-status>Unknown</dd></div>
      </dl>
      <button class="btn-secondary" type="button">Edit company profile</button>
    </section>`;
}

function renderNotFound(): string {
  return `<div class="empty-page">
    <h1 class="page-title">Page not found</h1>
    <p class="muted">That route is not part of the shell yet.</p>
    <a class="text-link" href="/" data-nav-link>Back to home${icons.arrow}</a>
  </div>`;
}

function pageHeader(
  title: string,
  count?: string,
  actions: { href: string; label: string; kind: "primary" | "secondary" }[] = [],
): string {
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

function tabs(items: { label: string; count?: number; current: boolean }[]): string {
  return `<div class="tabs" role="tablist">
    ${items
      .map(
        (item) =>
          `<button class="tab${item.current ? " is-active" : ""}" type="button" role="tab" ${item.current ? 'aria-selected="true"' : 'aria-selected="false"'}>${escapeHtml(item.label)}${item.count !== undefined ? ` <span class="count">${item.count}</span>` : ""}</button>`,
      )
      .join("")}
  </div>`;
}

function toolbar(placeholder: string): string {
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

function dataTable(headers: string[], rows: string[], footer: string): string {
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

function entityCell(initials: string, title: string, detail: string): string {
  return `<div class="entity">
    <span class="avatar">${escapeHtml(initials)}</span>
    <span>
      <span class="list-row-title">${escapeHtml(title)}</span>
      <span class="muted">${escapeHtml(detail)}</span>
    </span>
  </div>`;
}

function renderCommandPalette(): string {
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
      ${renderPaletteResults(searchPalette(""), 0)}
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
