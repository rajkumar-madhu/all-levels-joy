import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  BadgeCheck,
  BookOpen,
  Boxes,
  Bug,
  ClipboardList,
  Siren,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScrollText,
  UserCircle,
  X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { bootstrapWorkspace, markNotificationsRead } from "@/lib/itsm.functions";
import { workspaceQuery, type Workspace } from "@/lib/workspace-queries";
import { ROLE_LABELS, canManage, type AppRole } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/global-search";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, requiresManage: false },
  { to: "/assistant", label: "Support assistant", icon: MessageSquare, requiresManage: false },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle, requiresManage: false },
  {
    to: "/incident-insights",
    label: "Incident dashboard",
    icon: BarChart3,
    requiresManage: false,
  },
  { to: "/command-center", label: "Major incident command", icon: Siren, requiresManage: true },
  { to: "/problems", label: "Problems", icon: Bug, requiresManage: false },
  { to: "/requests", label: "Service requests", icon: ClipboardList, requiresManage: false },
  { to: "/changes", label: "Changes", icon: GitBranch, requiresManage: false },
  { to: "/approvals", label: "Approvals", icon: BadgeCheck, requiresManage: false },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, requiresManage: false },
  { to: "/assets", label: "Assets & CMDB", icon: Boxes, requiresManage: false },
  { to: "/audit", label: "Audit trail", icon: ScrollText, requiresManage: true },
  { to: "/profile", label: "My profile", icon: UserCircle, requiresManage: false },
] as const;

export function useWorkspace() {
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    void bootstrapWorkspace({ data: {} })
      .catch(() => undefined)
      .finally(() => {
        if (!active) return;
        void queryClient.invalidateQueries({ queryKey: ["workspace"] });
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [queryClient]);

  const query = useQuery({ ...workspaceQuery(), enabled: ready });
  return query;
}

export function AppShell({
  workspace,
  children,
}: {
  workspace: Workspace | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);

  const roles = (workspace?.roles ?? []) as AppRole[];
  const manager = canManage(roles);
  const unread = (workspace?.notifications ?? []).filter((item) => !item.read_at).length;

  const readAll = useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  const visibleNav = nav.filter((item) => !item.requiresManage || manager);

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:static lg:flex lg:w-auto lg:translate-x-0",
          open ? "flex translate-x-0" : "hidden -translate-x-full lg:flex",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-sidebar-primary font-mono text-sm font-semibold text-sidebar-primary-foreground">
              W
            </span>
            <span className="text-sm font-semibold tracking-tight">WeCrew ITSM</span>
          </Link>
          <button
            type="button"
            className="lg:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label="Main">
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-4 py-4 text-xs">
          <p className="font-medium text-sidebar-foreground">
            {workspace?.profile?.display_name ?? "Signed in"}
          </p>
          <p className="mt-1 text-sidebar-foreground/70">
            {roles.length > 0
              ? roles.map((role) => ROLE_LABELS[role]).slice(0, 3).join(", ")
              : "No roles assigned"}
          </p>
          <button
            type="button"
            onClick={signOut}
            className="mt-3 inline-flex items-center gap-1.5 text-sidebar-foreground/80 underline underline-offset-4"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 sm:block sm:w-40 lg:w-52">
            <p className="truncate text-sm font-medium text-foreground">
              {workspace?.organization?.name ?? "Workspace"}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => readAll.mutate()}
            disabled={unread === 0 || readAll.isPending}
          >
            Notifications{unread > 0 ? ` (${unread})` : ""}
          </Button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function WorkspaceLoading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}
