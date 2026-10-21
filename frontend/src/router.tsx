import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/AppShell";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { ArticlePage } from "@/pages/ArticlePage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { IncidentDetailPage } from "@/pages/IncidentDetailPage";
import { IncidentsPage } from "@/pages/IncidentsPage";
import { KnowledgePage } from "@/pages/KnowledgePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
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
          { path: "knowledge", element: <KnowledgePage />, handle: { title: "Knowledge base" } },
          { path: "knowledge/:articleId", element: <ArticlePage />, handle: { title: "Knowledge base" } },
          { path: "security", element: <SecurityPage />, handle: { title: "Security findings" } },
          { path: "*", element: <NotFoundPage />, handle: { title: "Not found" } },
        ],
      },
    ],
  },
]);
