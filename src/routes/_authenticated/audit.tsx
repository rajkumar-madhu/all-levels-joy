import { createFileRoute } from "@tanstack/react-router";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { formatDateTime } from "@/lib/itsm-shared";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit trail — Argus Service Desk" },
      {
        name: "description",
        content:
          "Immutable record of every create, update, approval, and comment across the workspace.",
      },
      { property: "og:title", content: "Audit trail — Argus Service Desk" },
      {
        property: "og:description",
        content: "Immutable workspace activity history for compliance review.",
      },
    ],
  }),
  component: Audit,
});

function Audit() {
  const workspace = useWorkspace();
  const data = workspace.data;
  const events = data?.audit ?? [];

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Compliance"
        title="Audit trail"
        description="Entries cannot be edited or deleted, by anyone, including administrators."
      />

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : events.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No audit entries yet"
            hint="Activity appears here as records are worked."
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Record</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-muted/60">
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {formatDateTime(event.created_at)}
                  </td>
                  <td className="px-4 py-2.5 capitalize text-foreground">{event.record_type}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{event.action}</td>
                  <td className="px-4 py-2.5 text-xs capitalize text-muted-foreground">
                    {event.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
