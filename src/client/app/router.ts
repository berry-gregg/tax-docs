export const pageIds = [
  "home",
  "inbox",
  "documents",
  "review",
  "clients",
  "settings",
] as const;

export type PageId = (typeof pageIds)[number];

const routes: Record<string, PageId> = {
  "/": "home",
  "/home": "home",
  "/inbox": "inbox",
  "/documents": "documents",
  "/review": "review",
  "/clients": "clients",
  "/settings": "settings",
};

export function pageForPath(pathname: string): PageId | "not-found" {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return routes[normalized] ?? "not-found";
}
