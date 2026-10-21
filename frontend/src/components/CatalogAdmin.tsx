import { useCatalogAdmin, useUpdateCatalogItem, type CatalogAdminItem } from "@/api/cmdb";
import { useGroups } from "@/api/hooks";
import { priorityLabel } from "@/lib/format";
import { Badge, FormError, Panel, Select, StateMessage, th } from "./ui";

/** Routing and availability for every catalogue item (legacy updateCatalogRouting), for managers and admins. */
export function CatalogAdmin({ orgId }: { orgId: string }) {
  const items = useCatalogAdmin(orgId, true);
  const groups = useGroups(orgId, true);
  const update = useUpdateCatalogItem(orgId);
  const save = (item: CatalogAdminItem, patch: { groupId?: string | null; priority?: number; approvalRequired?: boolean; active?: boolean }) =>
    update.mutate({ id: item.id, expectedUpdatedAt: item.updated_at, ...patch });

  if (items.isPending) return <StateMessage kind="loading">Loading catalogue settings…</StateMessage>;
  if (items.isError) return <StateMessage kind="error">{items.error.message}</StateMessage>;
  return (
    <Panel className="overflow-x-auto">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Manage catalogue</h2>
        <p className="text-xs text-muted-foreground">Routing applies to new requests. Retired items disappear from the catalogue but keep their history.</p>
        <FormError error={update.error} />
      </div>
      <table className="w-full min-w-[48rem] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={th}>Item</th>
            <th className={th}>Assignment group</th>
            <th className={th}>Priority</th>
            <th className={th}>Approval</th>
            <th className={th}>Availability</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.data.map((item) => (
            <tr key={item.id} className={item.active ? "" : "text-muted-foreground"}>
              <td className="px-4 py-2.5">
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.category ?? "Other"} · {item.delivery_days} days</p>
              </td>
              <td className="px-4 py-2.5">
                <Select
                  aria-label={`Assignment group for ${item.name}`}
                  value={item.default_group_id ?? ""}
                  disabled={update.isPending}
                  onChange={(e) => save(item, { groupId: e.target.value || null })}
                >
                  <option value="">No default group</option>
                  {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </td>
              <td className="px-4 py-2.5">
                <Select
                  aria-label={`Priority for ${item.name}`}
                  value={String(item.default_priority ?? 3)}
                  disabled={update.isPending}
                  onChange={(e) => save(item, { priority: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                </Select>
              </td>
              <td className="px-4 py-2.5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.approval_required}
                    disabled={update.isPending}
                    onChange={(e) => save(item, { approvalRequired: e.target.checked })}
                  />
                  Manager approval
                </label>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone={item.active ? "good" : "muted"}>{item.active ? "Available" : "Retired"}</Badge>
                  <button className="text-xs text-primary underline" disabled={update.isPending} onClick={() => save(item, { active: !item.active })}>
                    {item.active ? "Retire" : "Restore"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
