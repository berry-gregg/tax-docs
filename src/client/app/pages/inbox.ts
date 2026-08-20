import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  inboxThreadsResponseSchema,
  type InboxThread,
  type InboxThreadItem,
} from "../../../shared/schemas/inbox.ts";
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
  threads: InboxThread[];
  now: Date;
};

/**
 * Which threads are expanded. Module-level so the 2s full-repaint polling re-renders the same
 * disclosure state; the toggle handler mutates it and patches the live DOM in place.
 */
export const openThreadIds = new Set<string>();

/** Attention first, then fresh arrivals, then what is still owed; waived is closed business. */
const itemOrder: Record<InboxThreadItem["status"], number> = {
  "needs-attention": 0,
  received: 1,
  open: 2,
  waived: 3,
};

/** The shared `.chip` recipe — status is never highlighter, labels are sentence case. */
const itemChips: Record<InboxThreadItem["status"], string> = {
  open: `<span class="chip chip-processing">Open</span>`,
  received: `<span class="chip chip-success">Received</span>`,
  "needs-attention": `<span class="chip chip-warning">Needs attention</span>`,
  waived: `<span class="chip chip-processing">Waived</span>`,
};

function itemPhrase(item: InboxThreadItem): string {
  switch (item.status) {
    case "received":
      return item.documentFilename ? `Received · ${item.documentFilename}` : "Received";
    case "needs-attention":
      return item.documentFilename
        ? `Needs attention · ${item.documentFilename}`
        : "Needs attention";
    case "waived":
      // A note only exists when the client waived from the portal; CPA waives carry none.
      return item.waiveNote ? `Waived by client — ${item.waiveNote}` : "Waived";
    case "open":
      return "Waiting on client";
  }
}

function relativeTime(iso: string, now: Date, extraClass: string): string {
  return `<time class="muted ${extraClass}" datetime="${escapeHtml(iso)}">${escapeHtml(
    formatRelativeTime(iso, now),
  )}</time>`;
}

function renderThreadItem(item: InboxThreadItem, now: Date): string {
  const inner = `${itemChips[item.status]}
    <span class="inbox-item-title">${escapeHtml(item.title)}</span>
    <span class="muted inbox-item-phrase">${escapeHtml(itemPhrase(item))}</span>
    ${relativeTime(item.lastUpdateAt, now, "inbox-item-time")}`;

  if (item.documentId) {
    return `<a class="inbox-item-row" href="/documents/${escapeHtml(item.documentId)}" data-nav-link>${inner}</a>`;
  }

  return `<div class="inbox-item-row">${inner}</div>`;
}

function threadSummary(thread: InboxThread, now: Date): string {
  const received = thread.items.filter((item) => item.status === "received").length;
  const sent = formatRelativeTime(thread.requestSentAt, now);
  return `Request sent ${sent} · ${received} of ${thread.items.length} items received`;
}

function renderThread(thread: InboxThread, now: Date): string {
  const open = openThreadIds.has(thread.engagementId);
  const items = [...thread.items].sort(
    (a, b) => itemOrder[a.status] - itemOrder[b.status] || (a.lastUpdateAt < b.lastUpdateAt ? 1 : -1),
  );

  return `<section class="inbox-thread${open ? " is-open" : ""}" data-thread data-engagement-id="${escapeHtml(thread.engagementId)}">
    <div class="inbox-thread-head${thread.unread ? " is-unread" : ""}" data-thread-toggle data-engagement-id="${escapeHtml(thread.engagementId)}" role="button" tabindex="0" aria-expanded="${open ? "true" : "false"}"${thread.unread ? ' data-unread="true"' : ""}>
      <span class="unread-dot" aria-hidden="true"></span>
      <span class="inbox-thread-title">
        <span class="inbox-thread-client">${escapeHtml(thread.clientName)}</span>
        <span class="muted">${escapeHtml(thread.engagementLabel)}</span>
      </span>
      <span class="muted inbox-thread-summary">${escapeHtml(threadSummary(thread, now))}</span>
      ${portalLinkControl(`/portal/${thread.portalToken}`)}
      <span class="inbox-thread-chevron" aria-hidden="true">${icons.chevron}</span>
    </div>
    <div class="inbox-thread-body" data-thread-body${open ? "" : " hidden"}>
      ${
        items.length === 0
          ? `<p class="muted inbox-thread-empty">No items on this request yet.</p>`
          : `<div class="inbox-thread-items">${items.map((item) => renderThreadItem(item, now)).join("")}</div>`
      }
      ${
        thread.sentToEngineAt
          ? `<div class="muted inbox-thread-foot">Sent to tax engine ${escapeHtml(
              formatRelativeTime(thread.sentToEngineAt, now),
            )}</div>`
          : ""
      }
    </div>
  </section>`;
}

export function renderInbox(data: InboxData): string {
  const unreadThreads = data.threads.filter((thread) => thread.unread).length;

  return `<div class="page-inbox">
    ${pageHeader("Inbox", unreadThreads > 0 ? String(unreadThreads) : undefined)}
    ${
      data.threads.length === 0
        ? `<p class="muted">No document requests yet. Send a checklist from an engagement and its thread will appear here.</p>`
        : `<div class="inbox-threads">${data.threads
            .map((thread) => renderThread(thread, data.now))
            .join("")}</div>`
    }
  </div>`;
}

function closestToggle(value: EventTarget | null): HTMLElement | null {
  if (typeof value !== "object" || value === null || !("closest" in value)) {
    return null;
  }

  const closest = (value as { closest: unknown }).closest;
  if (typeof closest !== "function") {
    return null;
  }

  // Clicks on the portal control (or any nested link/button) keep their own behavior.
  if (closest.call(value, "a,button")) {
    return null;
  }

  return closest.call(value, "[data-thread-toggle]") as HTMLElement | null;
}

function toggleThread(head: HTMLElement): void {
  const engagementId = head.getAttribute("data-engagement-id");
  const section = head.closest("[data-thread]");
  const body = section?.querySelector<HTMLElement>("[data-thread-body]");
  if (!engagementId || !section || !body) {
    return;
  }

  const nowOpen = !openThreadIds.has(engagementId);
  if (nowOpen) {
    openThreadIds.add(engagementId);
  } else {
    openThreadIds.delete(engagementId);
  }

  // Patch the live DOM instead of repainting: the next poll re-renders from openThreadIds.
  head.setAttribute("aria-expanded", nowOpen ? "true" : "false");
  section.classList.toggle("is-open", nowOpen);
  body.hidden = !nowOpen;

  if (nowOpen && head.getAttribute("data-unread") === "true") {
    // Best-effort: the badge and dots clear on the next poll tick even if this fails.
    void sendJson("POST", `/api/inbox/threads/${engagementId}/read`, null, z.null()).catch(() => {});
  }
}

/**
 * One delegated listener on the workspace node — poll swaps replace the node, so handlers never
 * stack. Enter/Space mirror click because the head is a div acting as a disclosure button.
 */
function bindThreadToggles(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    const head = closestToggle(event.target);
    if (head) {
      toggleThread(head);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const head = closestToggle(event.target);
    if (head) {
      event.preventDefault();
      toggleThread(head);
    }
  });
}

export const inboxPage: PageModule<InboxData> = {
  async load() {
    const { threads } = await getJson("/api/inbox", inboxThreadsResponseSchema);
    return { threads, now: new Date() };
  },
  render: renderInbox,
  bind(root) {
    bindPortalLinkControls(root);
    bindThreadToggles(root);
  },
  pollMs: POLL_INTERVAL_MS,
};
