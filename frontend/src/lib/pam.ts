import type { AccessRequest, DatabaseEngine, Environment, Risk, Secret, Template } from "@/api/pam";
import type { Tone } from "@/components/ui";

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  production: "Production",
  dr: "Disaster recovery",
  uat: "UAT",
  development: "Development",
};

export const TEMPLATE_LABELS: Record<Secret["template"], string> = {
  ssh: "Unix account (SSH)",
  database: "Database account",
  windows: "Windows account",
  api_key: "API key",
};

export const DATABASE_ENGINE_LABELS: Record<DatabaseEngine, string> = { postgresql: "PostgreSQL", mysql: "MySQL" };

/** The port the live rotation backend connects to for each kind of secret. */
export function defaultPort(template: Template, engine: DatabaseEngine = "postgresql"): number {
  if (template === "database") return engine === "mysql" ? 3306 : 5432;
  if (template === "windows") return 5986;
  if (template === "api_key") return 443;
  return 22;
}

export const RISK_TONES: Record<Risk, Tone> = { critical: "bad", high: "warn", medium: "info", low: "good" };

export function rotationState(secret: Pick<Secret, "rotation_enabled" | "password_changed_at" | "last_rotation_error">): { label: string; tone: Tone } {
  if (secret.last_rotation_error) return { label: "Rotation failed", tone: "bad" };
  if (secret.rotation_enabled) return { label: "Automatic", tone: "good" };
  if (!secret.password_changed_at) return { label: "Never rotated", tone: "warn" };
  return { label: "Manual", tone: "muted" };
}

export function verificationState(secret: Pick<Secret, "last_verified_at" | "last_verification_ok">): { label: string; tone: Tone } {
  if (!secret.last_verified_at) return { label: "Never", tone: "muted" };
  return secret.last_verification_ok ? { label: "Passed", tone: "good" } : { label: "Failed", tone: "bad" };
}

/** Whether the requester can reveal now: approved and inside the window. */
export function isActive(request: Pick<AccessRequest, "status" | "starts_at" | "expires_at">, now: number = Date.now()): boolean {
  if (request.status !== "approved" || !request.starts_at || !request.expires_at) return false;
  return new Date(request.starts_at).getTime() <= now && now < new Date(request.expires_at).getTime();
}

/** "1:04:09" / "12:05" until the access window closes. */
export function countdown(expiresAt: string | null, now: number = Date.now()): string {
  if (!expiresAt) return "—";
  const total = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const DURATIONS = [15, 30, 60, 120, 240, 480, 1440];

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours === 24 ? "24 hours" : `${hours} h`;
}

export const EVENT_LABELS: Record<string, string> = {
  created: "Vaulted",
  updated: "Settings changed",
  deleted: "Deleted",
  password_set: "Password replaced by hand",
  access_requested: "Access requested",
  access_approved: "Access approved",
  access_rejected: "Access rejected",
  access_cancelled: "Request cancelled",
  revealed: "Password revealed",
  checked_in: "Checked in",
  access_expired: "Access expired",
  rotated: "Rotated",
  rotation_failed: "Rotation failed",
  verified: "Verified",
  verification_failed: "Verification failed",
};
