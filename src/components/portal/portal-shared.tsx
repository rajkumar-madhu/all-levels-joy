import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { getPortal, postPortalReply, submitPortalTicket } from "@/lib/portal.functions";
import { formatDateTime, priorityLabel } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type PortalData = Awaited<ReturnType<typeof getPortal>>;
export type PortalAllowedData = Exclude<PortalData, { allowed: false }>;

export const portalQueryKey = ["portal"] as const;

export function usePortal() {
  return useQuery({ queryKey: portalQueryKey, queryFn: () => getPortal() });
}

export type PortalItem = {
  id: string;
  number: string;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  kind: "incident" | "request";
  due: string | null;
  waiting: boolean;
} & Record<string, unknown>;

export function portalItems(d: PortalAllowedData): PortalItem[] {
  return [
    ...d.incidents.map((i) => ({
      ...i,
      kind: "incident" as const,
      due: i.sla_due_at,
      waiting: i.state === "pending" && i.on_hold_reason === "awaiting_caller",
    })),
    ...d.requests.map((r) => ({
      ...r,
      kind: "request" as const,
      due: r.due_at,
      waiting: Boolean(r.awaiting_customer_since),
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const OPEN_STATES = ["new", "open", "in_progress", "pending"];

export function PortalGate({ children }: { children: (d: PortalAllowedData) => React.ReactNode }) {
  const query = usePortal();
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (query.isError)
    return <p className="text-sm text-destructive">Your portal could not be loaded. Try again shortly.</p>;
  if (query.data.allowed === false) return <NotAllowed />;
  return <>{children(query.data as PortalAllowedData)}</>;
}

export function NotAllowed() {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h1 className="text-lg font-semibold text-foreground">Please use your @wecrew.in email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The support portal is available to confirmed @wecrew.in accounts only. Sign out and sign in with your
        company email, then confirm it from the link we send you.
      </p>
    </div>
  );
}

export function PortalSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6">
      <h1 className="text-xl font-semibold text-foreground">
        {mode === "signin" ? "Sign in to the service desk" : "Create a support account"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Track tickets and requests, find help articles and order services.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          if (mode === "signup") {
            const { error } = await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${window.location.origin}/portal` },
            });
            setBusy(false);
            if (error) toast.error(error.message);
            else toast.success("Check your email to confirm your account, then sign in.");
            return;
          }
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          setBusy(false);
          if (error) toast.error(error.message);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="p-email">Email</Label>
          <Input id="p-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-pass">Password</Label>
          <Input id="p-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
        <button
          type="button"
          className="w-full text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={async () => {
            const r = await lovable.auth.signInWithOAuth("google", {
              redirect_uri: `${window.location.origin}/portal`,
            });
            if (r && "error" in r && r.error) toast.error(String(r.error));
          }}
        >
          Continue with Google
        </Button>
      </form>
    </div>
  );
}

export function TicketDetail({ ticket, data }: { ticket: PortalItem; data: PortalAllowedData }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const reply = useMutation({
    mutationFn: () => postPortalReply({ data: { recordType: ticket.kind, recordId: ticket.id, body } }),
    onSuccess: async (result) => {
      setBody("");
      const outcome = result?.outcome;
      if (outcome === "reopened") toast.success("Reply sent. It has been reopened.");
      else if (outcome === "resumed") toast.success("Reply sent. Support is working on it again.");
      else if (outcome === "closed")
        toast.info("Reply saved. This is closed — please open a new one if you still need help.");
      else toast.success("Reply sent.");
      await queryClient.invalidateQueries({ queryKey: portalQueryKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reply was not sent."),
  });
  const problem = data.problems.find((p) => p.id === ticket["problem_id"]);
  const timeline = [
    ...data.comments
      .filter((c) => c.record_id === ticket.id)
      .map((c) => ({ id: c.id, at: c.created_at, who: c.mine ? "You" : "Support team", body: c.body })),
    ...(data.outageUpdates ?? [])
      .filter((u) => u.incident_id === ticket.id)
      .map((u) => ({ id: u.id, at: u.created_at, who: "Outage update", body: u.body })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="space-y-4 border-t border-border p-4 text-sm">
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Field label="Opened" value={formatDateTime(ticket.created_at)} />
        <Field label="Last update" value={formatDateTime(ticket.updated_at)} />
        <Field label="Target date" value={formatDateTime(ticket.due)} />
        {ticket.kind === "incident" ? (
          <Field label="Priority" value={priorityLabel(ticket["priority"] as number | null)} />
        ) : (
          <Field label="Approval" value={String(ticket["approval_status"]).replace(/_/g, " ")} />
        )}
      </dl>
      {ticket.waiting ? (
        <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm font-medium text-foreground">
          We need your reply — send an update below so we can keep working on this.
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-foreground">{ticket.description}</p>
      {ticket["resolution_notes"] ? (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="text-xs font-semibold text-muted-foreground">Resolution</p>
          <p className="mt-1 whitespace-pre-wrap">{String(ticket["resolution_notes"])}</p>
        </div>
      ) : null}
      {problem ? (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="text-xs font-semibold text-muted-foreground">Linked known problem · {problem.number}</p>
          <p className="mt-1 font-medium">{problem.title}</p>
          {problem.workaround ? <p className="mt-1 whitespace-pre-wrap">Workaround: {problem.workaround}</p> : null}
        </div>
      ) : null}
      <div>
        <p className="text-xs font-semibold text-muted-foreground">Updates</p>
        {timeline.length === 0 ? (
          <p className="mt-1 text-muted-foreground">No updates yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {timeline.map((e) => (
              <li key={e.id} className="rounded-md bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">
                  {e.who} · {formatDateTime(e.at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{e.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) reply.mutate();
        }}
      >
        <Label htmlFor={`reply-${ticket.id}`}>Reply to support</Label>
        <Textarea id={`reply-${ticket.id}`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <Button size="sm" type="submit" disabled={reply.isPending || !body.trim()}>
          Send reply
        </Button>
      </form>
    </div>
  );
}

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 capitalize text-foreground">{value}</dd>
    </div>
  );
}

export const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function NewTicket({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [impact, setImpact] = useState(3);
  const [urgency, setUrgency] = useState(3);
  const submit = useMutation({
    mutationFn: () =>
      submitPortalTicket({ data: { title, description, impact, urgency, category: (category || null) as never } }),
    onSuccess: async (t) => {
      toast.success(`Ticket ${t.number} submitted.`);
      await qc.invalidateQueries({ queryKey: portalQueryKey });
      onCreated(t.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The ticket was not submitted."),
  });
  return (
    <form
      className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <h2 className="text-lg font-semibold text-foreground sm:col-span-3">Report an issue</h2>
      <div className="space-y-1.5">
        <Label htmlFor="nt-cat">Area</Label>
        <select id="nt-cat" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Not sure</option>
          <option value="network">Network / VPN / Wi-Fi</option>
          <option value="hardware">Hardware</option>
          <option value="software">Software / apps</option>
          <option value="database">Data / reports</option>
          <option value="inquiry">Question</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nt-imp">Who is affected</Label>
        <select id="nt-imp" className={selectClass} value={impact} onChange={(e) => setImpact(Number(e.target.value))}>
          <option value={3}>Just me</option>
          <option value={2}>My team</option>
          <option value={1}>Many people</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nt-urg">How urgent</Label>
        <select id="nt-urg" className={selectClass} value={urgency} onChange={(e) => setUrgency(Number(e.target.value))}>
          <option value={3}>Can wait</option>
          <option value={2}>Slowing me down</option>
          <option value={1}>Can't work</option>
        </select>
      </div>
      <div className="space-y-1.5 sm:col-span-3">
        <Label htmlFor="nt-title">Summary</Label>
        <Input id="nt-title" required minLength={5} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5 sm:col-span-3">
        <Label htmlFor="nt-desc">Details</Label>
        <Textarea id="nt-desc" rows={4} required minLength={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? "Submitting…" : "Submit ticket"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ItemList({
  items,
  data,
  open,
  onToggle,
  empty,
}: {
  items: PortalItem[];
  data: PortalAllowedData;
  open: string | undefined;
  onToggle: (id: string | undefined) => void;
  empty: string;
}) {
  if (items.length === 0)
    return (
      <p className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  return (
    <ul className="mt-4 space-y-3">
      {items.map((t) => (
        <li key={t.id} className="rounded-lg border border-border bg-card">
          <button
            type="button"
            className="flex w-full flex-wrap items-center gap-3 p-4 text-left"
            aria-expanded={open === t.id}
            onClick={() => onToggle(open === t.id ? undefined : t.id)}
          >
            <span className="font-mono text-xs text-muted-foreground">{t.number}</span>
            <span className="min-w-0 flex-1 font-medium text-foreground">{t.title}</span>
            {t.waiting ? (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-foreground">
                Needs your reply
              </span>
            ) : null}
            <StateLabel state={t.state} />
          </button>
          {open === t.id ? <TicketDetail ticket={t} data={data} /> : null}
        </li>
      ))}
    </ul>
  );
}

function StateLabel({ state }: { state: string }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">
      {state.replace(/_/g, " ")}
    </span>
  );
}
