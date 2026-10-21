import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useCatalog, useCreateRequest } from "@/api/hooks";
import type { CatalogItem } from "@/api/types";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime } from "@/lib/format";

export function CatalogPage() {
  const workspace = useWorkspace();
  const catalog = useCatalog(workspace.id);
  const [selected, setSelected] = useState<CatalogItem | null>(null);

  const groups = new Map<string, CatalogItem[]>();
  for (const item of catalog.data ?? []) {
    const key = item.category || "Other";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <>
      <PageHeader eyebrow="ITSM" title="Service catalogue" description="Ask for hardware, software and access. Some items need a manager's approval first." />
      {catalog.isPending ? (
        <StateMessage kind="loading">Loading the catalogue…</StateMessage>
      ) : catalog.isError ? (
        <StateMessage kind="error">{catalog.error.message}</StateMessage>
      ) : catalog.data.length === 0 ? (
        <StateMessage kind="empty">No catalogue items are available yet.</StateMessage>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="grid gap-6">
            {[...groups].map(([category, items]) => (
              <section key={category} className="grid gap-2">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{category}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map((item) => (
                    <button key={item.id} onClick={() => setSelected(item)} className="text-left">
                      <Panel className={`grid h-full gap-2 p-4 hover:border-primary ${selected?.id === item.id ? "border-primary" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold">{item.name}</span>
                          {item.approval_required && (
                            <Badge tone="warn">
                              <ShieldCheck className="mr-1 inline size-3" aria-hidden />
                              Approval
                            </Badge>
                          )}
                        </div>
                        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                        <p className="text-xs text-muted-foreground">
                          Usually delivered in {item.delivery_days} {item.delivery_days === 1 ? "day" : "days"}
                          {item.group_name ? ` by ${item.group_name}` : ""}
                        </p>
                      </Panel>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {selected && <RequestForm key={selected.id} item={selected} orgId={workspace.id} onClose={() => setSelected(null)} />}
        </div>
      )}
    </>
  );
}

function RequestForm({ item, orgId, onClose }: { item: CatalogItem; orgId: string; onClose: () => void }) {
  const create = useCreateRequest(orgId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({ catalogItemId: item.id, title: String(form.get("title")), description: String(form.get("description")) });
  };

  if (create.data)
    return (
      <Panel className="grid gap-3 p-4 text-sm lg:sticky lg:top-20">
        <p>
          <Link className="font-mono text-primary underline" to={`/requests/${create.data.id}`}>
            {create.data.number}
          </Link>{" "}
          was submitted{item.approval_required ? " and is waiting for approval" : ""}.
        </p>
        {create.data.dueAt && <p className="text-muted-foreground">Target date: {formatDateTime(create.data.dueAt)}</p>}
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </Panel>
    );

  return (
    <Panel className="p-4 lg:sticky lg:top-20">
      <form className="grid gap-4" onSubmit={submit}>
        <h2 className="font-semibold">Request: {item.name}</h2>
        <Field label="Summary">
          <Input id="request-title" name="title" required minLength={5} maxLength={160} defaultValue={item.name} />
        </Field>
        <Field label="Details" hint="Who it's for, when it's needed, and anything the team should know.">
          <Textarea id="request-description" name="description" required minLength={5} maxLength={6000} rows={4} />
        </Field>
        <FormError error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={create.isPending}>Submit request</Button>
        </div>
      </form>
    </Panel>
  );
}
