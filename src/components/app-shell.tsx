import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  BadgeCheck,
  Bell,
  BookOpen,
  Boxes,
  Bug,
  ShieldAlert,
  Building2,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  Siren,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  ScrollText,
  Settings,
  UserCircle,
} from "lucide-react";
import { Gauge } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { bootstrapWorkspace, getWorkspace, markNotificationsRead } from "@/lib/itsm.functions";
import { workspaceQuery, type Workspace } from "@/lib/workspace-queries";
import { ROLE_LABELS, canManage, formatDateTime, type AppRole } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { GlobalSearch } from "@/components/global-search";
import { cn } from "@/lib/utils";

const navigationGroups = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, requiresManage: false },
      {
        to: "/incident-insights",
        label: "Incident insights",
        icon: BarChart3,
        requiresManage: false,
      },
      { to: "/assistant", label: "Support assistant", icon: MessageSquare, requiresManage: false },
    ],
  },
  {
    label: "ITSM",
    items: [
      { to: "/incidents", label: "Incidents", icon: AlertTriangle, requiresManage: false },
      { to: "/requests", label: "Service requests", icon: ClipboardList, requiresManage: false },
      { to: "/catalog", label: "Service catalogue", icon: Boxes, requiresManage: false },
      { to: "/problems", label: "Problems", icon: Bug, requiresManage: true },
      { to: "/changes", label: "Changes", icon: GitBranch, requiresManage: false },
      { to: "/command-center", label: "Major incident command", icon: Siren, requiresManage: true },
      { to: "/sla", label: "SLA performance", icon: Gauge, requiresManage: false },
    ],
  },
  {
    label: "Governance and knowledge",
    items: [
      { to: "/approvals", label: "Approvals", icon: BadgeCheck, requiresManage: false },
      { to: "/security", label: "Security findings", icon: ShieldAlert, requiresManage: true },
      { to: "/knowledge", label: "Knowledge", icon: BookOpen, requiresManage: false },
      { to: "/assets", label: "Assets & CMDB", icon: Boxes, requiresManage: true },
      { to: "/audit", label: "Audit trail", icon: ScrollText, requiresManage: true },
      {
        to: "/integrations",
        label: "Integrations",
        icon: Plug,
        requiresManage: false,
        requiresAdmin: true,
      },
      {
        to: "/administration",
        label: "Administration",
        icon: Settings,
        requiresManage: false,
        requiresAdmin: true,
      },
    ],
  },
] as const;

export function useWorkspace() {
  const queryClient = useQueryClient();
  return useQuery({
    ...workspaceQuery(),
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Please sign in to open the workspace.");
      // Share successful bootstrap within the signed-in query cache. Rejections
      // propagate to callers; a manual refetch can retry a failed bootstrap.
      await queryClient.fetchQuery({
        queryKey: ["workspace-bootstrap"],
        queryFn: () => bootstrapWorkspace({ data: {} }),
        staleTime: Infinity,
        retry: false,
      });
      return getWorkspace();
    },
    retry: false,
  });
}

