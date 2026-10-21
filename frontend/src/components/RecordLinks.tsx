import { useState } from "react";
import { Link } from "react-router";
import { useAddChangeLink, useChangeLinks, useIncidentLinks, useLinkCandidates, useRemoveChangeLink } from "@/api/cmdb";
import { humanize } from "@/lib/format";
import { Badge, Button, FormError, Panel, Select, StateMessage } from "./ui";

const RELATIONS = { resolves: "Resolves", caused_by: "Caused by", related: "Related" } as const;

/** Incidents and problems a change resolves, plus its affected configuration items. */
export function ChangeLinksPanel({ orgId, changeId, canManage }: { orgId: string; changeId: string; canManage: boolean }) {
  const links = useChangeLinks(orgId, changeId);
  const candidates = useLinkCandidates(orgId, canManage);
  const add = useAddChangeLink(orgId, changeId);
  const remove = useRemoveChangeLink(orgId, changeId);
  const [target, setTarget] = useState("");
  const [relation, setRelation] = useState<keyof typeof RELATIONS>("resolves");

  return (
    <Panel className="grid gap-3 p-4">
      <h2 className="text-sm font-semibold">Linked records</h2>
      {links.isPending ? (
        <StateMessage kind="loading">Loading links…</StateMessage>
      ) : links.isError ? (
        <StateMessage kind="error">{links.error.message}</StateMessage>
      ) : (
        <>
          {links.data.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents or problems linked.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {links.data.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{RELATIONS[l.relation]}</Badge>
                  {l.record_type === "incident" ? (
                    <Link className="font-mono text-xs text-primary hover:underline" to={`/incidents/${l.record_id}`}>{l.record_number ?? "Incident"}</Link>
                  ) : (
                    <span className="font-mono text-xs">{l.record_number ?? "Problem"}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{l.record_title ?? humanize(l.record_type)}</span>
                  {canManage && (
                    <button className="text-xs text-destructive underline" onClick={() => remove.mutate(l.id)} disabled={remove.isPending}>
                      Unlink
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {links.data.affected_cis.length > 0 && (
            <div className="text-sm">
              <h3 className="text-xs text-muted-foreground">Affected configuration items</h3>
              <p>{links.data.affected_cis.map((ci) => ci.name).join(", ")}</p>
            </div>
          )}
        </>
      )}
      {canManage && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const [recordType, recordId] = target.split(":") as ["incident" | "problem", string];
            add.mutate({ recordType, recordId, relation }, { onSuccess: () => setTarget("") });
          }}
        >
          <Select id="change-link-target" aria-label="Record to link" value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="" disabled>Choose an incident or problem</option>
            <optgroup label="Incidents">
              {(candidates.data?.incidents ?? []).map((i) => <option key={i.id} value={`incident:${i.id}`}>{i.number} — {i.title}</option>)}
            </optgroup>
            <optgroup label="Problems">
              {(candidates.data?.problems ?? []).map((p) => <option key={p.id} value={`problem:${p.id}`}>{p.number} — {p.title}</option>)}
            </optgroup>
          </Select>
          <div className="flex gap-2">
            <Select id="change-link-relation" aria-label="Relation" className="w-36!" value={relation} onChange={(e) => setRelation(e.target.value as keyof typeof RELATIONS)}>
              {Object.entries(RELATIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Button type="submit" variant="secondary" busy={add.isPending} disabled={!target}>Link</Button>
          </div>
          <FormError error={add.error ?? remove.error} />
        </form>
      )}
    </Panel>
  );
}

/** Changes linked to an incident and its problem (hidden from requesters by RLS). */
export function IncidentLinksPanel({ orgId, incidentId }: { orgId: string; incidentId: string }) {
  const links = useIncidentLinks(orgId, incidentId);
  if (!links.data || (links.data.changes.length === 0 && !links.data.problem)) return null;
  return (
    <Panel className="grid gap-2 p-4 text-sm">
      <h2 className="font-semibold">Related work</h2>
      {links.data.problem && (
        <p>
          Problem <span className="font-mono text-xs">{links.data.problem.number}</span> · {links.data.problem.title}
        </p>
      )}
      {links.data.changes.map((c) => (
        <p key={c.link_id} className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{RELATIONS[c.relation as keyof typeof RELATIONS] ?? c.relation}</Badge>
          <Link className="font-mono text-xs text-primary hover:underline" to={`/changes/${c.id}`}>{c.number}</Link>
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
        </p>
      ))}
    </Panel>
  );
}
