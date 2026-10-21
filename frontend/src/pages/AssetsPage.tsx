import { clsx } from "clsx";
import { Plus, Search, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  useAddRelationship,
  useAsset,
  useAssets,
  useRemoveRelationship,
  useSaveAsset,
  useServices,
  type Asset,
  type CiStatus,
  type Criticality,
} from "@/api/cmdb";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, th, type Tone } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";
import { CMDB_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

const STATUSES: CiStatus[] = ["operational", "degraded", "maintenance", "retired"];
const CRITICALITIES: Criticality[] = ["low", "medium", "high", "critical"];
const RELATIONSHIP_TYPES = ["depends_on", "runs_on", "connects_to", "hosts", "backs_up"];
const statusTone: Record<CiStatus, Tone> = { operational: "good", degraded: "warn", maintenance: "info", retired: "muted" };
const criticalityTone: Record<Criticality, Tone> = { low: "neutral", medium: "info", high: "warn", critical: "bad" };

export function AssetsPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const selectedId = params.get("asset");
  const [draft, setDraft] = useState(q);
  const [creating, setCreating] = useState(false);
  const canEdit = hasAnyRole(workspace.roles, CMDB_MANAGE_ROLES);
  const assets = useAssets(workspace.id, { q, status }, workspace.is_staff);

  if (!workspace.is_staff) return <StateMessage kind="error">Assets & CMDB is available to workspace staff only.</StateMessage>;

  const set = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged, { replace: true });
  };

  return (
    <>
      <PageHeader
        eyebrow="Governance and knowledge"
        title="Assets & CMDB"
        description="Configuration items with class, environment, criticality, service mapping, and relationships."
        actions={
          canEdit && (
            <Button onClick={() => setCreating((v) => !v)}>
              <Plus className="size-4" /> Add configuration item
            </Button>
          )
        }
      />
      {creating && canEdit && <AssetForm orgId={workspace.id} onDone={(id) => { setCreating(false); if (id) set({ asset: id }); }} />}

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-60 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: draft.trim() });
          }}
        >
          <Input id="asset-search" aria-label="Search configuration items" placeholder="Search name, class or asset tag" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button variant="secondary" type="submit" aria-label="Search">
            <Search className="size-4" />
          </Button>
        </form>
        <Select id="asset-status" aria-label="Status" className="w-44!" value={status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      </div>

      {assets.isPending ? (
        <StateMessage kind="loading">Loading configuration items…</StateMessage>
      ) : assets.isError ? (
        <StateMessage kind="error">{assets.error.message}</StateMessage>
      ) : assets.data.length === 0 ? (
        <StateMessage kind="empty">{q || status ? "No configuration items match these filters." : "No configuration items yet. Add the infrastructure that supports your services."}</StateMessage>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>Name</th>
                  <th className={th}>Class</th>
                  <th className={th}>Environment</th>
                  <th className={th}>Status</th>
                  <th className={th}>Criticality</th>
                  <th className={th}>Service</th>
                  <th className={th}>Links</th>
                  <th className={th}>Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {assets.data.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => set({ asset: a.id })}
                    className={clsx("cursor-pointer hover:bg-accent", a.id === selectedId && "bg-accent")}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <button className="text-left" onClick={() => set({ asset: a.id })}>{a.name}</button>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.ci_class}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.environment ?? "—"}</td>
                    <td className="px-4 py-2.5"><Badge tone={statusTone[a.status]}>{humanize(a.status)}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={criticalityTone[a.criticality]}>{humanize(a.criticality)}</Badge></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.service_name ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{a.relationship_count ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(a.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          {selectedId && (
            <AssetPanel key={selectedId} orgId={workspace.id} assetId={selectedId} all={assets.data} canEdit={canEdit} onClose={() => set({ asset: "" })} />
          )}
        </div>
      )}
    </>
  );
}

