import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { useSession } from "@/stores/session";

const origin = window.location.origin;

export const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_AUTHORITY ?? "http://localhost:8080/realms/itsm",
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID ?? "itsm-web",
  redirect_uri: `${origin}/auth/callback`,
  post_logout_redirect_uri: `${origin}/`,
  response_type: "code",
  scope: "openid profile email",
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

function apply(user: User | null) {
  const session = useSession.getState();
  if (user && !user.expired) session.setSignedIn(user.access_token, user.profile.email ?? null);
  else session.setSignedOut();
}

export async function initAuth(): Promise<void> {
  userManager.events.addUserLoaded(apply);
  userManager.events.addUserUnloaded(() => apply(null));
  userManager.events.addAccessTokenExpired(() => apply(null));
  userManager.events.addSilentRenewError(() => apply(null));
  apply(await userManager.getUser());
}

export function signIn(returnTo: string = window.location.pathname + window.location.search) {
  return userManager.signinRedirect({ state: { returnTo } });
}

export async function completeSignIn(): Promise<string> {
  const user = await userManager.signinRedirectCallback();
  apply(user);
  const state = user.state as { returnTo?: string } | undefined;
  return state?.returnTo?.startsWith("/") ? state.returnTo : "/";
}

export function signOut() {
  return userManager.signoutRedirect();
}
