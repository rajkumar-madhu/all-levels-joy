import { LogIn, LogOut } from "lucide-react";
import { Link, Outlet } from "react-router";
import { signIn, signOut } from "@/auth/oidc";
import { useSession } from "@/stores/session";

/** Requester-facing support portal: no workspace sidebar, knowledge readable without signing in. */
export function PortalLayout() {
  const status = useSession((s) => s.status);
  const email = useSession((s) => s.email);
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/portal" className="inline-flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand font-semibold text-white" aria-hidden>
              W
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">Argus Service Desk</span>
              <span className="block text-[10px] tracking-[0.16em] text-sidebar-foreground/70 uppercase">Support portal</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-xs">
            {status === "signed-in" ? (
              <>
                <span className="hidden text-sidebar-foreground/80 sm:inline">{email}</span>
                <button onClick={() => void signOut()} className="inline-flex items-center gap-1 hover:text-white">
                  <LogOut className="size-3.5" aria-hidden /> Sign out
                </button>
              </>
            ) : (
              <button onClick={() => void signIn("/portal")} className="inline-flex items-center gap-1 hover:text-white">
                <LogIn className="size-3.5" aria-hidden /> Sign in
              </button>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
