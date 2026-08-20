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
import {
  bindPortalLinkControls,
  escapeHtml,
  initialsFor,
  pageHeader,
  pipelineChip,
  portalLinkControl,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

export type InboxData = {
  threads: InboxThread[];
  now: Date;
};

/**
 * Which conversation is open in the center pane. Module-level so the 2s full-repaint polling
 * re-renders the same selection; nothing is selected until the CPA picks a thread.
 */
export const inboxSelection: { threadId: string | null } = { threadId: null };

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

function threadLabel(thread: InboxThread): string {
  return `${thread.filingType} · ${thread.taxYear}`;
}

function renderThreadRow(thread: InboxThread, now: Date, selected: boolean): string {
  const latestAt = thread.timeline.at(-1)?.createdAt;
  const classes = [
    "inbox-row",
    selected ? "is-selected" : "",
    thread.unread ? "is-unread" : "",
  ]
    .filter((cls) => cls.length > 0)
    .join(" ");

  return `<div class="${classes}" data-thread-row data-engagement-id="${escapeHtml(thread.engagementId)}" role="button" tabindex="0"${thread.unread ? ' data-unread="true"' : ""}>
    <span class="avatar" aria-hidden="true">${escapeHtml(initialsFor(thread.clientName))}</span>
    <span class="inbox-row-body">
      <span class="inbox-row-top">
        <span class="inbox-row-name">${escapeHtml(thread.clientName)}</span>
        ${latestAt ? relativeTime(latestAt, now, "inbox-row-time") : ""}
      </span>
      <span class="inbox-row-foot">
        <span class="muted inbox-row-preview">${escapeHtml(previewFor(thread))}</span>
        ${thread.unread ? `<span class="badge inbox-row-badge">${thread.unreadCount}</span>` : ""}
      </span>
    </span>
  </div>`;
}

function renderTimelineEntry(entry: InboxTimelineEntry, thread: InboxThread, now: Date): string {
  if (entry.kind === "message") {
    const isCpa = entry.sender === "cpa";
    return `<div class="inbox-msg inbox-msg-${isCpa ? "cpa" : "client"}" data-message-id="${escapeHtml(entry.id)}">
      <span class="inbox-msg-meta"><span class="inbox-msg-sender">${escapeHtml(
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

function renderConversation(thread: InboxThread | undefined, now: Date): string {
  if (!thread) {
    return `<section class="inbox-convo">
      <div class="inbox-convo-empty">
        <p class="muted">Select a conversation</p>
      </div>
    </section>`;
  }

  return `<section class="inbox-convo" data-conversation data-engagement-id="${escapeHtml(thread.engagementId)}">
    <header class="inbox-convo-head">
      <div class="inbox-convo-title">
        <span class="inbox-convo-name">${escapeHtml(thread.clientName)}</span>
        <span class="muted inbox-convo-meta">${escapeHtml(threadLabel(thread))}</span>
      </div>
      ${portalLinkControl(`/portal/${thread.portalToken}`)}
    </header>
    <div class="inbox-messages">
      ${
        thread.timeline.length === 0
          ? `<p class="muted inbox-messages-empty">No messages on this engagement yet.</p>`
          : thread.timeline.map((entry) => renderTimelineEntry(entry, thread, now)).join("")
      }
    </div>
    ${renderCompose(thread)}
  </section>`;
}

function renderFilesPanel(thread: InboxThread | undefined, now: Date): string {
  if (!thread) {
    return `<aside class="inbox-files"></aside>`;
  }

  return `<aside class="inbox-files" data-files-panel>
    <div class="inbox-files-summary">
      <span class="inbox-files-client">${escapeHtml(thread.clientName)}</span>
      <span class="muted">${escapeHtml(threadLabel(thread))}</span>
      <a class="text-link inbox-files-portal" href="/portal/${escapeHtml(thread.portalToken)}" data-nav-link>Open portal</a>
    </div>
    <div class="inbox-files-docs">
      <span class="section-title">Documents</span>
      ${
        thread.documents.length === 0
          ? `<p class="muted inbox-files-empty">No documents yet.</p>`
          : thread.documents
              .map(
                (doc) => `<div class="inbox-doc">
        <a class="inbox-doc-name" href="/documents/${escapeHtml(doc.id)}" data-nav-link>${escapeHtml(doc.filename)}</a>
        <span class="inbox-doc-meta">
          ${pipelineChip(doc.pipelineStatus)}
          ${relativeTime(doc.createdAt, now, "inbox-doc-time")}
        </span>
      </div>`,
              )
              .join("")
      }
    </div>
  </aside>`;
}

export function renderInbox(data: InboxData): string {
  const unreadThreads = data.threads.filter((thread) => thread.unread).length;
  const selected = data.threads.find((thread) => thread.engagementId === inboxSelection.threadId);

  return `<div class="page-inbox">
    ${pageHeader("Inbox", unreadThreads > 0 ? String(unreadThreads) : undefined)}
    ${
      data.threads.length === 0
        ? `<p class="muted">No conversations yet. Create an engagement and its request message will open the thread here.</p>`
        : `<div class="inbox-shell">
      <div class="inbox-list" role="list">${data.threads
        .map((thread) => renderThreadRow(thread, data.now, thread === selected))
        .join("")}</div>
      ${renderConversation(selected, data.now)}
      ${renderFilesPanel(selected, data.now)}
    </div>`
    }
  </div>`;
}

function closestThreadRow(value: EventTarget | null): HTMLElement | null {
  if (typeof value !== "object" || value === null || !("closest" in value)) {
    return null;
  }

  const closest = (value as { closest: unknown }).closest;
  if (typeof closest !== "function") {
    return null;
  }

  // Clicks on nested links/buttons (none today, but a row may grow them) keep their behavior.
  if (closest.call(value, "a,button")) {
    return null;
  }

  return closest.call(value, "[data-thread-row]") as HTMLElement | null;
}

function selectThread(row: HTMLElement, repaint: () => void): void {
  const engagementId = row.getAttribute("data-engagement-id");
  if (!engagementId) {
    return;
  }

  inboxSelection.threadId = engagementId;

  if (row.getAttribute("data-unread") === "true") {
    // Best-effort: the badge and unread marks clear on the next poll tick even if this fails.
    void sendJson("POST", `/api/inbox/threads/${engagementId}/read`, null, z.null()).catch(() => {});
  }

  repaint();
}

/**
 * One delegated listener on the workspace node — poll swaps replace the node, so handlers never
 * stack. Enter/Space mirror click because the row is a div acting as a selection button.
 */
function bindThreadRows(root: HTMLElement, repaint: () => void): void {
  root.addEventListener("click", (event) => {
    const row = closestThreadRow(event.target);
    if (row) {
      selectThread(row, repaint);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const row = closestThreadRow(event.target);
    if (row) {
      event.preventDefault();
      selectThread(row, repaint);
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
    bindThreadRows(root, repaint);
    bindComposeForms(root, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
