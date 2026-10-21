import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LogOut, ShieldCheck } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { acceptInvitation, getInvitation } from "@/lib/admin.functions";
import { ROLE_LABELS, formatDateTime } from "@/lib/itsm-shared";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/accept-invitation")({
  validateSearch: z.object({ invitation: z.string().optional() }),
  head: () => ({ meta: [{ title: "Accept invitation — Argus Service Desk" }] }),
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { invitation: invitationId } = Route.useSearch();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validId = z.string().uuid().safeParse(invitationId).success;
  const invitation = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: () => getInvitation({ data: { invitationId: invitationId! } }),
    enabled: validId,
    retry: false,
    staleTime: 0,
  });
  const accept = useMutation({
    mutationFn: () => acceptInvitation({ data: { invitationId: invitationId! } }),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ queryKey: ["workspace-bootstrap"] });
      queryClient.removeQueries({ queryKey: ["workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["reference"] });
      await queryClient.invalidateQueries({ queryKey: ["invitation", invitationId] });
      await navigate({ to: "/dashboard", replace: true });
    },
  });
  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({
        to: "/auth",
        search: {
          mode: "signin",
          redirect: `/accept-invitation${invitationId ? `?invitation=${encodeURIComponent(invitationId)}` : ""}`,
        },
        replace: true,
      });
    },
  });
  const data = invitation.data;
  const busy = accept.isPending || signOut.isPending;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-mono text-sm font-semibold text-primary-foreground"
            aria-hidden
          >
            W
          </span>
          Argus Service Desk
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-secondary">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace invitation</h1>
          <p className="mt-2 break-all text-sm leading-relaxed text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {user.email ?? "your current account"}
            </span>
          </p>
          {!validId ? (
            <div role="alert" className="mt-6 space-y-2">
              <h2 className="text-sm font-semibold">Invitation link is incomplete</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open the full invitation link shared by your workspace administrator.
              </p>
            </div>
          ) : invitation.isPending ? (
            <p className="mt-6 text-sm text-muted-foreground" role="status" aria-live="polite">
              Checking your invitation…
            </p>
          ) : invitation.isError ? (
            <div role="alert" className="mt-6 space-y-3">
              <h2 className="text-sm font-semibold">Unable to open this invitation</h2>
              <p className="text-sm leading-relaxed text-destructive">{invitation.error.message}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Sign in with the invited verified email address. The link may have expired or been
                revoked; your administrator can issue a new invitation.
              </p>
              <Button
                variant="outline"
                disabled={invitation.isFetching}
                onClick={() => void invitation.refetch()}
              >
                Retry invitation
              </Button>
            </div>
          ) : data ? (
            <div className="mt-6 space-y-5">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <h2 className="break-words text-base font-semibold">{data.organization_name}</h2>
                </div>
                <dl className="mt-4 space-y-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Invited email</dt>
                    <dd className="mt-1 break-all font-medium">{data.email}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd className="mt-1 font-medium">{formatDateTime(data.expires_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Assigned roles</dt>
                    <dd className="mt-2">
                      <ul className="flex flex-wrap gap-1.5">
                        {data.roles.map((role) => (
                          <li
                            key={role}
                            className="rounded border border-border bg-secondary px-2 py-1 text-[11px]"
                          >
                            {ROLE_LABELS[role]}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </div>
              {data.status === "pending" ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Accept this invitation to join the workspace with these roles. Only the matching
                    verified email can accept.
                  </p>
                  <Button className="w-full" disabled={busy} onClick={() => accept.mutate()}>
                    {accept.isPending ? "Joining workspace…" : "Accept invitation"}
                  </Button>
                </>
              ) : data.status === "accepted" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    This invitation has already been accepted.
                  </p>
                  <Button className="w-full" asChild>
                    <Link to="/dashboard">Open workspace</Link>
                  </Button>
                </>
              ) : (
                <p
                  role="alert"
                  className="rounded-lg border border-border bg-muted/50 p-4 text-sm leading-relaxed"
                >
                  This invitation has been {data.status}. Ask your administrator for a new
                  invitation.
                </p>
              )}
            </div>
          ) : null}
          {accept.isError ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
            >
              {accept.error.message} Sign in with the invited verified email, or ask your
              administrator to check the invitation.
            </p>
          ) : null}
          {signOut.isError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {signOut.error.message}
            </p>
          ) : null}
          <div className="mt-6 border-t border-border pt-5">
            <Button
              className="w-full"
              variant="ghost"
              disabled={busy}
              onClick={() => signOut.mutate()}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {signOut.isPending ? "Signing out…" : "Sign out and use another account"}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
