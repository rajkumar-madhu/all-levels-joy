import { useEffect, useRef } from "react";
import { Outlet } from "react-router";
import { api } from "@/api/client";
import { useActiveWorkspace, useMe } from "@/api/hooks";
import { signIn } from "@/auth/oidc";
import { useSession } from "@/stores/session";
import { StateMessage } from "./ui";

/** Signs the user in, then makes sure they belong to a workspace before showing any page. */
export function RequireWorkspace() {
  const status = useSession((s) => s.status);
  const me = useMe();
  const workspace = useActiveWorkspace();
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (status === "signed-out") void signIn();
  }, [status]);

  // First visit after admission: create the profile and requester role (legacy bootstrap_workspace).
  useEffect(() => {
    if (me.data && !me.data.profile && me.data.workspaces.length && !bootstrapped.current) {
      bootstrapped.current = true;
      void api("me/bootstrap", { method: "POST", body: {} }).then(() => me.refetch());
    }
  }, [me]);

  if (status !== "signed-in") return <StateMessage kind="loading">Signing you in…</StateMessage>;
  if (me.isPending) return <StateMessage kind="loading">Loading your workspace…</StateMessage>;
  if (me.isError) return <StateMessage kind="error">{me.error.message}</StateMessage>;
  if (!workspace)
    return (
      <StateMessage kind="error">
        Your account does not have active access to a workspace. Ask your workspace administrator for an invitation.
      </StateMessage>
    );
  return <Outlet />;
}
