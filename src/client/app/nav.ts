export type NavChild = {
  id: string;
  label: string;
  href: string;
};

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: "inbox" | "home" | "documents" | "review" | "clients" | "settings";
  section: "main" | "footer";
  badge?: number;
  children?: NavChild[];
};

export const navItems: NavItem[] = [
  {
    id: "inbox",
    label: "Inbox",
    href: "/inbox",
    icon: "inbox",
    section: "main",
    badge: 3,
  },
  {
    id: "home",
    label: "Home",
    href: "/",
    icon: "home",
    section: "main",
    children: [{ id: "overview", label: "Overview", href: "/" }],
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: "documents",
    section: "main",
    children: [
      { id: "documents-all", label: "All", href: "/documents" },
      { id: "documents-review", label: "Needs review", href: "/documents" },
    ],
  },
  {
    id: "review",
    label: "Review",
    href: "/review",
    icon: "review",
    section: "main",
    badge: 3,
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
