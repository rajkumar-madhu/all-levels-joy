import { clsx } from "clsx";
import { BookOpen, CalendarClock, Inbox, LayoutDashboard, ListChecks, LogOut, Menu, ShieldAlert, ShoppingBag, Siren, X } from "lucide-react";
import type { ComponentType } from "react";
import { NavLink, Outlet, useMatches } from "react-router";
import { useActiveWorkspace, useMe } from "@/api/hooks";
import { signOut } from "@/auth/oidc";
import { useSession } from "@/stores/session";
import { useUi } from "@/stores/ui";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; staffOnly?: boolean };

// Labels here are also the page titles (route `handle.title`) so the sidebar, breadcrumb and heading agree.
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Workspace", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "ITSM",
    items: [
      { to: "/incidents", label: "Incidents", icon: Siren },
      { to: "/requests", label: "Requests", icon: Inbox },
      { to: "/changes", label: "Changes", icon: CalendarClock },
      { to: "/approvals", label: "Approvals", icon: ListChecks },
      { to: "/catalog", label: "Service catalogue", icon: ShoppingBag },
    ],
  },
  { label: "Knowledge", items: [{ to: "/knowledge", label: "Knowledge base", icon: BookOpen }] },
  { label: "Security", items: [{ to: "/security", label: "Security findings", icon: ShieldAlert, staffOnly: true }] },
];

export function AppShell() {
  const { data: me } = useMe();
  const workspace = useActiveWorkspace();
  const setActiveOrg = useSession((s) => s.setActiveOrg);
  const email = useSession((s) => s.email);
  const { sidebarOpen, toggleSidebar, closeSidebar } = useUi();
  const matches = useMatches();
  const title = [...matches].reverse().map((m) => (m.handle as { title?: string } | undefined)?.title).find(Boolean);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 w-60 border-r border-slate-200 bg-white p-4 transition-transform md:static md:translate-x-0 dark:border-slate-800 dark:bg-slate-900",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <span className="font-semibold tracking-tight">WeCrew ITSM</span>
          <button className="md:hidden" onClick={closeSidebar} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="grid gap-5" aria-label="Main">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.staffOnly || workspace?.is_staff);
            if (!items.length) return null;
            return (
              <div key={group.label} className="grid gap-1">
                <p className="px-2 text-xs font-medium tracking-wide text-slate-500 uppercase">{group.label}</p>
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    onClick={closeSidebar}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        isActive
                          ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100"
                          : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                      )
                    }
                  >
                    <Icon className="size-4" />
                    {label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button className="md:hidden" onClick={toggleSidebar} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-400">
            {workspace?.name ?? "Workspace"}
            {title && <span className="text-slate-900 dark:text-slate-100"> › {title}</span>}
          </p>
          {me && me.workspaces.length > 1 && (
            <select
              aria-label="Workspace"
              value={workspace?.id}
              onChange={(e) => setActiveOrg(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <span className="hidden text-sm text-slate-600 sm:inline dark:text-slate-400">{email}</span>
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1 text-sm text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </header>
        <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
