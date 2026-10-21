/** Turns a Django REST Framework error body into one sentence a person can act on. */
export function errorMessage(body: unknown, fallback = "Something went wrong. Try again."): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record["detail"] === "string") return record["detail"];
  if (typeof record["error"] === "string") return record["error"];
  for (const value of Object.values(record)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") return first;
    if (first && typeof first === "object") return errorMessage(first, fallback);
  }
  return fallback;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
