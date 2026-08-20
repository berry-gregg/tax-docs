import { navItems } from "./nav.ts";

export type PaletteGroupId = "Actions" | "Pages" | "Documents" | "Clients";

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

/** Entities the shell has already fetched. The palette never fetches on its own keystroke. */
export type PaletteEntity = {
  id: string;
  label: string;
  href: string;
};

export type PaletteIndex = {
  documents: PaletteEntity[];
  clients: PaletteEntity[];
};

export const emptyPaletteIndex: PaletteIndex = { documents: [], clients: [] };

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

function entityItems(
  group: Extract<PaletteGroupId, "Documents" | "Clients">,
  entities: PaletteEntity[],
  icon: PaletteIcon,
): PaletteItem[] {
  return entities.map((entity) => ({
    id: `${group.toLowerCase()}-${entity.id}`,
    group,
    label: entity.label,
    href: entity.href,
    icon,
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

export function searchPalette(query: string, index: PaletteIndex = emptyPaletteIndex): PaletteGroup[] {
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

  const documentGroup = group(
    "Documents",
    entityItems("Documents", index.documents, "documents"),
    trimmed,
  );
  const clientGroup = group("Clients", entityItems("Clients", index.clients, "clients"), trimmed);
  if (documentGroup) {
    catalog.push(documentGroup);
  }
  if (clientGroup) {
    catalog.push(clientGroup);
  }

  return catalog;
}

export function flattenPalette(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((entry) => entry.items);
}
