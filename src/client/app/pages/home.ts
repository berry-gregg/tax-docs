import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  documentListResponseSchema,
  metricsSchema,
  type DocumentListRow,
  type Metrics,
} from "../../../shared/schemas/api.ts";
import { getJson } from "../api.ts";
import { formatRelativeTime } from "../format.ts";
import { greetingFor } from "../greeting.ts";
import { icons } from "../icons.ts";
import {
  emptyState,
  escapeHtml,
  initialsFor,
  listRow,
  pipelineChip,
  railWidget,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

const RECENT_LIMIT = 5;
const REVIEW_QUEUE_HREF = "/documents?tab=needs-review";
const NEW_ENGAGEMENT_HREF = "/engagements?new=1";

export type HomeData = {
  metrics: Metrics;
  recent: DocumentListRow[];
  now: Date;
};

export function renderHome(data: HomeData): string {
  const { metrics } = data;
  const recent = data.recent.slice(0, RECENT_LIMIT);

  return `<div class="page-home">
    <div class="home-main">
      <p class="eyebrow">${escapeHtml(greetingFor(data.now))}</p>
      <h1 class="page-title">${metrics.needsReviewCount} documents need review</h1>
      ${renderNextStep(metrics)}
      <section class="stack">
        <h2 class="section-title">Recent documents</h2>
        ${
          recent.length === 0
            ? emptyState("No documents yet. Uploads appear here as soon as a client sends one.")
            : `<div class="row-list">${recent.map(renderRecentRow(data.now)).join("")}</div>`
        }
        <a class="text-link" href="/documents" data-nav-link>View all documents${icons.arrow}</a>
      </section>
      ${renderTicker(metrics)}
    </div>
    <aside class="rail">
      <a class="btn-primary btn-block" href="${NEW_ENGAGEMENT_HREF}" data-nav-link>New engagement</a>
      <a class="btn-secondary btn-block" href="${REVIEW_QUEUE_HREF}" data-nav-link>Open review queue</a>
      ${railWidget("Active clients", `${metrics.activeClients} with an open engagement`, "/clients")}
      ${railWidget("Review queue", `${metrics.needsReviewCount} awaiting confirmation`, REVIEW_QUEUE_HREF)}
      ${railWidget("Outstanding requests", `${metrics.outstandingRequests} still open`, "/inbox")}
    </aside>
  </div>`;
}

function renderNextStep(metrics: Metrics): string {
  if (metrics.needsReviewCount === 0) {
    return `<div class="wash-card">
      <p class="wash-title">Nothing is waiting on you</p>
      <p class="muted">New uploads move through quality review, classification, and extraction on their own.</p>
    </div>`;
  }

  return `<div class="wash-card">
    <p class="wash-title">${metrics.fieldsAwaitingReview} extracted fields still need a person</p>
    <p class="muted">Confirm each field in review before anything is marked trusted or sent to a tax engine.</p>
  </div>`;
}

function renderRecentRow(now: Date): (row: DocumentListRow) => string {
  return (row) =>
    listRow({
      href: `/engagements/${row.engagementId}/review/${row.id}`,
      initials: initialsFor(row.clientName),
      title: `${row.documentTypeName ?? "Unclassified"} · ${row.clientName}`,
      meta: `${formatRelativeTime(row.createdAt, now)} · ${row.filename}`,
      trailing: pipelineChip(row.pipelineStatus),
    });
}

function renderTicker(metrics: Metrics): string {
  const items: [string, string][] = [
    ["Documents auto-processed", String(metrics.documentsAutoProcessed)],
    ["Fields awaiting review", String(metrics.fieldsAwaitingReview)],
    ["Straight-through rate", `${metrics.straightThroughRate}%`],
  ];

  return `<section class="ticker" aria-label="Pipeline throughput">
    ${items
      .map(
        ([label, value]) => `<div class="ticker-item">
          <span class="ticker-label">${escapeHtml(label)}</span>
          <span class="ticker-value">${escapeHtml(value)}</span>
        </div>`,
      )
      .join("")}
  </section>`;
}

export const homePage: PageModule<HomeData> = {
  async load() {
    const [metrics, documents] = await Promise.all([
      getJson("/api/metrics", metricsSchema),
      getJson("/api/documents", documentListResponseSchema),
    ]);

    return { metrics, recent: documents.documents.slice(0, RECENT_LIMIT), now: new Date() };
  },
  render: renderHome,
  pollMs: POLL_INTERVAL_MS,
};
