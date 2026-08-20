import { z } from "zod";
import { clientSchema, type Client } from "../../../shared/schemas/client.ts";
import {
  engagementSchema,
  type Engagement,
} from "../../../shared/schemas/engagement.ts";
import { getJson } from "../api.ts";
import { bindRowLinks, dataTable, escapeHtml, pageHeader } from "../render.ts";
import type { Route } from "../router.ts";
import type { PageModule } from "./registry.ts";

const clientDetailResponseSchema = z.object({
  client: clientSchema,
  engagements: z.array(engagementSchema),
});

export type ClientDetailData = {
  client: Client;
  engagements: Engagement[];
};

const engagementStatusLabels: Record<Engagement["status"], string> = {
  draft: "Draft",
  collecting: "Collecting",
  "in-review": "In review",
  "ready-to-export": "Ready to export",
  exported: "Exported",
};

const engagementStatusTones: Record<Engagement["status"], "processing" | "warning" | "success"> = {
  draft: "processing",
  collecting: "processing",
  "in-review": "warning",
  "ready-to-export": "success",
  exported: "success",
};

function engagementStageChip(status: Engagement["status"]): string {
  return `<span class="chip chip-${engagementStatusTones[status]}">${escapeHtml(engagementStatusLabels[status])}</span>`;
}

function renderEngagementRow(engagement: Engagement): string {
  return `<tr data-href="/engagements/${escapeHtml(engagement.id)}" tabindex="0">
    <td>${escapeHtml(String(engagement.taxYear))}</td>
    <td>${escapeHtml(engagement.filingType)}</td>
    <td>${engagementStageChip(engagement.status)}</td>
  </tr>`;
}

function tableFooter(count: number): string {
  if (count === 0) {
    return "0 engagements";
  }

  return `1–${count} of ${count} engagements`;
}

export function renderClientDetail(data: ClientDetailData): string {
  const newEngagementHref = `/engagements?new=1&client=${encodeURIComponent(data.client.id)}`;

  return `${pageHeader(data.client.legalName, String(data.engagements.length), [
    { href: newEngagementHref, label: "New engagement", kind: "primary" },
  ])}
    ${dataTable(
      ["Tax year", "Filing type", "Stage"],
      data.engagements.map(renderEngagementRow),
      tableFooter(data.engagements.length),
    )}`;
}

export const clientDetailPage: PageModule<ClientDetailData> = {
  async load(route: Route) {
    if (route.page !== "client") {
      throw new Error("Client detail requires a client route");
    }

    return getJson(`/api/clients/${route.id}`, clientDetailResponseSchema);
  },
  render: renderClientDetail,
  bind(root, _data, repaint) {
    bindRowLinks(root, repaint);
  },
};
