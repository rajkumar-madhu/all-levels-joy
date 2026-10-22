import type { ComponentType } from "react";
import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/AppShell";
import { RequireSignIn } from "@/components/RequireSignIn";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/** Loads a page module only when its route is first visited, so each screen ships as its own chunk. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

// `handle.title` feeds the header breadcrumb; it matches the sidebar label for each page.
export const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  // Opened before the person is a member, so it needs sign-in but not a workspace.
  { path: "/accept-invitation", element: <RequireSignIn />, children: [{ index: true, lazy: page(() => import("@/pages/AcceptInvitationPage"), "AcceptInvitationPage") }] },
  // Customer portal: its own layout; knowledge is public, tickets need sign-in but not workspace membership.
  {
    path: "/portal",
    lazy: page(() => import("@/pages/portal/PortalLayout"), "PortalLayout"),
    children: [
      { index: true, lazy: page(() => import("@/pages/portal/PortalHomePage"), "PortalHomePage") },
      { path: "knowledge/:articleId", lazy: page(() => import("@/pages/portal/PortalArticlePage"), "PortalArticlePage") },
      { path: ":recordType/:recordId", lazy: page(() => import("@/pages/portal/PortalTicketPage"), "PortalTicketPage") },
    ],
  },
  {
    element: <RequireWorkspace />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, lazy: page(() => import("@/pages/DashboardPage"), "DashboardPage"), handle: { title: "Dashboard" } },
          { path: "assistant", lazy: page(() => import("@/pages/AssistantPage"), "AssistantPage"), handle: { title: "Support assistant" } },
          { path: "assistant/:threadId", lazy: page(() => import("@/pages/AssistantPage"), "AssistantPage"), handle: { title: "Support assistant" } },
          { path: "incidents", lazy: page(() => import("@/pages/IncidentsPage"), "IncidentsPage"), handle: { title: "Incidents" } },
          { path: "incidents/:incidentId", lazy: page(() => import("@/pages/IncidentDetailPage"), "IncidentDetailPage"), handle: { title: "Incidents" } },
          { path: "requests", lazy: page(() => import("@/pages/RequestsPage"), "RequestsPage"), handle: { title: "Service requests" } },
          { path: "requests/:requestId", lazy: page(() => import("@/pages/RequestDetailPage"), "RequestDetailPage"), handle: { title: "Service requests" } },
          { path: "changes", lazy: page(() => import("@/pages/ChangesPage"), "ChangesPage"), handle: { title: "Changes" } },
          { path: "changes/new", lazy: page(() => import("@/pages/NewChangePage"), "NewChangePage"), handle: { title: "Changes" } },
          { path: "changes/:changeId", lazy: page(() => import("@/pages/ChangeDetailPage"), "ChangeDetailPage"), handle: { title: "Changes" } },
          { path: "command-center", lazy: page(() => import("@/pages/CommandCenterPage"), "CommandCenterPage"), handle: { title: "Major incident command" } },
          { path: "sla", lazy: page(() => import("@/pages/SlaPage"), "SlaPage"), handle: { title: "SLA performance" } },
          { path: "incident-insights", lazy: page(() => import("@/pages/IncidentInsightsPage"), "IncidentInsightsPage"), handle: { title: "Incident insights" } },
          { path: "approvals", lazy: page(() => import("@/pages/ApprovalsPage"), "ApprovalsPage"), handle: { title: "Approvals" } },
          { path: "assets", lazy: page(() => import("@/pages/AssetsPage"), "AssetsPage"), handle: { title: "Assets & CMDB" } },
          { path: "catalog", lazy: page(() => import("@/pages/CatalogPage"), "CatalogPage"), handle: { title: "Service catalogue" } },
          { path: "knowledge", lazy: page(() => import("@/pages/KnowledgePage"), "KnowledgePage"), handle: { title: "Knowledge" } },
          { path: "knowledge/:articleId", lazy: page(() => import("@/pages/ArticlePage"), "ArticlePage"), handle: { title: "Knowledge" } },
          { path: "knowledge/new", lazy: page(() => import("@/pages/ArticleEditorPage"), "ArticleEditorPage"), handle: { title: "Knowledge" } },
          { path: "knowledge/:articleId/edit", lazy: page(() => import("@/pages/ArticleEditorPage"), "ArticleEditorPage"), handle: { title: "Knowledge" } },
          { path: "knowledge/categories", lazy: page(() => import("@/pages/KnowledgeCategoriesPage"), "KnowledgeCategoriesPage"), handle: { title: "Knowledge" } },
          { path: "problems", lazy: page(() => import("@/pages/ProblemsPage"), "ProblemsPage"), handle: { title: "Problems" } },
          { path: "problems/:problemId", lazy: page(() => import("@/pages/ProblemDetailPage"), "ProblemDetailPage"), handle: { title: "Problems" } },
          { path: "security", lazy: page(() => import("@/pages/SecurityPage"), "SecurityPage"), handle: { title: "Security findings" } },
          { path: "pam/secrets", lazy: page(() => import("@/pages/PamSecretsPage"), "PamSecretsPage"), handle: { title: "Secrets vault" } },
          { path: "pam/access", lazy: page(() => import("@/pages/PamAccessPage"), "PamAccessPage"), handle: { title: "Access requests" } },
          { path: "audit", lazy: page(() => import("@/pages/AuditPage"), "AuditPage"), handle: { title: "Audit trail" } },
          { path: "administration", lazy: page(() => import("@/pages/AdministrationPage"), "AdministrationPage"), handle: { title: "Administration" } },
          { path: "profile", lazy: page(() => import("@/pages/ProfilePage"), "ProfilePage"), handle: { title: "Profile" } },
          { path: "integrations", lazy: page(() => import("@/pages/IntegrationsPage"), "IntegrationsPage"), handle: { title: "Integrations" } },
          { path: "*", element: <NotFoundPage />, handle: { title: "Not found" } },
        ],
      },
    ],
  },
]);
