import { clsx } from "clsx";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Boxes,
  Building2,
  ChevronRight,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldAlert,
  Siren,
  X,
} from "lucide-react";
import { useEffect, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router";
import { useActiveWorkspace, useMe } from "@/api/hooks";
import { signOut } from "@/auth/oidc";
import { ROLE_LABELS } from "@/lib/format";
import { useSession } from "@/stores/session";
import { useUi } from "@/stores/ui";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; staffOnly?: boolean };

// Same sections, labels and icons as the existing app's sidebar (src/components/app-shell.tsx), limited to
// the screens this app implements. Labels double as page titles so sidebar, breadcrumb and heading agree.
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "ITSM",
    items: [
      { to: "/incidents", label: "Incidents", icon: AlertTriangle },
      { to: "/requests", label: "Service requests", icon: ClipboardList },
      { to: "/catalog", label: "Service catalogue", icon: Boxes },
      { to: "/changes", label: "Changes", icon: GitBranch },
      { to: "/command-center", label: "Major incident command", icon: Siren, staffOnly: true },
    ],
  },
  {
    label: "Governance and knowledge",
    items: [
      { to: "/approvals", label: "Approvals", icon: BadgeCheck },
      { to: "/security", label: "Security findings", icon: ShieldAlert, staffOnly: true },
      { to: "/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: me } = useMe();
  const workspace = useActiveWorkspace();
  const setActiveOrg = useSession((s) => s.setActiveOrg);
  const email = useSession((s) => s.email);
  const name = me?.profile?.display_name ?? email ?? "Signed in";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const roles = (workspace?.roles ?? []).filter((r) => r !== "requester" || workspace?.roles.length === 1);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-6 pb-5">
        <Link to="/" onClick={onNavigate} className="inline-flex items-center gap-3 rounded-md" aria-label="Argus Service Desk dashboard">
          <span className="flex size-9 items-center justify-center rounded-md bg-brand text-lg font-semibold text-white" aria-hidden>
            W
          </span>
          <span>
            <span className="block text-base font-semibold tracking-tight text-white">Argus Service Desk</span>
            <span className="block text-[10px] font-medium tracking-[0.16em] text-sidebar-foreground/70 uppercase">Service management</span>
          </span>
        </Link>
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-sidebar-border bg-white/[0.025] px-3 py-3">
          <Building2 className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/70" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium tracking-[0.12em] text-sidebar-foreground/65 uppercase">Workspace</p>
            {me && me.workspaces.length > 1 ? (
              <select
                aria-label="Workspace"
                value={workspace?.id}
                onChange={(e) => setActiveOrg(e.target.value)}
                className="mt-1 w-full rounded border border-sidebar-border bg-sidebar text-xs font-medium text-sidebar-foreground"
              >
                {me.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-xs leading-relaxed font-medium break-words text-sidebar-foreground">{workspace?.name}</p>
            )}
          </div>
        </div>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-5">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.staffOnly || workspace?.is_staff);
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.1em] text-sidebar-foreground/65 uppercase">{group.label}</p>
              <ul className="space-y-1">
                {items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === "/"}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        clsx(
                          "relative flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
                          isActive
                            ? "bg-sidebar-accent font-semibold text-white before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
                            : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={clsx("size-4 shrink-0", isActive && "text-sidebar-ring")} />
                          <span className="truncate">{label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-xs font-semibold text-sidebar-foreground">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-sidebar-foreground">{name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-sidebar-foreground/65">
              {roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
            </span>
          </span>
        </div>
        <button
          onClick={() => void signOut()}
          className="mt-1 flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-xs text-sidebar-foreground/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut className="size-3.5" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const { sidebarOpen, toggleSidebar, closeSidebar } = useUi();
  const matches = useMatches();
  const location = useLocation();
  const title = [...matches].reverse().map((m) => (m.handle as { title?: string } | undefined)?.title).find(Boolean);

  // Close the drawer when the route changes or the viewport grows to the desktop layout.
  useEffect(closeSidebar, [location.pathname, closeSidebar]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const close = () => desktop.matches && closeSidebar();
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, [closeSidebar]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSidebar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, closeSidebar]);

  return (
    <div className="min-h-dvh bg-background lg:grid lg:h-dvh lg:grid-cols-[256px_minmax(0,1fr)] lg:overflow-hidden">
      <a
        href="#main"
        className="fixed top-4 left-4 z-[100] -translate-y-24 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        Skip to main content
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
        <Sidebar />
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Workspace navigation">
          <button className="absolute inset-0 bg-black/50" aria-label="Close menu" onClick={closeSidebar} />
          <div className="relative h-full w-[min(288px,88vw)] border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <button className="absolute top-4 right-3 text-sidebar-foreground/80 hover:text-white" onClick={closeSidebar} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={closeSidebar} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col lg:h-dvh lg:overflow-y-auto">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            className="flex size-9 items-center justify-center rounded-md border border-input bg-card lg:hidden"
            onClick={toggleSidebar}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span>Workspace</span>
            {title && (
              <>
                <ChevronRight className="size-3" aria-hidden />
                <span className="truncate font-medium text-foreground">{title}</span>
              </>
            )}
          </p>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto grid w-full max-w-[1400px] min-w-0 flex-1 content-start gap-6 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
