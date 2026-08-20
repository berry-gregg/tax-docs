import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  inboxListResponseSchema,
  type InboxEntry,
} from "../../../shared/schemas/api.ts";
import { getJson, sendJson } from "../api.ts";
import { formatRelativeTime } from "../format.ts";
import { escapeHtml, listRow, pageHeader } from "../render.ts";
import type { PageModule } from "./registry.ts";

export type InboxData = {
  entries: InboxEntry[];
  now: Date;
};

const REVIEW_ACTIONS = new Set([
  "document-extracted",
  "document-rejected",
  "document-unclassified",
]);

function parseItemCount(detail: string): number | null {
  const match = detail.match(/(\d+)\s+(?:items requested|requested items)/i);
  return match ? Number(match[1]) : null;
}

function entryHref(entry: InboxEntry): string {
  if (entry.documentId && REVIEW_ACTIONS.has(entry.action)) {
    return `/engagements/${entry.engagementId}/review/${entry.documentId}`;
  }

  return `/engagements/${entry.engagementId}`;
}

function renderPortalTrailing(portalHref: string): string {
  return `<div class="portal-link-row" data-inbox-portal-controls>
    <label class="search-field portal-link-field">
      <input type="text" readonly value="${escapeHtml(portalHref)}" aria-label="Portal link" />
    </label>
    <button type="button" class="btn-secondary" data-copy-portal-link="${escapeHtml(portalHref)}">Copy portal link</button>
    <button type="button" class="btn-secondary" data-portal-open="${escapeHtml(portalHref)}">Open portal</button>
  </div>`;
}

function staticListRow(opts: Parameters<typeof listRow>[0]): string {
  return listRow(opts)
    .replace(/^<a class="list-row" href="[^"]+" data-nav-link>/, '<div class="list-row">')
    .replace(/<\/a>$/, "</div>");
}

function renderRequestSentEntry(entry: InboxEntry): string {
  const itemCount = parseItemCount(entry.detail);
  const title = itemCount === null ? "Request sent" : `Request sent · ${itemCount} items`;
  const portalHref = entry.portalToken ? `/portal/${entry.portalToken}` : "";

  return staticListRow({
    href: `/engagements/${entry.engagementId}`,
    title,
    meta: entry.clientName,
    trailing: portalHref ? renderPortalTrailing(portalHref) : undefined,
  });
}

function renderInboundEntry(entry: InboxEntry, now: Date): string {
  const href = entryHref(entry);
  const meta = `${entry.detail} · ${formatRelativeTime(entry.createdAt, now)}`;
  const unreadDot = entry.unread ? `<span class="unread-dot" aria-hidden="true"></span>` : "";
  const row = listRow({
    href,
    title: entry.clientName,
    meta,
  }).replace(
    'class="list-row"',
    `class="list-row" data-inbox-entry data-entry-id="${escapeHtml(entry.id)}"${entry.unread ? ' data-unread="true"' : ""}`,
  );

  return `<div class="inbox-entry inbox-entry-inbound">${unreadDot}${row}</div>`;
}

function renderInboxEntry(entry: InboxEntry, now: Date): string {
  if (entry.action === "request-sent") {
    return renderRequestSentEntry(entry);
  }

  return renderInboundEntry(entry, now);
}

export function renderInbox(data: InboxData): string {
  const unreadCount = data.entries.filter((entry) => entry.unread).length;

  return `<div class="page-inbox">
    ${pageHeader("Inbox", unreadCount > 0 ? String(unreadCount) : undefined)}
    ${
      data.entries.length === 0
        ? `<p class="muted">No inbox activity yet.</p>`
        : `<div class="row-list">${data.entries.map((entry) => renderInboxEntry(entry, data.now)).join("")}</div>`
    }
  </div>`;
}

function bindPortalControls(root: HTMLElement, repaint: () => void): void {
  root.querySelectorAll<HTMLElement>("[data-inbox-portal-controls]").forEach((controls) => {
    controls.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-portal-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const href = button.dataset.portalOpen;
      if (!href) {
        return;
      }

      window.history.pushState({}, "", href);
      repaint();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-copy-portal-link]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const href = button.getAttribute("data-copy-portal-link");
      if (!href) {
        return;
      }

      void navigator.clipboard?.writeText(new URL(href, window.location.origin).toString());
    });
  });
}

function bindUnreadEntries(root: HTMLElement, repaint: () => void): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-inbox-entry][data-unread="true"]').forEach((link) => {
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        const id = link.dataset.entryId;
        const href = link.getAttribute("href");
        if (!id || !href) {
          return;
        }

        void sendJson("POST", `/api/inbox/${id}/read`, null, z.null())
          .catch(() => {
            // Navigation still proceeds — marking read is best-effort on the way out.
          })
          .finally(() => {
            window.history.pushState({}, "", href);
            repaint();
          });
      },
      { capture: true },
    );
  });
}

export const inboxPage: PageModule<InboxData> = {
  async load() {
    const { entries } = await getJson("/api/inbox", inboxListResponseSchema);
    return { entries, now: new Date() };
  },
  render: renderInbox,
  bind(root, _data, repaint) {
    bindPortalControls(root, repaint);
    bindUnreadEntries(root, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
