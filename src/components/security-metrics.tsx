import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getSecurityBoard } from "@/lib/security.functions";

const OPEN = ["requested", "pending_approval", "scheduled", "remediating"];

export function SecurityMetrics() {
  const board = useQuery({ queryKey: ["security-board"], queryFn: () => getSecurityBoard() });
  if (board.isPending)
    return <p className="mt-6 text-xs text-muted-foreground">Loading security findings…</p>;
  if (board.isError)
    return <p className="mt-6 text-xs text-destructive">Security findings could not be loaded.</p>;
  const now = Date.now();
  const { findings, exceptions } = board.data;
  const open = findings.filter((f) => OPEN.includes(f.state));
  const cards = [
    {
      label: "Open critical & high findings",
      value: open.filter((f) => ["critical", "high"].includes(f.severity)).length,
      filter: "critical_high" as const,
    },
    {
      label: "Overdue security fixes",
      value: open.filter((f) => Date.parse(f.due_at) < now).length,
      filter: "overdue" as const,
    },
    {
      label: "Exceptions expiring in 30 days",
      value: exceptions.filter(
        (e) => e.status === "approved" && Date.parse(e.expires_at) - now < 30 * 86_400_000,
      ).length,
      filter: "exceptions_expiring" as const,
    },
  ];
  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Security findings">
      {cards.map((c) => (
        <Link
          key={c.filter}
          to="/security"
          search={{ filter: c.filter }}
          className="rounded-lg border border-border bg-card p-3 hover:bg-muted"
        >
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{c.value}</p>
        </Link>
      ))}
    </section>
  );
}