function AssetForm({ orgId, asset, onDone }: { orgId: string; asset?: Asset; onDone: (id?: string) => void }) {
  const save = useSaveAsset(orgId);
  const services = useServices(orgId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "");
    save.mutate(
      {
        ...(asset ? { id: asset.id, expectedUpdatedAt: asset.updated_at } : {}),
        name: text("name"),
        ciClass: text("ciClass"),
        environment: text("environment"),
        status: text("status") as CiStatus,
        criticality: text("criticality") as Criticality,
        location: text("location"),
        serviceId: text("service") || null,
      },
      { onSuccess: (saved) => onDone(saved.id) },
    );
  };
  const prefix = asset ? "edit-asset" : "asset";
  return (
    <Panel className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Name">
          <Input id={`${prefix}-name`} name="name" required minLength={2} maxLength={120} defaultValue={asset?.name} />
        </Field>
        <Field label="Class">
          <Input id={`${prefix}-class`} name="ciClass" required minLength={2} maxLength={80} defaultValue={asset?.ci_class ?? "Server"} />
        </Field>
        <Field label="Environment">
          <Input id={`${prefix}-environment`} name="environment" maxLength={40} defaultValue={asset?.environment ?? "production"} />
        </Field>
        <Field label="Location">
          <Input id={`${prefix}-location`} name="location" maxLength={120} defaultValue={asset?.location ?? ""} />
        </Field>
        <Field label="Status">
          <Select id={`${prefix}-status`} name="status" defaultValue={asset?.status ?? "operational"}>
            {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </Field>
        <Field label="Criticality">
          <Select id={`${prefix}-criticality`} name="criticality" defaultValue={asset?.criticality ?? "medium"}>
            {CRITICALITIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Service">
            <Select id={`${prefix}-service`} name="service" defaultValue={asset?.service_id ?? ""}>
              <option value="">No service</option>
              {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <FormError error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onDone()}>Cancel</Button>
            <Button type="submit" busy={save.isPending}>{asset ? "Save changes" : "Add item"}</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

function AssetPanel({ orgId, assetId, all, canEdit, onClose }: { orgId: string; assetId: string; all: Asset[]; canEdit: boolean; onClose: () => void }) {
  const asset = useAsset(orgId, assetId);
  const add = useAddRelationship(orgId);
  const remove = useRemoveRelationship(orgId);
  const [editing, setEditing] = useState(false);

  if (asset.isPending) return <StateMessage kind="loading">Loading configuration item…</StateMessage>;
  if (asset.isError) return <StateMessage kind="error">{asset.error.message}</StateMessage>;
  const a = asset.data;
  if (editing) return <AssetForm orgId={orgId} asset={a} onDone={() => setEditing(false)} />;

  return (
    <Panel className="grid gap-4 p-4 xl:sticky xl:top-20">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{a.ci_class}{a.asset_tag ? ` · ${a.asset_tag}` : ""}</p>
          <h2 className="font-semibold break-words">{a.name}</h2>
        </div>
        <button onClick={onClose} aria-label="Close configuration item"><X className="size-4" /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone[a.status]}>{humanize(a.status)}</Badge>
        <Badge tone={criticalityTone[a.criticality]}>Criticality: {a.criticality}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Environment</dt><dd>{a.environment ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Location</dt><dd>{a.location ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{a.service_name ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">IP address</dt><dd className="font-mono text-xs">{a.ip_address ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Owner</dt><dd>{a.owner_name ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Updated</dt><dd>{formatDateTime(a.updated_at)}</dd></div>
      </dl>
      {canEdit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}

      <div className="grid gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Relationships</h3>
        {(a.relationships ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No relationships recorded.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {(a.relationships ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {r.parent_name} <span className="text-muted-foreground">{humanize(r.relationship_type).toLowerCase()}</span> {r.child_name}
                </span>
                {canEdit && (
                  <button
                    className="text-xs text-destructive underline"
                    onClick={() => remove.mutate({ id: a.id, relationshipId: r.id })}
                    aria-label={`Remove relationship to ${r.parent_id === a.id ? r.child_name : r.parent_name}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              add.mutate({ id: a.id, childId: String(form.get("child")), relationshipType: String(form.get("type")) });
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Select id="relationship-type" name="type" aria-label="Relationship" defaultValue="depends_on">
                {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </Select>
              <Select id="relationship-child" name="child" aria-label="Related item" required defaultValue="">
                <option value="" disabled>Choose an item</option>
                {all.filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
            <FormError error={add.error ?? remove.error} />
            <Button type="submit" variant="secondary" busy={add.isPending}>Add relationship</Button>
          </form>
        )}
      </div>
    </Panel>
  );
}
