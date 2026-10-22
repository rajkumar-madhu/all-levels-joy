import { clsx } from "clsx";
import { Check, Copy, Eye, EyeOff, LogOut, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { revealPassword, useAccessAction, useAccessRequests, useDecideAccess, type AccessRequest, type AccessStatus } from "@/api/pam";
import { Badge, Button, FormError, PageHeader, Panel, StateMessage, Textarea, type Tone } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize, relativeTime } from "@/lib/format";
import { ENVIRONMENT_LABELS, countdown, durationLabel, isActive } from "@/lib/pam";
import { PAM_CUSTODIAN_ROLES, hasAnyRole } from "@/lib/roles";

const STATUS_TONES: Record<AccessStatus, Tone> = {
  pending: "warn",
  approved: "good",
  rejected: "bad",
  cancelled: "muted",
  checked_in: "muted",
  expired: "muted",
};
// A revealed password is cleared from the page after this long, or when the window closes.
const REVEAL_SECONDS = 60;

type Tab = "mine" | "approvals" | "all";

export function PamAccessPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const custodian = hasAnyRole(workspace.roles, PAM_CUSTODIAN_ROLES);
  const tabs: { value: Tab; label: string }[] = [
    { value: "mine", label: "My access" },
    ...(custodian ? [{ value: "approvals" as const, label: "To approve" }, { value: "all" as const, label: "All requests" }] : []),
  ];
  const tab = tabs.find((t) => t.value === params.get("tab"))?.value ?? "mine";
  const requests = useAccessRequests(workspace.id, tab, workspace.is_staff);

  if (!workspace.is_staff) return <StateMessage kind="error">Privileged access is available to workspace staff only.</StateMessage>;

  return (
    <>
      <PageHeader
        eyebrow="Privileged access"
        title="Access requests"
        description="Time-boxed access to vaulted passwords. Every reveal is recorded, and access ends when the window closes or you check in."
        actions={<Link className="text-sm text-primary hover:underline" to="/pam/secrets">Browse secrets</Link>}
      />
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Requests" className="flex w-fit flex-wrap gap-1 rounded-md border border-input bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setParams(t.value === "mine" ? {} : { tab: t.value }, { replace: true })}
              className="rounded px-3 py-1.5 text-sm aria-selected:bg-primary aria-selected:text-primary-foreground"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {requests.isPending ? (
        <StateMessage kind="loading">Loading requests…</StateMessage>
      ) : requests.isError ? (
        <StateMessage kind="error">{requests.error.message}</StateMessage>
      ) : requests.data.results.length === 0 ? (
        <StateMessage kind="empty">
          {tab === "approvals" ? "Nothing waiting for a decision." : tab === "mine" ? "You have not requested access yet. Pick a secret in the vault to start." : "No requests yet."}
        </StateMessage>
      ) : (
        <div className="grid gap-4">
          {requests.data.results.map((r) => (
            <RequestCard key={r.id} orgId={workspace.id} request={r} mode={tab} />
          ))}
        </div>
      )}
    </>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function RequestCard({ orgId, request, mode }: { orgId: string; request: AccessRequest; mode: Tab }) {
  const active = isActive(request);
  const now = useNow(active);
  const live = isActive(request, now);
  const action = useAccessAction(orgId);
  return (
    <Panel className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="font-medium text-primary hover:underline" to={`/pam/secrets?secret=${request.secret_id}`}>{request.secret_name}</Link>
          <Badge tone={STATUS_TONES[request.status]}>{humanize(request.status)}</Badge>
          <Badge tone="neutral">{ENVIRONMENT_LABELS[request.secret_environment]}</Badge>
          {request.ticket_reference && <Badge tone="info" mono>{request.ticket_reference}</Badge>}
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{request.secret_host}</p>
        <p className="mt-2 text-sm break-words">{request.reason}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {mode !== "mine" && <>{request.requester_name ?? "Unknown"} · </>}
          {durationLabel(request.duration_minutes)} requested {relativeTime(request.created_at)}
          {request.approver_name && request.decided_at && (
            <> · {request.status === "rejected" ? "rejected" : "approved"} by {request.approver_name} {relativeTime(request.decided_at)}</>
          )}
          {request.reveal_count > 0 && <> · revealed {request.reveal_count}×</>}
        </p>
        {request.decision_notes && <p className="mt-1 text-xs text-muted-foreground italic">“{request.decision_notes}”</p>}
        {mode === "mine" && live && <RevealBox orgId={orgId} request={request} now={now} />}
      </div>
      <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-end">
        {live && (
          <p className="text-sm tabular-nums" aria-live="off">
            <span className="text-muted-foreground">Ends in </span>
            <span className="font-semibold">{countdown(request.expires_at, now)}</span>
          </p>
        )}
        {request.status === "approved" && !live && request.expires_at && <p className="text-xs text-muted-foreground">Ended {formatDateTime(request.expires_at)}</p>}
        {mode === "approvals" && request.status === "pending" && <DecisionForm orgId={orgId} request={request} />}
        {mode !== "approvals" && live && (
          <Button variant="secondary" busy={action.isPending} onClick={() => action.mutate({ id: request.id, action: "check-in" })}>
            <LogOut className="size-4" /> Check in
          </Button>
        )}
        {mode === "mine" && request.status === "pending" && (
          <Button variant="secondary" busy={action.isPending} onClick={() => action.mutate({ id: request.id, action: "cancel" })}>
            <X className="size-4" /> Cancel request
          </Button>
        )}
        <FormError error={action.error} />
      </div>
    </Panel>
  );
}

