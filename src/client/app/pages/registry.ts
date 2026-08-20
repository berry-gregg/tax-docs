import { renderNotFound } from "../render.ts";
import type { Route } from "../router.ts";
import { clientDetailPage } from "./client-detail.ts";
import { clientsPage } from "./clients.ts";
import { documentsPage } from "./documents.ts";
import { engagementPage } from "./engagement-workspace.ts";
import { engagementsPage } from "./engagements.ts";
import { exportPage } from "./export.ts";
import { homePage } from "./home.ts";
import { inboxPage } from "./inbox.ts";
import { portalPage } from "./portal.ts";
import { reviewPage } from "./review.ts";
import { settingsPage } from "./settings.ts";

/**
 * One page contract for the whole product: load data, render a string, optionally bind behaviour
 * and poll. `main.ts` drives it; pages never touch history or the shell.
 */
export type PageModule<T> = {
  load(route: Route): Promise<T>;
  render(data: T): string;
  bind?(root: HTMLElement, data: T, repaint: () => void): void;
  pollMs?: number;
};

const notFoundPage: PageModule<null> = {
  load: () => Promise.resolve(null),
  render: () => renderNotFound(),
};

export function moduleFor(route: Route): PageModule<unknown> {
  switch (route.page) {
    case "home":
      return homePage;
    case "inbox":
      return inboxPage;
    case "documents":
      return documentsPage;
    case "engagements":
      return engagementsPage;
    case "engagement":
      return engagementPage;
    case "review":
      return reviewPage;
    case "export":
      return exportPage;
    case "clients":
      return clientsPage;
    case "client":
      return clientDetailPage;
    case "settings":
      return settingsPage;
    case "portal":
      return portalPage;
    case "not-found":
      return notFoundPage;
  }
}
