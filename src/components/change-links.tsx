import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getChangeLinks, setChangeLink } from "@/lib/change-links.functions";
import { Button } from "@/components/ui/button";

const RELATIONS: Record<string, string> = {
  resolves: "Resolves",
  caused_by: "Caused by this change",
  related: "Related",
};

export function ChangeLinks({ changeId, canEdit }: { changeId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const key = ["change-links", changeId];
  const query = useQuery({ queryKey: key, queryFn: () => getChangeLinks({ data: { changeId } }) });
  const [type, setType] = useState<"incident" | "problem">("incident");
  const [recordId, setRecordId] = useState("");
  const [relation, setRelation] = useState("resolves");

  const mutate = useMutation({
    mutationFn: (input: {
      recordType: "incident" | "problem";
      recordId: string;
      relation?: string;
      linked: boolean;
    }) => setChangeLink({ data: { changeId, ...input } }),
    onSuccess: async (_r, input) => {
      toast.success(input.linked ? "Record linked." : "Link removed.");
      setRecordId("");
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["incident-links"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Link was not saved."),
  });

  const data = query.data;
  const options = type === "incident" ? (data?.incidents ?? []) : (data?.problems ?? []);
  const lookup = (t: string, id: string) =>
    (t === "incident" ? data?.incidents : data?.problems)?.find((r) => r.id === id);

  return (
    <section className="space-y-3 rounded-md border border-border bg-background p-3">
      <h3 className="text-sm font-semibold text-foreground">Linked incidents and problems</h3>
      {query.isPending ? (
        <p className="text-xs text-muted-foreground">Loading links…</p>
      ) : query.isError ? (
        <p className="text-xs text-destructive">Links could not be loaded.</p>
      ) : data!.links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No incidents or problems linked yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {data!.links.map((link) => {
            const rec = lookup(link.record_type, link.record_id);
            return (
              <li key={link.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link
                    to={link.record_type === "incident" ? "/incidents" : "/problems"}
                    search={{ record: link.record_id } as never}
                    className="font-mono text-xs text-primary underline underline-offset-4"
                  >
                    {rec?.number ?? link.record_type}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {RELATIONS[link.relation] ?? link.relation}
                  </span>
                  <p className="truncate text-foreground">{rec?.title}</p>
                </div>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={mutate.isPending}
                    onClick={() =>
                      mutate.mutate({
                        recordType: link.record_type as "incident" | "problem",
                        recordId: link.record_id,
                        linked: false,
                      })
                    }
                  >
                    Unlink
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && data ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (recordId) mutate.mutate({ recordType: type, recordId, relation, linked: true });
          }}
        >
          <select
            aria-label="Record type"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={type}
            onChange={(e) => {
              setType(e.target.value as "incident" | "problem");
              setRecordId("");
            }}
          >
            <option value="incident">Incident</option>
            <option value="problem">Problem</option>
          </select>
          <select
            aria-label="Record"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
          >
            <option value="">Choose a record</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} — {r.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Relationship"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
          >
            {Object.entries(RELATIONS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <Button size="sm" type="submit" disabled={!recordId || mutate.isPending}>
            Link
          </Button>
        </form>
      ) : null}
    </section>
  );
}
