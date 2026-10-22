import { clsx } from "clsx";
import { KeyRound, Plus, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  useBulkAction,
  useCreateSecret,
  useDeleteSecret,
  useRequestAccess,
  useSecret,
  useSecretAction,
  useSecrets,
  useSetPassword,
  useUpdateSecret,
  type DatabaseEngine,
  type Environment,
  type Risk,
  type SecretDetail,
  type SecretFilters,
  type SecretList,
} from "@/api/pam";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize, relativeTime } from "@/lib/format";
import {
  DATABASE_ENGINE_LABELS,
  DURATIONS,
  ENVIRONMENT_LABELS,
  EVENT_LABELS,
  RISK_TONES,
  TEMPLATE_LABELS,
  defaultPort,
  durationLabel,
  rotationState,
  verificationState,
} from "@/lib/pam";
import { PAM_CUSTODIAN_ROLES, hasAnyRole } from "@/lib/roles";

const TABS: { value: "all" | Environment; label: string }[] = [
  { value: "all", label: "All" },
  { value: "production", label: "Production" },
  { value: "dr", label: "Disaster recovery" },
  { value: "uat", label: "UAT" },
  { value: "development", label: "Development" },
];
const RISKS: Risk[] = ["critical", "high", "medium", "low"];

export function PamSecretsPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const custodian = hasAnyRole(workspace.roles, PAM_CUSTODIAN_ROLES);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const environment = (TABS.find((t) => t.value === params.get("env"))?.value ?? "all") as "all" | Environment;
  const filters: SecretFilters = {
    environment: environment === "all" ? undefined : environment,
    risk: RISKS.find((r) => r === params.get("risk")),
    q: params.get("q") ?? undefined,
    usedNeverRotated: params.get("chip") === "1",
  };
  const secrets = useSecrets(workspace.id, filters, workspace.is_staff);
  const openId = params.get("secret");
  // With the detail panel open, the table keeps only the columns needed to pick a secret.
  const compact = Boolean(openId);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // Debounced search into the URL.
  useEffect(() => {
    const id = setTimeout(() => setParam("q", search.trim() || null), 250);
    return () => clearTimeout(id);
  }, [search]); // setParam only reads the latest URL, so it is not a dependency.

  if (!workspace.is_staff) return <StateMessage kind="error">The privileged access vault is available to workspace staff only.</StateMessage>;

  const rows = secrets.data?.results ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader
        eyebrow="Privileged access"
        title="Secrets vault"
        description="Privileged accounts for servers and services. Start with the ones that are used but have never been rotated."
        actions={
          custodian && (
            <Button onClick={() => setAdding((v) => !v)}>
              <Plus className="size-4" /> {adding ? "Cancel" : "Add secret"}
            </Button>
          )
        }
      />

      {adding && secrets.data && (
        <NewSecretForm
          orgId={workspace.id}
          data={secrets.data}
          onCreated={(id) => {
            setAdding(false);
            setParam("secret", id);
          }}
        />
      )}

      {secrets.data && <SummaryCards summary={secrets.data.summary} />}

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Environment" className="flex flex-wrap gap-1 rounded-md border border-input bg-card p-1">
          {TABS.filter((t) => t.value !== "development" || (secrets.data?.environment_counts.development ?? 0) > 0).map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={environment === tab.value}
              onClick={() => setParam("env", tab.value === "all" ? null : tab.value)}
              className="flex items-center gap-2 rounded px-3 py-1.5 text-sm aria-selected:bg-primary aria-selected:text-primary-foreground"
            >
              {tab.label}
              <span className="text-xs tabular-nums opacity-75">{secrets.data?.environment_counts[tab.value] ?? "–"}</span>
            </button>
          ))}
        </div>
        <button
          aria-pressed={filters.usedNeverRotated}
          onClick={() => setParam("chip", filters.usedNeverRotated ? null : "1")}
          className="rounded-full border border-warning/40 px-3 py-1 text-xs font-medium text-warning aria-pressed:bg-warning/15"
        >
          Used, never rotated
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="pam-risk">Risk</label>
          <div className="w-36">
            <Select id="pam-risk" value={filters.risk ?? ""} onChange={(e) => setParam("risk", e.target.value || null)}>
            <option value="">Any risk</option>
            {RISKS.map((r) => (
              <option key={r} value={r}>{humanize(r)}</option>
            ))}
            </Select>
          </div>
          <label className="sr-only" htmlFor="pam-search">Search secrets</label>
          <div className="w-60 max-w-full">
            <Input id="pam-search" type="search" placeholder="Search name, host, folder" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {custodian && selected.size > 0 && (
        <BulkBar orgId={workspace.id} ids={[...selected]} folders={secrets.data?.folders ?? []} onDone={() => setSelected(new Set())} />
      )}

      <div className={clsx("grid gap-6", openId && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
        {secrets.isPending ? (
          <StateMessage kind="loading">Loading secrets…</StateMessage>
        ) : secrets.isError ? (
          <StateMessage kind="error">{secrets.error.message}</StateMessage>
        ) : rows.length === 0 ? (
          <StateMessage kind="empty">No secrets match these filters.</StateMessage>
        ) : (
          <Panel className="self-start overflow-x-auto">
            <table className={clsx("w-full text-sm", compact ? "min-w-[34rem]" : "min-w-[56rem]")}>
              <thead>
                <tr className="border-b border-border">
                  {custodian && (
                    <th className={clsx(th, "w-10")}>
                      <input
                        type="checkbox"
                        aria-label="Select all shown secrets"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                      />
                    </th>
                  )}
                  <th className={th}>Secret</th>
                  <th className={th}>Risk</th>
                  <th className={th}>Rotation</th>
                  {!compact && (
                    <>
                      <th className={th}>Verified</th>
                      <th className={th}>Last used</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((secret) => {
                  const rotation = rotationState(secret);
                  const verified = verificationState(secret);
                  return (
                    <tr key={secret.id} className={clsx("hover:bg-accent", openId === secret.id && "bg-accent")}>
                      {custodian && (
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${secret.name}`}
                            checked={selected.has(secret.id)}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(secret.id)) next.delete(secret.id);
                                else next.add(secret.id);
                                return next;
                              })
                            }
                          />
                        </td>
                      )}
                      <td className="max-w-80 px-4 py-2.5">
                        <button className="text-left font-medium text-primary hover:underline" onClick={() => setParam("secret", secret.id)}>
                          {secret.name}
                        </button>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {secret.username}@{secret.host} · {secret.folder}
                        </p>
                      </td>
                      <td className="px-4 py-2.5"><Badge tone={RISK_TONES[secret.risk]}>{humanize(secret.risk)}</Badge></td>
                      <td className="px-4 py-2.5">
                        <Badge tone={rotation.tone}>{rotation.label}</Badge>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {secret.password_changed_at ? `Changed ${relativeTime(secret.password_changed_at)}` : "Original password"}
                        </p>
                      </td>
                      {!compact && (
                        <>
                          <td className="px-4 py-2.5"><Badge tone={verified.tone}>{verified.label}</Badge></td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{secret.last_used_at ? relativeTime(secret.last_used_at) : "Never"}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Button variant="secondary" className="h-8" onClick={() => setParam("secret", secret.id)}>
                              <KeyRound className="size-3.5" /> Request access
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              Showing {rows.length} of {secrets.data.summary.total} secrets · sorted by risk
            </p>
          </Panel>
        )}
        {openId && <SecretPanel orgId={workspace.id} id={openId} onClose={() => setParam("secret", null)} />}
      </div>
    </>
  );
}

function SummaryCards({ summary }: { summary: SecretList["summary"] }) {
  const cards = [
    { label: "Automatic rotation", value: `${summary.automatic_rotation_pct}%`, note: `of ${summary.total} secrets rotate on a schedule` },
    { label: "Used, never rotated", value: summary.used_never_rotated, note: "used in the last 7 days with the original password", warn: summary.used_never_rotated > 0 },
    { label: "Never verified", value: summary.never_verified, note: "stored password not checked against the target" },
    { label: "Reveals today", value: summary.sessions_today, note: "approved password reveals across all folders" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Panel key={card.label} className="p-4">
          <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
          <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", card.warn && "text-warning")}>{card.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
        </Panel>
      ))}
    </div>
  );
}

function BulkBar({ orgId, ids, folders, onDone }: { orgId: string; ids: string[]; folders: string[]; onDone: () => void }) {
  const bulk = useBulkAction(orgId);
  const [folder, setFolder] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const run = (action: "enable_rotation" | "disable_rotation" | "verify" | "move") =>
    bulk.mutate(
      { ids, action, folder: action === "move" ? folder : undefined },
      {
        onSuccess: (r) => {
          const failed = r.results.filter((x) => !x.ok);
          setMessage(failed.length ? `${failed.length} of ${r.results.length} failed: ${failed.map((x) => x.name).join(", ")}` : null);
          if (!failed.length) onDone();
        },
      },
    );
  return (
    <Panel className="flex flex-wrap items-center gap-2 p-3">
      <span className="text-sm font-medium">{ids.length} selected</span>
      <Button variant="secondary" busy={bulk.isPending && bulk.variables?.action === "enable_rotation"} onClick={() => run("enable_rotation")}>Enable rotation</Button>
      <Button variant="secondary" busy={bulk.isPending && bulk.variables?.action === "disable_rotation"} onClick={() => run("disable_rotation")}>Disable rotation</Button>
      <Button variant="secondary" busy={bulk.isPending && bulk.variables?.action === "verify"} onClick={() => run("verify")}>Verify now</Button>
      <label className="sr-only" htmlFor="pam-move-folder">Folder</label>
      <Input id="pam-move-folder" list="pam-folders" className="w-40" placeholder="Folder" value={folder} onChange={(e) => setFolder(e.target.value)} />
      <datalist id="pam-folders">
        {folders.map((f) => <option key={f} value={f} />)}
      </datalist>
      <Button variant="secondary" disabled={!folder.trim()} busy={bulk.isPending && bulk.variables?.action === "move"} onClick={() => run("move")}>Move to folder</Button>
      <Button variant="secondary" onClick={onDone}>Clear</Button>
      <FormError error={bulk.error} />
      {message && <p role="alert" className="w-full text-sm text-destructive">{message}</p>}
    </Panel>
  );
}

function SecretPanel({ orgId, id, onClose }: { orgId: string; id: string; onClose: () => void }) {
  const secret = useSecret(orgId, id);
  return (
    <Panel className="self-start p-5">
      {secret.isPending ? (
        <StateMessage kind="loading">Loading secret…</StateMessage>
      ) : secret.isError ? (
        <StateMessage kind="error">{secret.error.message}</StateMessage>
      ) : (
        <SecretDetailView orgId={orgId} secret={secret.data} onClose={onClose} />
      )}
    </Panel>
  );
}

function SecretDetailView({ orgId, secret, onClose }: { orgId: string; secret: SecretDetail; onClose: () => void }) {
  const action = useSecretAction(orgId, secret.id);
  const update = useUpdateSecret(orgId, secret.id);
  const remove = useDeleteSecret(orgId, secret.id);
  const custodian = secret.is_custodian;
  const mine = secret.my_request;
  const result = action.data;

  const policy = (body: Parameters<typeof update.mutate>[0]) => update.mutate(body);

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-muted-foreground">{secret.username}@{secret.host}:{secret.port}</p>
          <h2 className="mt-1 text-lg font-semibold break-words">{secret.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={RISK_TONES[secret.risk]}>{humanize(secret.risk)} risk</Badge>
            <Badge tone="neutral">{ENVIRONMENT_LABELS[secret.environment]}</Badge>
          </div>
        </div>
        <Button variant="secondary" className="h-8" onClick={onClose}>Close</Button>
      </div>

      {secret.risk_reasons.length > 0 && (
        <div className={clsx("rounded-md border p-3 text-sm", secret.risk === "critical" || secret.risk === "high" ? "border-warning/40 bg-warning/10" : "border-border bg-muted")}>
          <ul className="list-disc space-y-1 pl-4">
            {secret.risk_reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          {secret.last_rotation_error && <p className="mt-2 font-mono text-xs break-words text-destructive">{secret.last_rotation_error}</p>}
        </div>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Template</dt><dd>
          {TEMPLATE_LABELS[secret.template]}
          {secret.database_engine && ` · ${DATABASE_ENGINE_LABELS[secret.database_engine]}`}
        </dd>
        <dt className="text-muted-foreground">Folder</dt><dd className="break-words">{secret.folder}</dd>
        <dt className="text-muted-foreground">Password changed</dt><dd>{secret.password_changed_at ? formatDateTime(secret.password_changed_at) : "Never (original password)"}</dd>
        <dt className="text-muted-foreground">Last used</dt><dd>{secret.last_used_at ? formatDateTime(secret.last_used_at) : "Never"}</dd>
        <dt className="text-muted-foreground">Last verified</dt><dd>{secret.last_verified_at ? `${formatDateTime(secret.last_verified_at)} · ${secret.last_verification_ok ? "passed" : "failed"}` : "Never"}</dd>
        <dt className="text-muted-foreground">Owner</dt><dd>{secret.owner_group_name ?? "No owning group"}</dd>
        <dt className="text-muted-foreground">Approval</dt>
        <dd>{secret.approval_required ? "Manager or administrator" : "Not required"}, up to {durationLabel(secret.max_checkout_minutes)}</dd>
        {secret.rotation_enabled && (<><dt className="text-muted-foreground">Next rotation</dt><dd>{formatDateTime(secret.next_rotation_at)}</dd></>)}
      </dl>
      {secret.description && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{secret.description}</p>}

      <fieldset className="grid gap-2 rounded-md border border-border p-3 text-sm" disabled={!custodian || update.isPending}>
        <legend className="px-1 text-xs font-semibold tracking-[0.06em] uppercase">Rotation policy</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={secret.rotation_enabled} onChange={(e) => policy({ expectedUpdatedAt: secret.updated_at, rotationEnabled: e.target.checked })} />
          Rotate every
          <select
            aria-label="Rotation interval"
            className="rounded border border-input bg-card px-1 py-0.5"
            value={secret.rotation_interval_days}
            onChange={(e) => policy({ expectedUpdatedAt: secret.updated_at, rotationIntervalDays: Number(e.target.value) })}
          >
            {[1, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={secret.rotate_after_checkout} onChange={(e) => policy({ expectedUpdatedAt: secret.updated_at, rotateAfterCheckout: e.target.checked })} />
          Rotate after each check-in
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={secret.verify_enabled} onChange={(e) => policy({ expectedUpdatedAt: secret.updated_at, verifyEnabled: e.target.checked })} />
          Verify the stored password every 6 hours
        </label>
        {!custodian && <p className="text-xs text-muted-foreground">Managers and administrators change the policy.</p>}
        <FormError error={update.error} />
      </fieldset>

      {custodian && (
        <div className="flex flex-wrap gap-2">
          <Button busy={action.isPending && action.variables === "rotate"} onClick={() => action.mutate("rotate")}>
            <RotateCw className="size-4" /> Rotate now
          </Button>
          <Button variant="secondary" busy={action.isPending && action.variables === "verify"} onClick={() => action.mutate("verify")}>
            <ShieldCheck className="size-4" /> Verify now
          </Button>
          {result && (
            <p role="status" className={clsx("w-full text-sm", result.ok ? "text-success" : "text-destructive")}>
              {result.ok ? (action.variables === "rotate" ? "Password rotated." : "Stored password verified.") : result.error}
            </p>
          )}
          <FormError error={action.error} />
        </div>
      )}

      {mine ? (
        <p className="rounded-md border border-border bg-muted p-3 text-sm">
          You have {mine.status === "pending" ? "a pending request" : "active access"} for this secret.{" "}
          <Link className="text-primary hover:underline" to="/pam/access">Open your access</Link>
        </p>
      ) : (
        <RequestAccessForm orgId={orgId} secret={secret} />
      )}

      {custodian && <ManageSecret orgId={orgId} secret={secret} onDeleted={onClose} remove={remove} />}

      <section>
        <h3 className="text-xs font-semibold tracking-[0.06em] uppercase">Recent activity</h3>
        {secret.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-sm">
            {secret.events.slice(0, 12).map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className={clsx(e.action.endsWith("failed") && "text-destructive")}>{EVENT_LABELS[e.action] ?? humanize(e.action)}</span>
                  <span className="text-muted-foreground"> · {e.actor_name ?? "Scheduled job"}</span>
                </span>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.created_at} title={formatDateTime(e.created_at)}>
                  {relativeTime(e.created_at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function RequestAccessForm({ orgId, secret }: { orgId: string; secret: SecretDetail }) {
  const request = useRequestAccess(orgId);
  const durations = DURATIONS.filter((d) => d <= secret.max_checkout_minutes);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    request.mutate({
      secretId: secret.id,
      reason: String(form.get("reason") ?? "").trim(),
      ticketReference: String(form.get("ticket") ?? "").trim() || undefined,
      durationMinutes: Number(form.get("duration")),
    });
  };
  if (request.isSuccess) {
    return (
      <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
        {request.data.status === "approved" ? "Access granted." : "Request sent to the custodians."}{" "}
        <Link className="text-primary hover:underline" to="/pam/access">Open your access</Link>
      </p>
    );
  }
  return (
    <form className="grid gap-3 rounded-md border border-border p-3" onSubmit={submit}>
      <h3 className="text-xs font-semibold tracking-[0.06em] uppercase">Request access</h3>
      <Field label="Why do you need it?" hint="At least 10 characters. Approvers see this.">
        <Textarea id="pam-reason" name="reason" required minLength={10} maxLength={1000} rows={2} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ticket (optional)">
          <Input id="pam-ticket" name="ticket" maxLength={40} placeholder="CHG0001234" />
        </Field>
        <Field label="For how long?">
          <Select id="pam-duration" name="duration" defaultValue={String(Math.min(60, secret.max_checkout_minutes))}>
            {durations.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
          </Select>
        </Field>
      </div>
      <FormError error={request.error} />
      <Button type="submit" busy={request.isPending} className="w-fit">
        <KeyRound className="size-4" /> {secret.approval_required ? "Request access" : "Check out now"}
      </Button>
    </form>
  );
}

function ManageSecret({
  orgId,
  secret,
  onDeleted,
  remove,
}: {
  orgId: string;
  secret: SecretDetail;
  onDeleted: () => void;
  remove: ReturnType<typeof useDeleteSecret>;
}) {
  const setPassword = useSetPassword(orgId, secret.id);
  const [password, setValue] = useState("");
  return (
    <details className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Manage secret</summary>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPassword.mutate(password, { onSuccess: () => setValue("") });
        }}
      >
        <Field label="Replace stored password" hint="Use when the password was changed outside the vault.">
          <Input id="pam-replace-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <FormError error={setPassword.error} />
        {setPassword.isSuccess && <p role="status" className="text-success">Stored password replaced.</p>}
        <Button type="submit" variant="secondary" className="w-fit" busy={setPassword.isPending}>Replace password</Button>
      </form>
      <div className="mt-4 border-t border-border pt-3">
        <Button
          variant="danger"
          busy={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${secret.name}? Its access requests are removed; the activity log is kept.`)) remove.mutate(undefined, { onSuccess: onDeleted });
          }}
        >
          <Trash2 className="size-4" /> Delete secret
        </Button>
        <FormError error={remove.error} />
      </div>
    </details>
  );
}

function NewSecretForm({ orgId, data, onCreated }: { orgId: string; data: SecretList; onCreated: (id: string) => void }) {
  const create = useCreateSecret(orgId);
  const [environment, setEnvironment] = useState<Environment>("production");
  const [template, setTemplate] = useState<SecretDetail["template"]>("ssh");
  const [engine, setEngine] = useState<DatabaseEngine>("postgresql");
  // The port follows the template until someone types their own.
  const [port, setPort] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    const on = (k: string) => form.get(k) === "on";
    create.mutate(
      {
        name: text("name"),
        host: text("host"),
        port: Number(port ?? defaultPort(template, engine)),
        username: text("username"),
        template,
        databaseEngine: template === "database" ? engine : null,
        environment,
        folder: text("folder") || "General",
        description: text("description"),
        ownerGroupId: text("owner") || null,
        approvalRequired: environment === "production" || on("approvalRequired"),
        maxCheckoutMinutes: Number(text("maxCheckout")),
        rotationEnabled: on("rotationEnabled"),
        rotationIntervalDays: Number(text("interval") || 30),
        rotateAfterCheckout: on("rotateAfterCheckout"),
        verifyEnabled: on("verifyEnabled"),
        password: String(form.get("password") ?? ""),
      },
      { onSuccess: (r) => onCreated(r.id) },
    );
  };
  return (
    <Panel className="p-5">
      <form className="grid gap-4 md:grid-cols-3" onSubmit={submit} autoComplete="off">
        <Field label="Name"><Input id="pam-name" name="name" required minLength={2} maxLength={120} placeholder="web-01 root" /></Field>
        <Field label="Host"><Input id="pam-host" name="host" required maxLength={255} placeholder="web-01.example.test" /></Field>
        <Field label="Port"><Input id="pam-port" type="number" min={1} max={65535} value={port ?? defaultPort(template, engine)} onChange={(e) => setPort(e.target.value)} /></Field>
        <Field label="Account"><Input id="pam-username" name="username" required maxLength={128} placeholder="root" /></Field>
        <Field label="Current password" hint="Encrypted before it is stored; never shown back here.">
          <Input id="pam-password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label="Template">
          <Select id="pam-template" value={template} onChange={(e) => setTemplate(e.target.value as SecretDetail["template"])}>
            {Object.entries(TEMPLATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        {template === "database" && (
          <Field label="Database engine">
            <Select id="pam-engine" value={engine} onChange={(e) => setEngine(e.target.value as DatabaseEngine)}>
              {Object.entries(DATABASE_ENGINE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Environment">
          <Select id="pam-environment" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
            {Object.entries(ENVIRONMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Folder">
          <Input id="pam-folder" name="folder" list="pam-new-folders" maxLength={80} placeholder="General" />
          <datalist id="pam-new-folders">{data.folders.map((f) => <option key={f} value={f} />)}</datalist>
        </Field>
        <Field label="Owning group">
          <Select id="pam-owner" name="owner" defaultValue="">
            <option value="">None</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label="Longest access window">
          <Select id="pam-max-checkout" name="maxCheckout" defaultValue="240">
            {DURATIONS.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
          </Select>
        </Field>
        <Field label="Rotate every (days)"><Input id="pam-interval" name="interval" type="number" min={1} max={365} defaultValue={30} /></Field>
        <div className="grid content-start gap-2 pt-6 text-sm">
          {environment === "production" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked disabled readOnly /> Needs an approver (always for production)
            </label>
          ) : (
            <label className="flex items-center gap-2"><input type="checkbox" name="approvalRequired" defaultChecked /> Needs an approver</label>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" name="rotationEnabled" /> Rotate on a schedule</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="rotateAfterCheckout" /> Rotate after each check-in</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="verifyEnabled" /> Verify every 6 hours</label>
        </div>
        <div className="md:col-span-3">
          <Field label="Notes (optional)"><Textarea id="pam-description" name="description" maxLength={2000} rows={2} /></Field>
        </div>
        <div className="flex items-center gap-3 md:col-span-3">
          <Button type="submit" busy={create.isPending}><KeyRound className="size-4" /> Vault secret</Button>
          <FormError error={create.error} />
        </div>
      </form>
    </Panel>
  );
}
