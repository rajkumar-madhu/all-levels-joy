import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getIncidentLinks } from "@/lib/change-links.functions";

export function IncidentLinkedRecords({ incidentId }: { incidentId: string }) {
  const query = useQuery({
    queryKey: ["incident-links", incidentId],
    queryFn: () => getIncidentLinks({ data: { incidentId } }),
  });
  const data = query.data;
  return (
    <section className="space-y-2 rounded-md border border-border bg-background p-3">
      <h3 className="text-sm font-semibold text-foreground">Linked records</h3>
      {query.isPending ? (
        <p className="text-xs text-muted-foreground">Loading linked records…</p>
      ) : query.isError ? (
        <p className="text-xs text-destructive">Linked records could not be loaded.</p>
      ) : data!.changes.length === 0 && !data!.problem ? (
        <p className="text-xs text-muted-foreground">No changes or problems linked yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {data!.changes.map((c) => (
            <li key={c.linkId} className="py-2">
              <Link
                to="/changes"
                search={{ record: c.id } as never}
                className="font-mono text-xs text-primary underline underline-offset-4"
              >
                {c.number}
              </Link>
              <span className="ml-2 text-foreground">{c.title}</span>
              <p className="text-xs capitalize text-muted-foreground">
                Change · {c.state.replace("_", " ")} · {c.risk} risk ·{" "}
                {c.relation.replace("_", " ")}
              </p>
            </li>
          ))}
          {data!.problem ? (
            <li className="py-2">
              <Link
                to="/problems"
                search={{ record: data!.problem.id } as never}
                className="font-mono text-xs text-primary underline underline-offset-4"
              >
                {data!.problem.number}
              </Link>
              <span className="ml-2 text-foreground">{data!.problem.title}</span>
              <p className="text-xs capitalize text-muted-foreground">
                Problem · {data!.problem.state.replace("_", " ")}
              </p>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
