const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The acceptance link an administrator shares; the same shape the legacy app produced, so old links work. */
export function invitationLink(id: string, origin: string): string {
  return `${origin}/accept-invitation?invitation=${encodeURIComponent(id)}`;
}

/** Reads the invitation id from `?invitation=` (legacy links) or `?token=`; anything else is not an invitation. */
export function invitationIdFrom(params: URLSearchParams): string | null {
  const value = (params.get("invitation") ?? params.get("token") ?? "").trim();
  return UUID.test(value) ? value.toLowerCase() : null;
}
