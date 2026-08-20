import { navItems } from "./nav.ts";
import { clients, documents } from "./fixtures.ts";

export type PaletteGroupId = "Actions" | "Pages" | "Documents" | "Clients";

export type PaletteIcon = "inbox" | "home" | "documents" | "review" | "clients" | "settings" | "plus";

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

const actions: PaletteItem[] = [
  {
    id: "action-request",
    group: "Actions",
    label: "Documents / Request documents",
    href: "/documents",
    icon: "documents",
  },
  {
    id: "action-review",
    group: "Actions",
    label: "Review / Open review",
    href: "/review",
    icon: "review",
  },
  {
    id: "action-invite",
    group: "Actions",
    label: "Clients / Invite client",
    href: "/clients",
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

function documentItems(): PaletteItem[] {
  return documents.map((doc) => ({
    id: `doc-${doc.id}`,
    group: "Documents",
    label: `${doc.type} · ${doc.client}`,
    href: "/review",
    icon: "documents",
  }));
}

function clientItems(): PaletteItem[] {
  return clients.map((client) => ({
    id: `client-${client.id}`,
    group: "Clients",
    label: client.name,
    href: "/clients",
    icon: "clients",
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

export function searchPalette(query: string): PaletteGroup[] {
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

  const documentGroup = group("Documents", documentItems(), trimmed);
  const clientGroup = group("Clients", clientItems(), trimmed);
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
