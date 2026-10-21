import { Plus } from "lucide-react";
import { Link } from "react-router";
import { useChanges } from "@/api/hooks";
import { ApprovalBadge, RecordStateBadge, RiskBadge } from "@/components/badges";
import { ListToolbar, OPEN_RECORD_STATES, RECORD_FILTERS, useListParams } from "@/components/ListToolbar";
import { Badge, PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";
import { CHANGE_CREATE_ROLES, hasAnyRole } from "@/lib/roles";

export function ChangesPage() {
  const workspace = useWorkspace();
  const { state, q, apiState, update } = useListParams(OPEN_RECORD_STATES);
  const changes = useChanges(workspace.id, { state: apiState, q });

  return (
    <>
      <PageHeader
        title="Changes"
        description="Planned changes in window order, with their CAB approval."
        actions={
          hasAnyRole(workspace.roles, CHANGE_CREATE_ROLES) && (
            <Link to="/changes/new" className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Plus className="size-4" /> Plan a change
            </Link>
          )
        }
      />
      <ListToolbar id="change-search" filters={RECORD_FILTERS} state={state} q={q} placeholder="Search by number or title" update={update} />
      {changes.isPending ? (
        <StateMessage kind="loading">Loading changes…</StateMessage>
      ) : changes.isError ? (
        <StateMessage kind="error">{changes.error.message}</StateMessage>
      ) : changes.data.length === 0 ? (
        <StateMessage kind="empty">No changes match these filters.</StateMessage>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Approval</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Window</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {changes.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link className="text-brand-600 hover:underline dark:text-brand-100" to={`/changes/${c.id}`}>{c.number}</Link>
                  </td>
                  <td className="max-w-72 truncate px-4 py-2">{c.title}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <Badge tone={c.change_type === "emergency" ? "bad" : "neutral"}>{humanize(c.change_type)}</Badge>
                      <RiskBadge risk={c.risk} />
                    </div>
                  </td>
                  <td className="px-4 py-2"><ApprovalBadge status={c.approval_status} /></td>
                  <td className="px-4 py-2"><RecordStateBadge state={c.state} /></td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">{formatDateTime(c.start_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
