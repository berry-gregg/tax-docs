import { FIRM_NAME } from "../../../shared/constants.ts";
import { escapeHtml, pageHeader, renderNotFound } from "../render.ts";
import type { Route } from "../router.ts";
import { homePage } from "./home.ts";

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

/**
 * Routes whose pages land in later steps still need a module, otherwise navigating to them would
 * throw inside the paint loop. Each placeholder states plainly that the page is not built.
 */
function placeholder(title: string): PageModule<null> {
  return {
    load: () => Promise.resolve(null),
    render: () =>
      `${pageHeader(title)}<p class="muted">${escapeHtml(`${title} is not built yet.`)}</p>`,
  };
}

const portalPlaceholder: PageModule<null> = {
  load: () => Promise.resolve(null),
  render: () => `<div class="empty-page">
    <h1 class="page-title">${escapeHtml(FIRM_NAME)}</h1>
    <p class="muted">This upload portal is not built yet.</p>
  </div>`,
};

const notFoundPage: PageModule<null> = {
  load: () => Promise.resolve(null),
  render: () => renderNotFound(),
};

const inboxPage = placeholder("Inbox");
const documentsPage = placeholder("Documents");
const engagementsPage = placeholder("Engagements");
const engagementPage = placeholder("Engagement");
const reviewPage = placeholder("Review");
const exportPage = placeholder("Export");
const clientsPage = placeholder("Clients");
const clientPage = placeholder("Client");
const settingsPage = placeholder("Settings");

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
      return clientPage;
    case "settings":
      return settingsPage;
    case "portal":
      return portalPlaceholder;
    case "not-found":
      return notFoundPage;
  }
}
