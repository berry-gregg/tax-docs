import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  inboxListResponseSchema,
  type InboxEntry,
} from "../../../shared/schemas/api.ts";
import { getJson, sendJson } from "../api.ts";
import { formatRelativeTime } from "../format.ts";
import { icons } from "../icons.ts";
import {
  bindPortalLinkControls,
  escapeHtml,
  pageHeader,
  portalLinkControl,
} from "../render.ts";
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

const actorLabels: Record<InboxEntry["actor"], string> = {
  agent: "Agent",
  cpa: "Firm",
  client: "Client",
};

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

/** The dot renders on every row (transparent when read) so the leading column stays aligned. */
function unreadMarker(): string {
  return `<span class="unread-dot" aria-hidden="true"></span>`;
}

function entryTime(entry: InboxEntry, now: Date): string {
  return `<time class="muted inbox-time" datetime="${escapeHtml(entry.createdAt)}">${escapeHtml(
    formatRelativeTime(entry.createdAt, now),
  )}</time>`;
}

/** Outbound request rows do not navigate; their only actions are the compact portal controls. */
function renderOutboundEntry(entry: InboxEntry, now: Date): string {
  const itemCount = parseItemCount(entry.detail);
  const title = itemCount === null ? "Request sent" : `Request sent · ${itemCount} items`;
  const portalHref = entry.portalToken ? `/portal/${entry.portalToken}` : "";

  return `<div class="list-row inbox-row inbox-row-outbound">
    ${unreadMarker()}
    <span class="inbox-direction">${icons.arrowUpRight}</span>
    <span class="inbox-row-text">
      <span class="list-row-title">${escapeHtml(title)}</span>
    </span>
    ${portalHref ? portalLinkControl(portalHref) : `<span class="inbox-row-trailing"></span>`}
    ${entryTime(entry, now)}
  </div>`;
}

function renderInboundEntry(entry: InboxEntry, now: Date): string {
  const rowClass = entry.unread ? "list-row inbox-row is-unread" : "list-row inbox-row";

  return `<a class="${rowClass}" href="${escapeHtml(entryHref(entry))}" data-nav-link data-inbox-entry data-entry-id="${escapeHtml(entry.id)}"${entry.unread ? ' data-unread="true"' : ""}>
    ${unreadMarker()}
    <span class="inbox-direction">${icons.arrowDownLeft}</span>
    <span class="inbox-row-text">
      <span class="list-row-title">${escapeHtml(actorLabels[entry.actor])}</span>
      <span class="muted">${escapeHtml(entry.detail)}</span>
    </span>
    ${entryTime(entry, now)}
  </a>`;
}

function renderInboxEntry(entry: InboxEntry, now: Date): string {
  if (entry.action === "request-sent") {
    return renderOutboundEntry(entry, now);
  }

  return renderInboundEntry(entry, now);
}

type InboxGroup = {
  engagementId: string;
  clientName: string;
  entries: InboxEntry[];
};

/** Entries arrive newest-first; groups keep first-appearance order so the freshest client leads. */
function groupEntries(entries: InboxEntry[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();

  for (const entry of entries) {
    const group = groups.get(entry.engagementId);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(entry.engagementId, {
        engagementId: entry.engagementId,
        clientName: entry.clientName,
        entries: [entry],
      });
    }
  }

  return [...groups.values()];
}

function renderGroup(group: InboxGroup, now: Date): string {
  return `<section class="inbox-group">
    <a class="inbox-group-head" href="/engagements/${escapeHtml(group.engagementId)}" data-nav-link>${escapeHtml(group.clientName)}</a>
    <div class="row-list">${group.entries.map((entry) => renderInboxEntry(entry, now)).join("")}</div>
  </section>`;
}

export function renderInbox(data: InboxData): string {
  const unreadCount = data.entries.filter((entry) => entry.unread).length;

  return `<div class="page-inbox">
    ${pageHeader("Inbox", unreadCount > 0 ? String(unreadCount) : undefined)}
    ${
      data.entries.length === 0
        ? `<p class="muted">No inbox activity yet.</p>`
        : `<div class="inbox-groups">${groupEntries(data.entries)
            .map((group) => renderGroup(group, data.now))
            .join("")}</div>`
    }
  </div>`;
}

function closestUnreadEntry(value: EventTarget | null): HTMLAnchorElement | null {
  if (typeof value !== "object" || value === null || !("closest" in value)) {
    return null;
  }

  const closest = (value as { closest: unknown }).closest;
  if (typeof closest !== "function") {
    return null;
  }

  return closest.call(value, '[data-inbox-entry][data-unread="true"]') as HTMLAnchorElement | null;
}

/**
 * One delegated capture listener on the workspace node (poll swaps replace it, so handlers never
 * stack). It runs before the shared `data-nav-link` handler, fires the best-effort mark-read
 * POST, then navigates itself so the badge refresh on the next paint sees the entry as read.
 */
function bindMarkReadOnOpen(root: HTMLElement, repaint: () => void): void {
  root.addEventListener(
    "click",
    (event) => {
      const link = closestUnreadEntry(event.target);
      if (!link) {
        return;
      }

      const id = link.getAttribute("data-entry-id");
      const href = link.getAttribute("href");
      if (!id || !href) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void sendJson("POST", `/api/inbox/${id}/read`, null, z.null())
        .catch(() => {
          // Navigation still proceeds — marking read is best-effort on the way out.
        })
        .finally(() => {
          globalThis.history.pushState({}, "", href);
          repaint();
        });
    },
    { capture: true },
  );
}

export const inboxPage: PageModule<InboxData> = {
  async load() {
    const { entries } = await getJson("/api/inbox", inboxListResponseSchema);
    return { entries, now: new Date() };
  },
  render: renderInbox,
  bind(root, _data, repaint) {
    bindPortalLinkControls(root);
    bindMarkReadOnOpen(root, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
