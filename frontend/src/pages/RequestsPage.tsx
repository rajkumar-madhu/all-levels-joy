import { Plus } from "lucide-react";
import { Link } from "react-router";
import { useRequests } from "@/api/hooks";
import { ApprovalBadge, PriorityBadge, RecordStateBadge } from "@/components/badges";
import { ListToolbar, OPEN_RECORD_STATES, RECORD_FILTERS, useListParams } from "@/components/ListToolbar";
import { PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn } from "@/lib/format";

export function RequestsPage() {
  const workspace = useWorkspace();
  const { state, q, apiState, update } = useListParams(OPEN_RECORD_STATES);
  const requests = useRequests(workspace.id, { state: apiState, q });

  return (
    <>
      <PageHeader
        title="Requests"
        description={workspace.is_staff ? "Service requests waiting to be fulfilled." : "Things you have asked for."}
        actions={
          <Link to="/catalog" className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Plus className="size-4" /> New request
          </Link>
        }
      />
      <ListToolbar id="request-search" filters={RECORD_FILTERS} state={state} q={q} placeholder="Search by number or title" update={update} />
      {requests.isPending ? (
        <StateMessage kind="loading">Loading requests…</StateMessage>
      ) : requests.isError ? (
        <StateMessage kind="error">{requests.error.message}</StateMessage>
      ) : requests.data.length === 0 ? (
        <StateMessage kind="empty">No requests match these filters.</StateMessage>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Approval</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {requests.data.map((r) => {
                const due = dueIn(r.due_at);
                const done = ["resolved", "closed", "cancelled"].includes(r.state);
                return (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link className="text-brand-600 hover:underline dark:text-brand-100" to={`/requests/${r.id}`}>
                        {r.number}
                      </Link>
                    </td>
                    <td className="max-w-72 truncate px-4 py-2">{r.title}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{r.catalog_item_name ?? "—"}</td>
                    <td className="px-4 py-2"><ApprovalBadge status={r.approval_status} /></td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1"><RecordStateBadge state={r.state} /><PriorityBadge priority={r.priority} /></div>
                    </td>
                    <td className={`px-4 py-2 tabular-nums whitespace-nowrap ${!done && due.overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                      {done ? "—" : due.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
