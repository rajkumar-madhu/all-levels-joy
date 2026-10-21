import { Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { usePortal, usePublicKnowledge, useSubmitPortalTicket } from "@/api/portal";
import { signIn } from "@/auth/oidc";
import { IncidentStateBadge } from "@/components/badges";
import { Badge, Button, Field, FormError, Input, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/format";
import { useSession } from "@/stores/session";

export function PortalHomePage() {
  return (
    <>
      <KnowledgeSearch />
      <MyTickets />
    </>
  );
}

function KnowledgeSearch() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const [draft, setDraft] = useState(query);
  const knowledge = usePublicKnowledge(query, category);

  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Find an answer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search how-to guides before raising a ticket.</p>
      </div>
      <form
        className="flex max-w-2xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          if (draft.trim()) next.set("q", draft.trim());
          else next.delete("q");
          setParams(next, { replace: true });
        }}
      >
        <Input id="portal-search" aria-label="Search the knowledge base" placeholder="e.g. reset password, VPN" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button variant="secondary" type="submit" aria-label="Search">
          <Search className="size-4" />
        </Button>
      </form>
      {knowledge.data && knowledge.data.categories.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
          {[{ id: "", name: "All" }, ...knowledge.data.categories].map((c) => (
            <button
              key={c.id || "all"}
              aria-pressed={category === (c.id ? c.name : "")}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (c.id) next.set("category", c.name);
                else next.delete("category");
                setParams(next, { replace: true });
              }}
              className="rounded-md border border-input px-3 py-1 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {knowledge.isPending ? (
        <StateMessage kind="loading">Searching…</StateMessage>
      ) : knowledge.isError ? (
        <StateMessage kind="error">{knowledge.error.message}</StateMessage>
      ) : knowledge.data.articles.length === 0 ? (
        <StateMessage kind="empty">No articles match{query ? ` “${query}”` : ""}. You can raise a ticket below.</StateMessage>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {knowledge.data.articles.slice(0, 8).map((a) => (
            <Link key={a.id} to={`/portal/knowledge/${a.id}`}>
              <Panel className="grid h-full gap-1 p-4 hover:border-primary">
                <span className="font-mono text-xs text-muted-foreground">{a.number}</span>
                <span className="font-semibold">{a.title}</span>
                {a.summary && <span className="line-clamp-2 text-sm text-muted-foreground">{a.summary}</span>}
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function MyTickets() {
  const status = useSession((s) => s.status);
  const portal = usePortal();
  const [creating, setCreating] = useState(false);

  if (status !== "signed-in")
    return (
      <Panel className="grid justify-items-start gap-2 p-5">
        <h2 className="text-lg font-semibold">Your tickets</h2>
        <p className="text-sm text-muted-foreground">Sign in with your work account to raise a ticket and follow its progress.</p>
        <Button onClick={() => void signIn("/portal")}>Sign in</Button>
      </Panel>
    );
  if (portal.isPending) return <StateMessage kind="loading">Loading your tickets…</StateMessage>;
  if (portal.isError) return <StateMessage kind="error">{portal.error.message}</StateMessage>;
  if (!portal.data.allowed)
    return <StateMessage kind="error">The support portal is available to confirmed company email accounts only.</StateMessage>;

  const items = [
    ...portal.data.incidents.map((i) => ({ ...i, kind: "incident" as const })),
    ...portal.data.requests.map((r) => ({ ...r, kind: "request" as const })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Your tickets</h2>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="size-4" /> {creating ? "Cancel" : "Raise a ticket"}
        </Button>
      </div>
      {creating && <NewTicket onDone={() => setCreating(false)} />}
      {items.length === 0 ? (
        <StateMessage kind="empty">You have not raised any tickets yet.</StateMessage>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link to={`/portal/${item.kind}s/${item.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-accent">
                  <span className="font-mono text-xs text-muted-foreground">{item.number}</span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.kind === "request" && <Badge>Request</Badge>}
                  <IncidentStateBadge state={item.state} />
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}

function NewTicket({ onDone }: { onDone: () => void }) {
  const submit = useSubmitPortalTicket();
  const navigate = useNavigate();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    submit.mutate(
      {
        title: String(form.get("title")),
        description: String(form.get("description")),
        impact: Number(form.get("impact")),
        urgency: Number(form.get("urgency")),
        category: String(form.get("category")) || null,
      },
      {
        onSuccess: (r) => {
          onDone();
          navigate(`/portal/incidents/${r.id}`);
        },
      },
    );
  };
  return (
    <Panel className="p-4">
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={onSubmit}>
        <div className="sm:col-span-3">
          <Field label="Summary">
            <Input id="portal-title" name="title" required minLength={5} maxLength={160} />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="What is happening?" hint="When it started, what you have tried, and who else is affected.">
            <Textarea id="portal-description" name="description" required minLength={5} maxLength={6000} rows={4} />
          </Field>
        </div>
        <Field label="How many people are affected?">
          <Select id="portal-impact" name="impact" defaultValue="3">
            <option value="1">Many people</option>
            <option value="2">My team</option>
            <option value="3">Just me</option>
          </Select>
        </Field>
        <Field label="How urgent is it?">
          <Select id="portal-urgency" name="urgency" defaultValue="3">
            <option value="1">I cannot work</option>
            <option value="2">Work is slowed down</option>
            <option value="3">I can work around it</option>
          </Select>
        </Field>
        <Field label="Area">
          <Select id="portal-category" name="category" defaultValue="">
            <option value="">Not sure</option>
            {["network", "hardware", "software", "database", "inquiry"].map((c) => (
              <option key={c} value={c}>{c === "database" ? "Data / reports" : humanize(c)}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-2 sm:col-span-3">
          <FormError error={submit.error} />
          <div>
            <Button type="submit" busy={submit.isPending}>Submit ticket</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
