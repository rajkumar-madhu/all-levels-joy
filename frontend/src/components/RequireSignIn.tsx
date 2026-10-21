import { useEffect, type ReactNode } from "react";
import { signIn } from "@/auth/oidc";
import { useSession } from "@/stores/session";
import { StateMessage } from "./ui";

/** Signs the user in but, unlike RequireWorkspace, does not need a workspace (used to accept an invitation). */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  useEffect(() => {
    // signIn() remembers the current URL, so the invitation link survives the Keycloak round trip.
    if (status === "signed-out") void signIn();
  }, [status]);
  if (status !== "signed-in") return <StateMessage kind="loading">Signing you in…</StateMessage>;
  return <>{children}</>;
}
