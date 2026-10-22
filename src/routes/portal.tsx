import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { getPortal, postPortalReply, submitPortalTicket } from "@/lib/portal.functions";
import { getPublicKnowledgeArticle, searchPublicKnowledge } from "@/lib/public-knowledge.functions";
import { StateBadge } from "@/components/status-badge";
import { formatDateTime, priorityLabel, type RecordState } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Customer portal — Argus Service Desk" },
      { name: "description", content: "Search help articles, track your support tickets, known problems and outage updates." },
      { property: "og:title", content: "Customer portal — Argus Service Desk" },
      { property: "og:description", content: "Check status and reply to your Argus support tickets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Portal,
});

function Portal() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="font-semibold text-foreground">Argus Service Desk</p>
          <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost"><Link to="/status">Service status</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/security">Security workspace</Link></Button>
          {signedIn ? (
            <Button size="sm" variant="ghost" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </Button>
          ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-10 px-5 py-8">
        {signedIn === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <KnowledgeSearch signedIn={signedIn} />
            {signedIn ? <Tickets /> : <PortalSignIn />}
          </>
        )}
      </main>
    </div>
  );
}

function PortalSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6">
      <h1 className="text-xl font-semibold text-foreground">
        {mode === "signin" ? "Sign in to the service desk" : "Create a support account"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Submit new tickets and track the ones you've raised.</p>
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

function KnowledgeSearch({ signedIn }: { signedIn: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useQuery({
    queryKey: ["portal-kb", query, category],
    queryFn: () =>
      searchPublicKnowledge({
        data: {
          ...(query ? { query } : {}),
          ...(category ? { category } : {}),
        },
      }),
  });
  const article = useQuery({
    queryKey: ["portal-kb-article", openId],
    queryFn: () => getPublicKnowledgeArticle({ data: { id: openId! } }),
    enabled: !!openId,
  });
  const d = search.data;

  return (
    <section aria-label="Find an answer" className="rounded-lg border border-border bg-card p-5">
      <h1 className="text-xl font-semibold text-foreground">Find an answer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Search our help articles before raising a ticket — most issues are fixed in minutes.
      </p>
      <div className="mt-4">
        <Label htmlFor="kb-search" className="sr-only">
          Search help articles
        </Label>
        <Input
          id="kb-search"
          placeholder="Search help articles — try “VPN” or “password”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {d && d.categories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={category === "" ? "default" : "outline"}
            onClick={() => setCategory("")}
          >
            All topics
          </Button>
          {d.categories.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={category === c.name ? "default" : "outline"}
              onClick={() => setCategory(category === c.name ? "" : c.name)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      ) : null}
      {search.isPending ? (
        <p className="mt-4 text-sm text-muted-foreground">Searching…</p>
      ) : search.isError ? (
        <p className="mt-4 text-sm text-destructive">Articles could not be loaded. Try again shortly.</p>
      ) : d && d.articles.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No articles match. {signedIn ? "Raise a ticket below and we'll help." : "Sign in below to raise a ticket."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {d?.articles.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-left"
                aria-expanded={openId === a.id}
                onClick={() => setOpenId(openId === a.id ? null : a.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">{a.title}</span>
                  {a.summary ? (
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">{a.summary}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{a.category}</span>
              </button>
              {openId === a.id ? (
                <div className="pb-4 pl-1 text-sm">
                  {article.isPending ? (
                    <p className="text-muted-foreground">Loading article…</p>
                  ) : article.isError || !article.data ? (
                    <p className="text-destructive">This article could not be loaded.</p>
                  ) : (
                    <p className="whitespace-pre-wrap text-foreground">{article.data.content}</p>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!signedIn ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          Still stuck? Sign in below to raise a ticket and track our reply.
        </p>
      ) : null}
    </section>
  );
}

function Tickets() {
  const query = useQuery({ queryKey: ["portal"], queryFn: () => getPortal() });
  const [open, setOpen] = useState<string | null>(null);
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading your tickets…</p>;
  if (query.isError)
    return <p className="text-sm text-destructive">Your tickets could not be loaded. Try again shortly.</p>;
  const d = query.data;
  if (d.allowed === false)
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-semibold text-foreground">Please use your @wecrew.in email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The support portal is available to confirmed @wecrew.in accounts only. Sign out and sign in with your
          company email, then confirm it from the link we send you.
        </p>
      </div>
    );
  const all = [
    ...d.incidents.map((i) => ({ ...i, kind: "incident" as const, due: i.sla_due_at })),
    ...d.requests.map((r) => ({ ...r, kind: "request" as const, due: r.due_at })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div>
      <NewTicket onCreated={(id) => setOpen(id)} />
      <h1 className="mt-8 text-2xl font-semibold text-foreground">Your tickets</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {all.length} ticket{all.length === 1 ? "" : "s"} raised by you.
      </p>
      {all.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          You have no tickets yet.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {all.map((t) => (
            <li key={t.id} className="rounded-lg border border-border bg-card">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 p-4 text-left"
                aria-expanded={open === t.id}
                onClick={() => setOpen(open === t.id ? null : t.id)}
              >
                <span className="font-mono text-xs text-muted-foreground">{t.number}</span>
                <span className="min-w-0 flex-1 font-medium text-foreground">{t.title}</span>
                <StateBadge state={t.state as RecordState} />
              </button>
              {open === t.id ? <TicketDetail ticket={t} data={d} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PortalData = Awaited<ReturnType<typeof getPortal>>;

function TicketDetail({
  ticket,
  data,
}: {
  ticket: { id: string; kind: "incident" | "request"; description: string; created_at: string; updated_at: string; due: string | null } & Record<string, unknown>;
  data: PortalData;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const reply = useMutation({
    mutationFn: () => postPortalReply({ data: { recordType: ticket.kind, recordId: ticket.id, body } }),
    onSuccess: async (result) => {
      setBody("");
      const outcome = (result as { outcome?: string } | undefined)?.outcome;
      if (outcome === "reopened") toast.success("Reply sent. Your ticket has been reopened.");
      else if (outcome === "resumed") toast.success("Reply sent. Support is working on it again.");
      else if (outcome === "closed")
        toast.info("Reply saved. This ticket is closed — please open a new ticket if you still need help.");
      else toast.success("Reply sent.");
      await queryClient.invalidateQueries({ queryKey: ["portal"] });
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
      {ticket["awaiting_customer_since"] || ticket["on_hold_reason"] === "awaiting_caller" ? (
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
          <p className="text-xs font-semibold text-muted-foreground">
            Linked known problem · {problem.number}
          </p>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 capitalize text-foreground">{value}</dd>
    </div>
  );
}

function NewTicket({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [impact, setImpact] = useState(3);
  const [urgency, setUrgency] = useState(3);
  const submit = useMutation({
    mutationFn: () =>
      submitPortalTicket({ data: { title, description, impact, urgency, category: category || null } }),
    onSuccess: async (t) => {
      toast.success(`Ticket ${t.number} submitted.`);
      setTitle("");
      setDescription("");
      setShow(false);
      await qc.invalidateQueries({ queryKey: ["portal"] });
      onCreated(t.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The ticket was not submitted."),
  });
  if (!show)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-5">
        <div>
          <p className="font-medium text-foreground">Need help?</p>
          <p className="text-sm text-muted-foreground">Tell us what's wrong and we'll open a ticket.</p>
        </div>
        <Button onClick={() => setShow(true)}>Submit a ticket</Button>
      </div>
    );
  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <form
      className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <h2 className="text-lg font-semibold text-foreground sm:col-span-3">Submit a ticket</h2>
      <div className="space-y-1.5">
        <Label htmlFor="nt-cat">Area</Label>
        <select id="nt-cat" className={sel} value={category} onChange={(e) => setCategory(e.target.value)}>
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
        <select id="nt-imp" className={sel} value={impact} onChange={(e) => setImpact(Number(e.target.value))}>
          <option value={3}>Just me</option>
          <option value={2}>My team</option>
          <option value={1}>Many people</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nt-urg">How urgent</Label>
        <select id="nt-urg" className={sel} value={urgency} onChange={(e) => setUrgency(Number(e.target.value))}>
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
        <Button type="button" variant="ghost" onClick={() => setShow(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
