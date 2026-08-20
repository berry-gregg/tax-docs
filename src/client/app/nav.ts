import type { Route } from "./router.ts";

export type NavChild = {
  id: string;
  label: string;
  href: string;
};

/**
 * The two live badge sources in the sidebar: Inbox unread threads
 * (`/api/inbox/unread-count`) and the Documents review queue
 * (`needsReviewCount` from `/api/metrics`, the same count the
 * Needs review tab shows). No other tab carries a badge.
 */
export type NavBadge = "inbox-unread" | "documents-needs-review";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: "inbox" | "home" | "documents" | "engagements" | "clients" | "settings";
  section: "main" | "footer";
  badge?: NavBadge;
  children?: NavChild[];
};

export const navItems: NavItem[] = [
  {
    id: "inbox",
    label: "Inbox",
    href: "/inbox",
    icon: "inbox",
    section: "main",
    badge: "inbox-unread",
  },
  {
    id: "home",
    label: "Home",
    href: "/",
    icon: "home",
    section: "main",
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents?tab=needs-review",
    icon: "documents",
    section: "main",
    badge: "documents-needs-review",
    children: [
      { id: "documents-all", label: "All", href: "/documents?tab=all" },
      { id: "documents-needs-review", label: "Needs review", href: "/documents?tab=needs-review" },
    ],
  },
  {
    id: "engagements",
    label: "Engagements",
    href: "/engagements",
    icon: "engagements",
    section: "main",
  },
  {
    id: "clients",
    label: "Clients",
    href: "/clients",
    icon: "clients",
    section: "main",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    section: "footer",
  },
];

/**
 * Which sidebar group owns a route. Engagement detail and export are reached from Engagements,
 * so they keep that group current. Document review lives under /documents/:documentId and keeps
 * the Documents group current.
 */
export function navIdForRoute(route: Route): string | null {
  switch (route.page) {
    case "home":
    case "inbox":
    case "documents":
    case "clients":
    case "settings":
      return route.page;
    case "review":
      return "documents";
    case "engagements":
    case "engagement":
    case "export":
      return "engagements";
    case "client":
      return "clients";
    case "portal":
    case "not-found":
      return null;
  }
}
