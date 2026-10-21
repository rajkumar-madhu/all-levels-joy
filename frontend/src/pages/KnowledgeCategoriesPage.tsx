import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useKnowledgeCategories, useSaveCategory, type KnowledgeCategory } from "@/api/knowledge";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { KNOWLEDGE_AUTHOR_ROLES, hasAnyRole } from "@/lib/roles";

export function KnowledgeCategoriesPage() {
  const workspace = useWorkspace();
  const categories = useKnowledgeCategories(workspace.id);
  const [editing, setEditing] = useState<KnowledgeCategory | "new" | null>(null);

  if (!hasAnyRole(workspace.roles, KNOWLEDGE_AUTHOR_ROLES))
    return <StateMessage kind="error">Only knowledge authors can manage categories.</StateMessage>;

  return (
    <>
      <Link to="/knowledge" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Knowledge
      </Link>
      <PageHeader
        title="Knowledge categories"
        description="Renaming a category moves its articles with it. Inactive categories stay on existing articles but can't be chosen for new ones."
        actions={<Button onClick={() => setEditing("new")}>New category</Button>}
      />
      {editing && (
        <CategoryForm key={editing === "new" ? "new" : editing.id} orgId={workspace.id} category={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
      )}
      {categories.isPending ? (
        <StateMessage kind="loading">Loading categories…</StateMessage>
      ) : categories.isError ? (
        <StateMessage kind="error">{categories.error.message}</StateMessage>
      ) : categories.data.length === 0 ? (
        <StateMessage kind="empty">No categories yet.</StateMessage>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Name</th>
                <th className={th}>Description</th>
                <th className={th}>Articles</th>
                <th className={th}>Status</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categories.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.description ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{c.article_count}</td>
                  <td className="px-4 py-2"><Badge tone={c.active ? "good" : "muted"}>{c.active ? "Active" : "Inactive"}</Badge></td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

function CategoryForm({ orgId, category, onDone }: { orgId: string; category?: KnowledgeCategory; onDone: () => void }) {
  const save = useSaveCategory(orgId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    save.mutate(
      {
        ...(category ? { id: category.id } : {}),
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim(),
        active: form.get("active") === "on",
      },
      { onSuccess: onDone },
    );
  };
  return (
    <Panel className="p-5">
      <form className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]" onSubmit={submit}>
        <Field label="Name">
          <Input id="category-name" name="name" required minLength={2} maxLength={60} defaultValue={category?.name} />
        </Field>
        <Field label="Description">
          <Input id="category-description" name="description" maxLength={200} defaultValue={category?.description ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input id="category-active" type="checkbox" name="active" defaultChecked={category?.active ?? true} /> Active
        </label>
        <div className="grid gap-2 md:col-span-2">
          <FormError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" busy={save.isPending}>{category ? "Save category" : "Create category"}</Button>
            <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