function WorkspaceNavigation({
  workspace,
  pathname,
  onNavigate,
  onSignOut,
  signingOut,
}: {
  workspace: Workspace | undefined;
  pathname: string;
  onNavigate: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const roles = (workspace?.roles ?? []) as AppRole[];
  const manager = canManage(roles);
  const roleNames = [...roles]
    .sort((first, second) => Number(second === "admin") - Number(first === "admin"))
    .map((role) => ROLE_LABELS[role]);
  const displayName = workspace?.profile?.display_name;
  const initials = displayName
    ?.trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <>
      <div className="px-5 pb-5 pt-6">
        <Link
          to="/dashboard"
          onClick={onNavigate}
          className="inline-flex items-center gap-3 rounded-md focus-visible:outline-sidebar-ring"
          aria-label="Argus Service Desk dashboard"
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand font-serif text-lg font-semibold text-white"
            aria-hidden
          >
            W
          </span>
          <span>
            <span className="block text-base font-semibold tracking-tight text-white">
              Argus Service Desk
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/70">
              Service management
            </span>
          </span>
        </Link>
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-sidebar-border bg-white/[0.025] px-3 py-3">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-foreground/70" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/65">
              Workspace
            </p>
            <p className="mt-1 break-words text-xs font-medium leading-relaxed text-sidebar-foreground">
              {workspace?.organization?.name ?? "Loading workspace…"}
            </p>
          </div>
        </div>
      </div>
      <nav
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-5"
        aria-label="Main navigation"
      >
        {navigationGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/65">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items
                .filter(
                  (item) =>
                    (!item.requiresManage || manager) &&
                    (!("requiresAdmin" in item) || roles.includes("admin")),
                )
                .map((item) => {
                  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors focus-visible:outline-sidebar-ring",
                          active
                            ? "bg-sidebar-accent font-semibold text-white before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
                            : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <item.icon
                          className={cn("h-4 w-4 shrink-0", active && "text-sidebar-ring")}
                          aria-hidden
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <Link
          to="/profile"
          onClick={onNavigate}
          aria-current={pathname === "/profile" ? "page" : undefined}
          className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/5 focus-visible:outline-sidebar-ring"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-xs font-semibold text-sidebar-foreground"
            aria-hidden
          >
            {initials || <UserCircle className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-sidebar-foreground">
              {displayName ?? "My profile"}
            </span>
            <span
              className="mt-0.5 block truncate text-[11px] text-sidebar-foreground/65"
              title={roleNames.join(", ")}
            >
              {workspace
                ? roleNames.length > 0
                  ? `${roleNames[0]}${roleNames.length > 1 ? ` · +${roleNames.length - 1} ${roleNames.length === 2 ? "role" : "roles"}` : ""}`
                  : "No roles assigned"
                : "Loading profile…"}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/65" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="mt-1 flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-xs text-sidebar-foreground/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-sidebar-ring disabled:cursor-wait disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );
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
  // Observe the existing query without starting another bootstrap or hiding failures
  // behind an empty dashboard on routes that do not render their own error panel.
  const workspaceState = useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryState<Workspace, Error>(["workspace"]),
    () => undefined,
  );
  const [open, setOpen] = useState(false);
  const notifications = workspace?.notifications ?? [];
  const unread = notifications.filter((item) => !item.read_at).length;
  const currentPage =
    navigationGroups
      .map((group) =>
        group.items.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)),
      )
      .find((item) => item !== undefined)?.label ??
    (pathname === "/profile" ? "My profile" : "Workspace");

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const readAll = useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  });
  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({ to: "/auth", replace: true });
    },
    onError: (error) => toast.error(error.message || "Unable to sign out. Please try again."),
  });
  const navigation = (
    <WorkspaceNavigation
      workspace={workspace}
      pathname={pathname}
      onNavigate={() => setOpen(false)}
      onSignOut={() => signOut.mutate()}
      signingOut={signOut.isPending}
    />
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="min-h-screen bg-background lg:grid lg:h-dvh lg:grid-cols-[256px_minmax(0,1fr)] lg:overflow-hidden">
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:translate-y-0"
        >
          Skip to main content
        </a>
        <aside className="sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          {navigation}
        </aside>
        <SheetContent
          side="left"
          className="flex w-[min(288px,88vw)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate Argus Service Desk and access your profile.
          </SheetDescription>
          {navigation}
        </SheetContent>
        <div className="flex min-w-0 flex-col lg:h-dvh lg:overflow-y-auto">
          <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:gap-5 sm:px-6 lg:px-8">
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <div className="hidden min-w-0 shrink-0 items-center gap-2 text-xs text-muted-foreground xl:flex">
              <span>Workspace</span>
              <ChevronRight className="h-3 w-3" aria-hidden />
              <span className="max-w-44 truncate font-medium text-foreground">{currentPage}</span>
            </div>
            <div className="min-w-0 flex-1 xl:ml-auto xl:max-w-md">
              <GlobalSearch />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative shrink-0"
                  disabled={!workspace}
                  aria-label={
                    unread > 0
                      ? `Notifications, ${unread} unread among recent notifications`
                      : "Notifications"
                  }
                >
                  <Bell aria-hidden />
                  {unread > 0 ? (
                    <span
                      className="absolute right-0.5 top-0 flex min-h-4 min-w-4 items-center justify-center rounded-full border-2 border-card bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground"
                      aria-hidden
                    >
                      {unread}
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(380px,calc(100vw-2rem))] p-0"
                aria-label="Recent notifications"
              >
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">Recent notifications</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Latest updates for your account
                  </p>
                </div>
                {notifications.length > 0 ? (
                  <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                    {notifications.map((notification) => (
                      <li
                        key={notification.id}
                        className={cn("px-4 py-3", !notification.read_at && "bg-primary/[0.035]")}
                      >
                        <p className="flex items-start gap-2 text-sm font-medium">
                          {!notification.read_at ? (
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary">
                              <span className="sr-only">Unread: </span>
                            </span>
                          ) : null}
                          {notification.title}
                        </p>
                        {notification.body ? (
                          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                            {notification.body}
                          </p>
                        ) : null}
                        <time
                          dateTime={notification.created_at}
                          className="mt-2 block text-[11px] text-muted-foreground"
                        >
                          {formatDateTime(notification.created_at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No notifications yet.
                  </p>
                )}
                <div className="border-t border-border p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => readAll.mutate()}
                    disabled={unread === 0 || readAll.isPending}
                  >
                    <CheckCheck aria-hidden />
                    {readAll.isPending ? "Marking notifications…" : "Mark all read"}
                  </Button>
                  {readAll.isError ? (
                    <p role="alert" className="px-2 pb-2 text-xs text-destructive">
                      Unable to update notifications. Please try again.
                    </p>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
            <Link
              to="/profile"
              aria-label="Open my profile"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
            >
              <UserCircle className="h-5 w-5" aria-hidden />
            </Link>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 py-4 focus:outline-none sm:px-6 lg:px-8"
          >
            {workspaceState?.status === "error" ? (
              <div
                role="alert"
                className="mx-auto mt-8 max-w-xl rounded-xl border border-border bg-card p-6"
              >
                <h1 className="text-xl font-semibold">Workspace access unavailable</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {workspaceState.error?.message}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your account must have an active membership assigned by a workspace administrator.
                </p>
                <div className="mt-5 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void queryClient.invalidateQueries({ queryKey: ["workspace-bootstrap"] });
                      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
                    }}
                  >
                    Retry access
                  </Button>
                  <Button variant="ghost" onClick={() => signOut.mutate()}>
                    Sign out
                  </Button>
                </div>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </Sheet>
  );
}

export function WorkspaceLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading workspace data…</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          aria-hidden="true"
          className="h-24 animate-pulse rounded-lg border border-border bg-card p-5 motion-reduce:animate-none"
        >
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="mt-3 h-3 w-2/3 max-w-sm rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
