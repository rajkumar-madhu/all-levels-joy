import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { completeSignIn } from "@/auth/oidc";
import { StateMessage } from "@/components/ui";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeSignIn()
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Sign-in failed."));
  }, [navigate]);

  return error ? (
    <StateMessage kind="error">Sign-in did not finish: {error}. Close this tab and sign in again.</StateMessage>
  ) : (
    <StateMessage kind="loading">Finishing sign-in…</StateMessage>
  );
}
