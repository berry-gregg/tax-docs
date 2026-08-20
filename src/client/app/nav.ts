import type { Route } from "./router.ts";

export type NavChild = {
  id: string;
  label: string;
  href: string;
};

/** The only live badge source in the sidebar. Value comes from `/api/inbox/unread-count`. */
export type NavBadge = "inbox-unread";

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
    href: "/documents",
    icon: "documents",
    section: "main",
    children: [
      { id: "documents-all", label: "All", href: "/documents" },
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
 * Which sidebar group owns a route. Engagement detail, review, and export are all reached from
 * Engagements, so they keep that group current instead of dropping the highlight.
 */
export function navIdForRoute(route: Route): string | null {
  switch (route.page) {
    case "home":
    case "inbox":
    case "documents":
    case "clients":
    case "settings":
      return route.page;
    case "engagements":
    case "engagement":
    case "review":
    case "export":
      return "engagements";
    case "client":
      return "clients";
    case "portal":
    case "not-found":
      return null;
  }
}
