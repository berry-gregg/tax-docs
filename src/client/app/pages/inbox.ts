import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  inboxMessageResponseSchema,
  inboxThreadsResponseSchema,
  type InboxThread,
  type InboxTimelineEntry,
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

/**
 * Unsent compose text keyed by engagementId. The compose form is `data-preserve-focus`, so a
 * poll never repaints while the CPA is typing — this map restores drafts when a repaint does
 * happen with focus elsewhere.
 */
export const composeDrafts = new Map<string, string>();

const PREVIEW_MAX_CHARS = 96;

function relativeTime(iso: string, now: Date, extraClass: string): string {
  return `<time class="muted ${extraClass}" datetime="${escapeHtml(iso)}">${escapeHtml(
    formatRelativeTime(iso, now),
  )}</time>`;
}

function truncate(value: string): string {
  if (value.length <= PREVIEW_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

/** Latest message wins the row preview; an event-only thread previews its latest system line. */
function previewFor(thread: InboxThread): string {
  const lastMessage = [...thread.timeline]
    .reverse()
    .find((entry): entry is Extract<InboxTimelineEntry, { kind: "message" }> => entry.kind === "message");
  if (lastMessage) {
    const prefix = lastMessage.sender === "cpa" ? "You: " : "";
    return truncate(`${prefix}${lastMessage.body}`);
  }

  const lastEvent = thread.timeline.at(-1);
  return lastEvent && lastEvent.kind === "event" ? truncate(lastEvent.text) : "No messages yet";
}

function renderTimelineEntry(entry: InboxTimelineEntry, thread: InboxThread, now: Date): string {
  if (entry.kind === "message") {
    const isCpa = entry.sender === "cpa";
    return `<div class="inbox-msg inbox-msg-${isCpa ? "cpa" : "client"}" data-message-id="${escapeHtml(entry.id)}">
      <span class="inbox-msg-meta muted"><span class="inbox-msg-sender">${escapeHtml(
        isCpa ? "You" : thread.clientName,
      )}</span> ${relativeTime(entry.createdAt, now, "inbox-msg-time")}</span>
      <p class="inbox-msg-body">${escapeHtml(entry.body)}</p>
    </div>`;
  }

  const text = entry.documentId
    ? `<a class="inbox-event-link" href="/documents/${escapeHtml(entry.documentId)}" data-nav-link>${escapeHtml(entry.text)}</a>`
    : `<span>${escapeHtml(entry.text)}</span>`;

  return `<div class="inbox-event">
    ${text}
    ${relativeTime(entry.createdAt, now, "inbox-event-time")}
  </div>`;
}

function renderCompose(thread: InboxThread): string {
  const draft = composeDrafts.get(thread.engagementId) ?? "";

  return `<form class="inbox-compose" data-preserve-focus data-compose data-engagement-id="${escapeHtml(thread.engagementId)}">
    <textarea class="inbox-compose-input" data-compose-input rows="2" placeholder="Reply to ${escapeHtml(thread.clientName)}…" aria-label="Reply to ${escapeHtml(thread.clientName)}">${escapeHtml(draft)}</textarea>
    <div class="inbox-compose-foot">
      <span class="inbox-compose-error" data-compose-error hidden></span>
      <button class="btn-primary inbox-compose-send" type="submit" data-compose-send>Send</button>
    </div>
  </form>`;
}

function renderThread(thread: InboxThread, now: Date): string {
  const open = openThreadIds.has(thread.engagementId);
  const latestAt = thread.timeline.at(-1)?.createdAt;

  return `<section class="inbox-thread${open ? " is-open" : ""}" data-thread data-engagement-id="${escapeHtml(thread.engagementId)}">
    <div class="inbox-thread-head${thread.unread ? " is-unread" : ""}" data-thread-toggle data-engagement-id="${escapeHtml(thread.engagementId)}" role="button" tabindex="0" aria-expanded="${open ? "true" : "false"}"${thread.unread ? ' data-unread="true"' : ""}>
      <span class="unread-dot" aria-hidden="true"></span>
      <span class="inbox-thread-title">
        <span class="inbox-thread-client">${escapeHtml(thread.clientName)}</span>
        <span class="muted">${escapeHtml(`${thread.filingType} · ${thread.taxYear}`)}</span>
      </span>
      <span class="muted inbox-thread-preview">${escapeHtml(previewFor(thread))}</span>
      ${latestAt ? relativeTime(latestAt, now, "inbox-thread-time") : ""}
      ${portalLinkControl(`/portal/${thread.portalToken}`)}
      <span class="inbox-thread-chevron" aria-hidden="true">${icons.chevron}</span>
    </div>
    <div class="inbox-thread-body" data-thread-body${open ? "" : " hidden"}>
      ${
        thread.timeline.length === 0
          ? `<p class="muted inbox-thread-empty">No messages on this engagement yet.</p>`
          : `<div class="inbox-conversation">${thread.timeline
              .map((entry) => renderTimelineEntry(entry, thread, now))
              .join("")}</div>`
      }
      ${renderCompose(thread)}
    </div>
  </section>`;
}

export function renderInbox(data: InboxData): string {
  const unreadThreads = data.threads.filter((thread) => thread.unread).length;

  return `<div class="page-inbox">
    ${pageHeader("Inbox", unreadThreads > 0 ? String(unreadThreads) : undefined)}
    ${
      data.threads.length === 0
        ? `<p class="muted">No conversations yet. Create an engagement and its request message will open the thread here.</p>`
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

type ComposeForm = {
  form: HTMLElement;
  engagementId: string;
  input: HTMLTextAreaElement;
  errorSlot: HTMLElement | null;
  sendButton: HTMLButtonElement | null;
};

async function submitCompose(compose: ComposeForm, repaint: () => void): Promise<void> {
  const body = compose.input.value.trim();
  if (body.length === 0) {
    return;
  }

  if (compose.sendButton) {
    compose.sendButton.disabled = true;
  }
  if (compose.errorSlot) {
    compose.errorSlot.hidden = true;
    compose.errorSlot.textContent = "";
  }

  try {
    await sendJson(
      "POST",
      `/api/inbox/threads/${compose.engagementId}/messages`,
      { body },
      inboxMessageResponseSchema,
    );
    composeDrafts.delete(compose.engagementId);
    compose.input.value = "";
    if (compose.sendButton) {
      compose.sendButton.disabled = false;
    }
    repaint();
  } catch (error) {
    // The server's own message, verbatim — a generic apology would hide the cause.
    if (compose.sendButton) {
      compose.sendButton.disabled = false;
    }
    if (compose.errorSlot) {
      compose.errorSlot.textContent = error instanceof Error ? error.message : String(error);
      compose.errorSlot.hidden = false;
    }
  }
}

/** Direct per-form binding: bind() re-runs after every repaint, so handlers never go stale. */
function bindComposeForms(root: HTMLElement, repaint: () => void): void {
  root.querySelectorAll<HTMLElement>("[data-compose]").forEach((form) => {
    const engagementId = form.getAttribute("data-engagement-id");
    const input = form.querySelector<HTMLTextAreaElement>("[data-compose-input]");
    if (!engagementId || !input) {
      return;
    }

    const compose: ComposeForm = {
      form,
      engagementId,
      input,
      errorSlot: form.querySelector<HTMLElement>("[data-compose-error]"),
      sendButton: form.querySelector<HTMLButtonElement>("[data-compose-send]"),
    };

    input.addEventListener("input", () => {
      composeDrafts.set(engagementId, input.value);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitCompose(compose, repaint);
    });
  });
}

export const inboxPage: PageModule<InboxData> = {
  async load() {
    const { threads } = await getJson("/api/inbox", inboxThreadsResponseSchema);
    return { threads, now: new Date() };
  },
  render: renderInbox,
  bind(root, _data, repaint) {
    bindPortalLinkControls(root);
    bindThreadToggles(root);
    bindComposeForms(root, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
