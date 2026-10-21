import { useState } from "react";
import { useSearchParams } from "react-router";
import { useAuditFacets, useAuditTrail, type AuditEvent } from "@/api/admin";
import { Badge, Button, Input, PageHeader, Panel, Select, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";

export function AuditPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const recordType = params.get("recordType") ?? "";
  const action = params.get("action") ?? "";
  const [draftAction, setDraftAction] = useState(action);
  const facets = useAuditFacets(workspace.id);
  const trail = useAuditTrail(workspace.id, { recordType, action });
  const events = trail.data?.pages.flatMap((p) => p.results) ?? [];

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v);
      else merged.delete(k);
    }
    setParams(merged, { replace: true });
  };

  return (
    <>
      <PageHeader
        eyebrow="Governance and knowledge"
        title="Audit trail"
        description="Entries cannot be edited or deleted, by anyone, including administrators."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          update({ action: draftAction.trim() });
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Record type</span>
          <Select id="audit-type" className="w-52!" value={recordType} onChange={(e) => update({ recordType: e.target.value })}>
            <option value="">All record types</option>
            {(facets.data?.recordTypes ?? []).map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Action</span>
          <Input id="audit-action" className="w-52!" placeholder="e.g. updated" value={draftAction} onChange={(e) => setDraftAction(e.target.value)} />
        </label>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>

      {trail.isPending ? (
        <StateMessage kind="loading">Loading audit entries…</StateMessage>
      ) : trail.isError ? (
        <StateMessage kind="error">{trail.error.message}</StateMessage>
      ) : events.length === 0 ? (
        <StateMessage kind="empty">No audit entries match these filters.</StateMessage>
      ) : (
        <>
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[48rem]">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>When</th>
                  <th className={th}>Record</th>
                  <th className={th}>Action</th>
                  <th className={th}>Actor</th>
                  <th className={th}>Source</th>
                  <th className={th}>Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((e) => <AuditRow key={e.id} event={e} />)}
              </tbody>
            </table>
          </Panel>
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{events.length} entries shown, newest first</span>
            {trail.hasNextPage && (
              <Button variant="secondary" busy={trail.isFetchingNextPage} onClick={() => void trail.fetchNextPage()}>
                Load older entries
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function AuditRow({ event: e }: { event: AuditEvent }) {
  const changes = e.after_values ?? e.before_values;
  return (
    <tr className="align-top hover:bg-accent">
      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at)}</td>
      <td className="px-4 py-2.5">
        <span className="block">{humanize(e.record_type)}</span>
        {e.record_id && <span className="font-mono text-[11px] text-muted-foreground">{e.record_id.slice(0, 8)}</span>}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
      <td className="px-4 py-2.5">{e.actor_name ?? (e.actor_id ? "Workspace member" : "System")}</td>
      <td className="px-4 py-2.5">
        <Badge tone={e.source === "application" ? "neutral" : "muted"}>{humanize(e.source)}</Badge>
      </td>
      <td className="max-w-80 px-4 py-2.5">
        {changes ? (
          <details>
            <summary className="cursor-pointer text-xs text-primary">View values</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">
              {JSON.stringify({ before: e.before_values, after: e.after_values }, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
