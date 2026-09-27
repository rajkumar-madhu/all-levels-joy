import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StateBadge } from "@/components/status-badge";
import { RecordActivity } from "@/components/record-activity";
import { createServiceRequest, updateServiceRequest } from "@/lib/itsm.functions";
import { referenceQuery } from "@/lib/workspace-queries";
import {
  STATE_LABELS,
  canManage,
  formatDateTime,
  type AppRole,
  type RecordState,
} from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/requests")({
  validateSearch: z.object({ record: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Service requests — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Order from the service catalog and track approvals, fulfillment tasks, and delivery dates.",
      },
      { property: "og:title", content: "Service requests — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Catalog ordering with approvals and fulfillment tracking.",
      },
    ],
  }),
  component: Requests,
});

function Requests() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [catalogItemId, setCatalogItemId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ordering, setOrdering] = useState(false);

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const manager = canManage(roles);
  const requests = data?.requests ?? [];
  const selected = requests.find((item) => item.id === search.record) ?? null;
  const catalog = reference.data?.catalog ?? [];

  const create = useMutation({
    mutationFn: () => createServiceRequest({ data: { catalogItemId, title, description } }),
    onSuccess: async (request) => {
      toast.success(`Request ${request.number} submitted.`);
      setOrdering(false);
      setTitle("");
      setDescription("");
      setCatalogItemId("");
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/requests", search: { record: request.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The request was not submitted."),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; state: RecordState; expectedUpdatedAt: string }) =>
      updateServiceRequest({ data: input }),
    onSuccess: async () => {
      toast.success("Request updated.");
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That update was not applied."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Service catalog"
        title="Service requests"
        description="Catalog items carry their own approval rules and delivery commitments."
        actions={
          <Button size="sm" onClick={() => setOrdering((value) => !value)}>
            {ordering ? "Cancel" : "New request"}
          </Button>
        }
      />

      {ordering ? (
        <form
          className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="item">Catalog item</Label>
            <select
              id="item"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={catalogItemId}
              onChange={(event) => setCatalogItemId(event.target.value)}
              required
            >
              <option value="">Choose an item</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.category} — {item.name}
                  {item.approval_required ? " (approval required)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-title">What do you need</Label>
            <Input
              id="req-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-description">Details</Label>
            <Textarea
              id="req-description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              minLength={5}
              required
            />
          </div>
          <div>
            <Button type="submit" disabled={create.isPending}>
              Submit request
            </Button>
          </div>
        </form>
      ) : null}

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : requests.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No service requests yet"
            hint="Order something from the catalog to see it tracked here."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Request</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map((request) => (
                  <tr
                    key={request.id}
                    className={request.id === search.record ? "bg-accent/40" : "hover:bg-muted/60"}
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary underline underline-offset-4"
                        onClick={() =>
                          void navigate({ to: "/requests", search: { record: request.id } })
                        }
                      >
                        {request.number}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{request.title}</td>
                    <td className="px-4 py-2.5">
                      <StateBadge state={request.state} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(request.due_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="rounded-lg border border-border bg-card p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a request number to see its details and fulfillment history.
              </p>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{selected.number}</p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
                  <div className="mt-2">
                    <StateBadge state={selected.state} />
                  </div>
                  {selected.approval_status === "requested" ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                      Awaiting approval from every assigned approver. Fulfillment starts after all
                      decisions are approved.
                    </p>
                  ) : selected.approval_status === "rejected" ? (
                    <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                      This request was rejected. Submit a new request if the requirements change.
                    </p>
                  ) : null}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Submitted</dt>
                    <dd className="mt-0.5 text-foreground">
                      {formatDateTime(selected.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Committed by</dt>
                    <dd className="mt-0.5 text-foreground">{formatDateTime(selected.due_at)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Details</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-foreground">
                      {selected.description}
                    </dd>
                  </div>
                </dl>

                {manager && ["approved", "not_required"].includes(selected.approval_status) ? (
                  <div className="flex flex-wrap gap-2 rounded-md border border-border bg-background p-3">
                    {(["open", "in_progress", "resolved", "closed"] as RecordState[]).map(
                      (state) => (
                        <Button
                          key={state}
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            update.mutate({
                              id: selected.id,
                              state,
                              expectedUpdatedAt: selected.updated_at,
                            })
                          }
                          disabled={update.isPending || selected.state === state}
                        >
                          {STATE_LABELS[state]}
                        </Button>
                      ),
                    )}
                  </div>
                ) : null}

                <RecordActivity
                  recordType="request"
                  recordId={selected.id}
                  canPostInternal={manager}
                />
              </div>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
