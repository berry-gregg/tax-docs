export type Route =
  | { page: "home" }
  | { page: "inbox" }
  | { page: "documents" }
  | { page: "engagements" }
  | { page: "engagement"; id: string }
  | { page: "review"; documentId: string }
  | { page: "export"; engagementId: string }
  | { page: "clients" }
  | { page: "client"; id: string }
  | { page: "settings" }
  | { page: "portal"; token: string }
  | { page: "not-found" };

export type PageId = Route["page"];

const flatRoutes: Record<string, Route> = {
  "": { page: "home" },
  home: { page: "home" },
  inbox: { page: "inbox" },
  documents: { page: "documents" },
  engagements: { page: "engagements" },
  clients: { page: "clients" },
  settings: { page: "settings" },
};

const notFound: Route = { page: "not-found" };

function segments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

/**
 * Path-only routing. Query strings (`?tab=`, `?new=1`) are view state a page reads for itself —
 * putting them in the Route union would make every page module re-parse the same string.
 */
export function parseRoute(pathname: string): Route {
  const parts = segments(pathname);

  if (parts.length === 0) {
    return { page: "home" };
  }

  if (parts.length === 1) {
    return flatRoutes[parts[0] as string] ?? notFound;
  }

  const [head, second, third] = parts as [string, string, string?];

  if (head === "portal" && parts.length === 2) {
    return { page: "portal", token: second };
  }

  if (head === "clients" && parts.length === 2) {
    return { page: "client", id: second };
  }

  // Document review lives under Documents. The old /engagements/:id/review/:documentId
  // shape was retired and deliberately falls through to not-found.
  if (head === "documents" && parts.length === 2) {
    return { page: "review", documentId: second };
  }

  if (head === "engagements") {
    if (parts.length === 2) {
      return { page: "engagement", id: second };
    }
    if (parts.length === 3 && third === "export") {
      return { page: "export", engagementId: second };
    }
  }

  return notFound;
}
