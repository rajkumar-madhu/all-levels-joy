import { useNavigate, useSearchParams } from "react-router";
import { useAcceptInvitation, useInvitation } from "@/api/admin";
import { Badge, Button, FormError, StateMessage } from "@/components/ui";
import { formatDateTime, ROLE_LABELS } from "@/lib/format";
import { invitationIdFrom } from "@/lib/invitations";
import { useSession } from "@/stores/session";

/** Standalone page (no workspace shell): the person opening it is not a member yet. */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const invitationId = invitationIdFrom(params);
  const email = useSession((s) => s.email);
  const setActiveOrg = useSession((s) => s.setActiveOrg);
  const navigate = useNavigate();
  const invitation = useInvitation(invitationId);
  const accept = useAcceptInvitation(invitationId ?? "");

  let body;
  if (!invitationId) {
    body = <StateMessage kind="error">Open the full invitation link shared by your workspace administrator.</StateMessage>;
  } else if (invitation.isPending) {
    body = <StateMessage kind="loading">Checking your invitation…</StateMessage>;
  } else if (invitation.isError) {
    body = (
      <div className="grid gap-3">
        <StateMessage kind="error">{invitation.error.message}</StateMessage>
        <p className="text-sm text-muted-foreground">
          You are signed in as <span className="font-medium text-foreground">{email}</span>. The invitation may be for a
          different address, or it may have expired or been revoked; your administrator can issue a new one.
        </p>
      </div>
    );
  } else {
    const i = invitation.data;
    body = (
      <div className="grid gap-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Workspace</dt>
            <dd className="font-medium">{i.organization_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Invited email</dt>
            <dd>{i.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Roles</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {i.roles.map((r) => <Badge key={r}>{ROLE_LABELS[r] ?? r}</Badge>)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Expires</dt>
            <dd>{formatDateTime(i.expires_at)}</dd>
          </div>
        </dl>
        {i.status === "pending" ? (
          <>
            <FormError error={accept.error} />
            <div>
              <Button
                busy={accept.isPending}
                onClick={() =>
                  accept.mutate(undefined, {
                    onSuccess: (r) => {
                      setActiveOrg(r.organization_id);
                      navigate("/", { replace: true });
                    },
                  })
                }
              >
                Accept and join {i.organization_name}
              </Button>
            </div>
          </>
        ) : (
          <StateMessage kind="error">
            This invitation is {i.status}. Ask your workspace administrator for a new invitation if you still need access.
          </StateMessage>
        )}
      </div>
    );
  }

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-xl rounded-md border border-border bg-card p-6 shadow-xs">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Argus Service Desk</p>
        <h1 className="mt-1 mb-4 text-2xl font-semibold tracking-tight">Workspace invitation</h1>
        {body}
      </section>
    </main>
  );
}
