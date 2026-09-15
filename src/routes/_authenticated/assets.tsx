import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { saveConfigurationItem } from "@/lib/itsm.functions";
import { referenceQuery } from "@/lib/workspace-queries";
import { formatDateTime, type AppRole } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/assets")({
  head: () => ({
    meta: [
      { title: "Assets & CMDB — WeCrew ITSM" },
      {
        name: "description",
        content: "Configuration items with class, environment, criticality, service mapping, and relationships.",
      },
      { property: "og:title", content: "Assets & CMDB — WeCrew ITSM" },
      { property: "og:description", content: "Configuration items, ownership, and service relationships." },
    ],
  }),
  component: Assets,
});

const emptyCi = {
  id: null as string | null,
  name: "",
  ciClass: "Server",
  environment: "production",
  status: "operational",
  criticality: "medium",
  location: "",
  serviceId: "",
};

function Assets() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<typeof emptyCi | null>(null);

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const canEdit = roles.some((role) => ["cmdb_manager", "admin"].includes(role));
  const assets = reference.data?.assets ?? [];
  const services = reference.data?.services ?? [];
  const relationships = reference.data?.relationships ?? [];

  const save = useMutation({
    mutationFn: () =>
      saveConfigurationItem({
        data: {
          id: editor?.id ?? null,
          name: editor?.name ?? "",
          ciClass: editor?.ciClass ?? "Server",
          environment: editor?.environment ?? "",
          status: editor?.status ?? "operational",
          criticality: editor?.criticality ?? "medium",
          location: editor?.location ?? "",
          serviceId: editor?.serviceId || null,
        },
      }),
    onSuccess: async () => {
      toast.success("Configuration item saved.");
      setEditor(null);
      await queryClient.invalidateQueries({ queryKey: ["reference"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The configuration item was not saved."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Configuration management"
        title="Assets & CMDB"
        description="The CMDB gives incidents and changes their service context: what is affected, how critical it is, and who owns it."
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setEditor(editor ? null : { ...emptyCi })}>
              {editor ? "Cancel" : "New item"}
            </Button>
          ) : null
        }
      />

      {editor ? (
        <form
          className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ci-name">Name</Label>
            <Input
              id="ci-name"
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              required
              minLength={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-class">Class</Label>
            <Input
              id="ci-class"
              value={editor.ciClass}
              onChange={(event) => setEditor({ ...editor, ciClass: event.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-env">Environment</Label>
            <Input
              id="ci-env"
              value={editor.environment}
              onChange={(event) => setEditor({ ...editor, environment: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-location">Location</Label>
            <Input
              id="ci-location"
              value={editor.location}
              onChange={(event) => setEditor({ ...editor, location: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-status">Lifecycle status</Label>
            <select
              id="ci-status"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={editor.status}
              onChange={(event) => setEditor({ ...editor, status: event.target.value })}
            >
              {["operational", "degraded", "maintenance", "retired"].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-criticality">Criticality</Label>
            <select
              id="ci-criticality"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={editor.criticality}
              onChange={(event) => setEditor({ ...editor, criticality: event.target.value })}
            >
              {["low", "medium", "high", "critical"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ci-service">Supports service</Label>
            <select
              id="ci-service"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={editor.serviceId}
              onChange={(event) => setEditor({ ...editor, serviceId: event.target.value })}
            >
              <option value="">Not mapped</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              Save item
            </Button>
          </div>
        </form>
      ) : null}

      {reference.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : assets.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No configuration items" hint="Add the infrastructure that supports your services." />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Class</th>
                <th className="px-4 py-2.5 font-medium">Environment</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Criticality</th>
                <th className="px-4 py-2.5 font-medium">Service</th>
                <th className="px-4 py-2.5 font-medium">Relationships</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
                {canEdit ? <th className="px-4 py-2.5 font-medium">Edit</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assets.map((asset) => {
                const links = relationships.filter(
                  (rel) => rel.parent_id === asset.id || rel.child_id === asset.id,
                ).length;
                const service = services.find((item) => item.id === asset.service_id);
                return (
                  <tr key={asset.id} className="hover:bg-muted/60">
                    <td className="px-4 py-2.5 font-medium text-foreground">{asset.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{asset.ci_class}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{asset.environment ?? "—"}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{asset.status}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{asset.criticality}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{service?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{links}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(asset.updated_at)}
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          className="text-xs text-primary underline underline-offset-4"
                          onClick={() =>
                            setEditor({
                              id: asset.id,
                              name: asset.name,
                              ciClass: asset.ci_class,
                              environment: asset.environment ?? "",
                              status: asset.status,
                              criticality: asset.criticality,
                              location: asset.location ?? "",
                              serviceId: asset.service_id ?? "",
                            })
                          }
                        >
                          Edit
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
