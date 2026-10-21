import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/AppShell";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { ApprovalsPage } from "@/pages/ApprovalsPage";
import { ArticlePage } from "@/pages/ArticlePage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { ChangeDetailPage } from "@/pages/ChangeDetailPage";
import { ChangesPage } from "@/pages/ChangesPage";
import { CommandCenterPage } from "@/pages/CommandCenterPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { IncidentDetailPage } from "@/pages/IncidentDetailPage";
import { IncidentsPage } from "@/pages/IncidentsPage";
import { KnowledgePage } from "@/pages/KnowledgePage";
import { NewChangePage } from "@/pages/NewChangePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RequestDetailPage } from "@/pages/RequestDetailPage";
import { RequestsPage } from "@/pages/RequestsPage";
import { SecurityPage } from "@/pages/SecurityPage";

// `handle.title` feeds the header breadcrumb; it matches the sidebar label for each page.
export const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallbackPage /> },
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
          { path: "approvals", element: <ApprovalsPage />, handle: { title: "Approvals" } },
          { path: "catalog", element: <CatalogPage />, handle: { title: "Service catalogue" } },
          { path: "knowledge", element: <KnowledgePage />, handle: { title: "Knowledge" } },
          { path: "knowledge/:articleId", element: <ArticlePage />, handle: { title: "Knowledge" } },
          { path: "security", element: <SecurityPage />, handle: { title: "Security findings" } },
          { path: "*", element: <NotFoundPage />, handle: { title: "Not found" } },
        ],
      },
    ],
  },
]);
