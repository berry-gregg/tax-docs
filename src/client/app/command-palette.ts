import type { SearchGroupId, SearchResult } from "../../shared/schemas/search.ts";
import { navItems } from "./nav.ts";

export type PaletteGroupId = "Actions" | "Pages" | SearchGroupId;

export type PaletteIcon = "inbox" | "home" | "documents" | "engagements" | "clients" | "settings" | "plus";

export type PaletteItem = {
  id: string;
  group: PaletteGroupId;
  label: string;
  href: string;
  icon: PaletteIcon;
};

export type PaletteGroup = {
  id: PaletteGroupId;
  items: PaletteItem[];
};

/** Fixed display order for the entity groups `GET /api/search` returns. */
const ENTITY_GROUP_ORDER: SearchGroupId[] = [
  "Clients",
  "Engagements",
  "Documents",
  "Document types",
];

const ENTITY_GROUP_ICON: Record<SearchGroupId, PaletteIcon> = {
  Clients: "clients",
  Engagements: "engagements",
  Documents: "documents",
  "Document types": "settings",
};

const actions: PaletteItem[] = [
  {
    id: "action-new-engagement",
    group: "Actions",
    label: "Engagements / New engagement",
    href: "/engagements?new=1",
    icon: "engagements",
  },
  {
    id: "action-review-queue",
    group: "Actions",
    label: "Documents / Open review queue",
    href: "/documents?tab=needs-review",
    icon: "documents",
  },
  {
    id: "action-new-client",
    group: "Actions",
    label: "Clients / New client",
    href: "/clients?new=1",
    icon: "clients",
  },
];

function pages(): PaletteItem[] {
  return navItems.map((item) => ({
    id: `page-${item.id}`,
    group: "Pages",
    label: item.label,
    href: item.href,
    icon: item.icon,
  }));
}

function matches(query: string, ...parts: string[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return parts.some((part) => part.toLowerCase().includes(needle));
}

function group(id: PaletteGroupId, items: PaletteItem[], query: string): PaletteGroup | undefined {
  const filtered = items.filter((item) => matches(query, item.label));
  if (filtered.length === 0) {
    return undefined;
  }

  return { id, items: filtered };
}

/**
 * Static Actions and Pages filter locally so they respond on the keystroke. Entity rows come
 * from the latest `GET /api/search` response — the server matched them on fields the label may
 * not contain (client EIN, type description), so they render as-is instead of being re-filtered.
 */
export function searchPalette(query: string, entityResults: SearchResult[] = []): PaletteGroup[] {
  const trimmed = query.trim();
  const catalog: PaletteGroup[] = [];

  const actionGroup = group("Actions", actions, trimmed);
  const pageGroup = group("Pages", pages(), trimmed);
  if (actionGroup) {
    catalog.push(actionGroup);
  }
  if (pageGroup) {
    catalog.push(pageGroup);
  }

  if (trimmed.length === 0) {
    return catalog;
  }

  for (const groupId of ENTITY_GROUP_ORDER) {
    const items = entityResults
      .filter((result) => result.group === groupId)
      .map((result) => ({
        id: `${groupId.toLowerCase().replace(/\s+/g, "-")}-${result.id}`,
        group: groupId,
        label: result.label,
        href: result.href,
        icon: ENTITY_GROUP_ICON[groupId],
      }));
    if (items.length > 0) {
      catalog.push({ id: groupId, items });
    }
  }

  return catalog;
}

export function flattenPalette(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((entry) => entry.items);
}
