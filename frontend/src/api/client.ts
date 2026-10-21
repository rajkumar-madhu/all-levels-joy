import { signIn } from "@/auth/oidc";
import { useSession } from "@/stores/session";
import { ApiError, errorMessage } from "./errors";

const base = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = useSession.getState().accessToken;
  const response = await fetch(`${base}/api/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (response.status === 401) {
    useSession.getState().setSignedOut();
    void signIn();
  }
  if (!response.ok) throw new ApiError(errorMessage(body), response.status);
  return body as T;
}