function RevealBox({ orgId, request, now }: { orgId: string; request: AccessRequest; now: number }) {
  const [secret, setSecret] = useState<{ value: string; until: number } | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (secret && now >= secret.until) {
      setSecret(null);
      setShown(false);
    }
  }, [now, secret]);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await revealPassword(orgId, request.id);
      const until = Math.min(Date.now() + REVEAL_SECONDS * 1000, new Date(result.expires_at).getTime());
      setSecret({ value: result.password, until });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!secret) return;
    await navigator.clipboard.writeText(secret.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3 rounded-md border border-border bg-muted p-3">
      {secret ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className={clsx("min-w-0 rounded bg-card px-2 py-1 font-mono text-sm break-all", !shown && "tracking-widest")}>
            {shown ? secret.value : "•".repeat(Math.min(secret.value.length, 24))}
          </code>
          <Button variant="secondary" className="h-8" onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide password" : "Show password"}>
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
          <Button variant="secondary" className="h-8" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
          </Button>
          <span className="text-xs text-muted-foreground">Cleared from this page in {Math.min(REVEAL_SECONDS, Math.max(0, Math.ceil((secret.until - now) / 1000)))}s</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button busy={busy} onClick={() => void reveal()}>
            <Eye className="size-4" /> Reveal password
          </Button>
          <span className="text-xs text-muted-foreground">Each reveal is recorded against your name.</span>
        </div>
      )}
      <FormError error={error} />
    </div>
  );
}

function DecisionForm({ orgId, request }: { orgId: string; request: AccessRequest }) {
  const decide = useDecideAccess(orgId);
  const [notes, setNotes] = useState("");
  return (
    <div className="grid w-full gap-2 md:w-72">
      <label className="sr-only" htmlFor={`notes-${request.id}`}>Decision notes</label>
      <Textarea id={`notes-${request.id}`} rows={2} maxLength={1000} placeholder="Notes (required to reject)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <Button busy={decide.isPending && decide.variables?.decision === "approve"} onClick={() => decide.mutate({ id: request.id, decision: "approve", notes })}>
          <Check className="size-4" /> Approve
        </Button>
        <Button
          variant="danger"
          disabled={!notes.trim()}
          busy={decide.isPending && decide.variables?.decision === "reject"}
          onClick={() => decide.mutate({ id: request.id, decision: "reject", notes })}
        >
          <X className="size-4" /> Reject
        </Button>
      </div>
      <FormError error={decide.error} />
    </div>
  );
}
