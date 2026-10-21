import { Plus } from "lucide-react";
import { Link } from "react-router";
import { useRequests } from "@/api/hooks";
import { ApprovalBadge, PriorityBadge, RecordStateBadge } from "@/components/badges";
import { ListToolbar, OPEN_RECORD_STATES, RECORD_FILTERS, useListParams } from "@/components/ListToolbar";
import { PageHeader, Panel, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn } from "@/lib/format";

export function RequestsPage() {
  const workspace = useWorkspace();
  const { state, q, apiState, update } = useListParams(OPEN_RECORD_STATES);
  const requests = useRequests(workspace.id, { state: apiState, q });

  return (
    <>
      <PageHeader
        eyebrow="ITSM"
        title="Service requests"
        description={workspace.is_staff ? "Service requests waiting to be fulfilled." : "Things you have asked for."}
        actions={
          <Link to="/catalog" className="inline-flex items-center gap-2 h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
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
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Number</th>
                <th className={th}>Title</th>
                <th className={th}>Item</th>
                <th className={th}>Approval</th>
                <th className={th}>State</th>
                <th className={th}>Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.data.map((r) => {
                const due = dueIn(r.due_at);
                const done = ["resolved", "closed", "cancelled"].includes(r.state);
                return (
                  <tr key={r.id} className="hover:bg-accent">
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link className="text-primary hover:underline" to={`/requests/${r.id}`}>
                        {r.number}
                      </Link>
                    </td>
                    <td className="max-w-72 truncate px-4 py-2">{r.title}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.catalog_item_name ?? "—"}</td>
                    <td className="px-4 py-2"><ApprovalBadge status={r.approval_status} /></td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1"><RecordStateBadge state={r.state} /><PriorityBadge priority={r.priority} /></div>
                    </td>
                    <td className={`px-4 py-2 tabular-nums whitespace-nowrap ${!done && due.overdue ? "text-destructive" : ""}`}>
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
