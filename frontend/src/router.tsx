import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/AppShell";
import { RequireSignIn } from "@/components/RequireSignIn";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { AcceptInvitationPage } from "@/pages/AcceptInvitationPage";
import { AdministrationPage } from "@/pages/AdministrationPage";
import { AuditPage } from "@/pages/AuditPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { ApprovalsPage } from "@/pages/ApprovalsPage";
import { ArticleEditorPage } from "@/pages/ArticleEditorPage";
import { ArticlePage } from "@/pages/ArticlePage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { ChangeDetailPage } from "@/pages/ChangeDetailPage";
import { ChangesPage } from "@/pages/ChangesPage";
import { CommandCenterPage } from "@/pages/CommandCenterPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { IncidentDetailPage } from "@/pages/IncidentDetailPage";
import { IncidentInsightsPage } from "@/pages/IncidentInsightsPage";
import { IncidentsPage } from "@/pages/IncidentsPage";
import { KnowledgeCategoriesPage } from "@/pages/KnowledgeCategoriesPage";
import { KnowledgePage } from "@/pages/KnowledgePage";
import { NewChangePage } from "@/pages/NewChangePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProblemDetailPage } from "@/pages/ProblemDetailPage";
import { ProblemsPage } from "@/pages/ProblemsPage";
import { RequestDetailPage } from "@/pages/RequestDetailPage";
import { RequestsPage } from "@/pages/RequestsPage";
import { SecurityPage } from "@/pages/SecurityPage";
import { SlaPage } from "@/pages/SlaPage";

// `handle.title` feeds the header breadcrumb; it matches the sidebar label for each page.
export const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  // Opened before the person is a member, so it needs sign-in but not a workspace.
  { path: "/accept-invitation", element: <RequireSignIn><AcceptInvitationPage /></RequireSignIn> },
  {
    element: <RequireWorkspace />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage />, handle: { title: "Dashboard" } },
          { path: "incidents", element: <IncidentsPage />, handle: { title: "Incidents" } },
          { path: "incidents/:incidentId", element: <IncidentDetailPage />, handle: { title: "Incidents" } },
          { path: "requests", element: <RequestsPage />, handle: { title: "Service requests" } },
          { path: "requests/:requestId", element: <RequestDetailPage />, handle: { title: "Service requests" } },
          { path: "changes", element: <ChangesPage />, handle: { title: "Changes" } },
          { path: "changes/new", element: <NewChangePage />, handle: { title: "Changes" } },
          { path: "changes/:changeId", element: <ChangeDetailPage />, handle: { title: "Changes" } },
          { path: "command-center", element: <CommandCenterPage />, handle: { title: "Major incident command" } },
          { path: "sla", element: <SlaPage />, handle: { title: "SLA performance" } },
          { path: "incident-insights", element: <IncidentInsightsPage />, handle: { title: "Incident insights" } },
          { path: "approvals", element: <ApprovalsPage />, handle: { title: "Approvals" } },
          { path: "catalog", element: <CatalogPage />, handle: { title: "Service catalogue" } },
          { path: "knowledge", element: <KnowledgePage />, handle: { title: "Knowledge" } },
          { path: "knowledge/:articleId", element: <ArticlePage />, handle: { title: "Knowledge" } },
          { path: "knowledge/new", element: <ArticleEditorPage />, handle: { title: "Knowledge" } },
          { path: "knowledge/:articleId/edit", element: <ArticleEditorPage />, handle: { title: "Knowledge" } },
          { path: "knowledge/categories", element: <KnowledgeCategoriesPage />, handle: { title: "Knowledge" } },
          { path: "problems", element: <ProblemsPage />, handle: { title: "Problems" } },
          { path: "problems/:problemId", element: <ProblemDetailPage />, handle: { title: "Problems" } },
          { path: "security", element: <SecurityPage />, handle: { title: "Security findings" } },
          { path: "audit", element: <AuditPage />, handle: { title: "Audit trail" } },
          { path: "administration", element: <AdministrationPage />, handle: { title: "Administration" } },
          { path: "profile", element: <ProfilePage />, handle: { title: "Profile" } },
          { path: "*", element: <NotFoundPage />, handle: { title: "Not found" } },
        ],
      },
    ],
  },
]);
