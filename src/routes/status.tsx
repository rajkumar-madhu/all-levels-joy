import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, CircleCheck, CircleHelp, CircleAlert, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPublicServiceStatus } from "@/lib/public-status.functions";
import { overallServiceState, serviceState, STATUS_REFRESH_MS, visibleServices, type ServiceState } from "@/lib/service-status";

const statusQuery = queryOptions({
  queryKey: ["public-service-status"],
  queryFn: () => getPublicServiceStatus(),
  refetchInterval: STATUS_REFRESH_MS,
  staleTime: 0,
});

export const Route = createFileRoute("/status")({
  loader: ({ context }) => context.queryClient.ensureQueryData(statusQuery),
  head: () => ({ meta: [
    { title: "Service status — Argus Service Desk" },
    { name: "description", content: "Current reported availability for VPN, payments, ERP and other Argus services." },
    { property: "og:title", content: "Service status — Argus Service Desk" },
    { property: "og:description", content: "Check reported service health and the latest service update times." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ServiceStatusPage,
});

const states = {
  operational: { label: "Operational", color: "text-success", icon: CircleCheck, summary: "All reported services operational" },
  degraded: { label: "Degraded", color: "text-warning", icon: CircleAlert, summary: "Some services are degraded" },
  outage: { label: "Outage", color: "text-destructive", icon: CircleAlert, summary: "Some services are unavailable" },
  maintenance: { label: "Maintenance", color: "text-primary", icon: Wrench, summary: "Service maintenance in progress" },
  unknown: { label: "Unknown", color: "text-muted-foreground", icon: CircleHelp, summary: "Some service statuses are unknown" },
} satisfies Record<ServiceState, { label: string; color: string; icon: typeof CircleCheck; summary: string }>;

function timestamp(value: string | null) {
  if (!value) return "No status received";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No status received" : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function ServiceStatusPage() {
  const query = useSuspenseQuery(statusQuery);
  const available = query.data.available && !query.isError;
  const services = visibleServices(available ? query.data.services : []);
  const overall = states[overallServiceState(services)];
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-5 py-3">
          <Link to="/" className="text-sm font-semibold text-foreground">Argus Service Desk</Link>
          <Button asChild size="sm" variant="outline"><Link to="/portal">Customer portal</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-6">
        <Button asChild size="sm" variant="ghost" className="mb-3"><Link to="/"><ArrowLeft aria-hidden />Home</Link></Button>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-normal">Service status</h1>
          <Button size="icon-sm" variant="outline" aria-label="Refresh service status" title="Refresh service status" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden className={query.isFetching ? "animate-spin motion-reduce:animate-none" : ""} />
          </Button>
        </div>
        <section aria-label="Overall service status" aria-live="polite" className="mt-4 border-y border-border py-4">
          <div className={`flex items-center gap-3 ${available ? overall.color : "text-muted-foreground"}`}>
            {available ? <overall.icon className="h-6 w-6 shrink-0" aria-hidden /> : <CircleHelp className="h-6 w-6 shrink-0" aria-hidden />}
            <h2 className="text-base font-semibold">{available ? overall.summary : "Service status temporarily unavailable"}</h2>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Reported service health · Latest check: {timestamp(query.data.fetchedAt)}</p>
          {!available && <p className="mt-2 text-sm text-muted-foreground">Current status could not be retrieved. Please try again.</p>}
        </section>
        <section aria-label="Services" className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" aria-hidden /><h2>Services</h2></div>
          <ul className="divide-y divide-border border-y border-border bg-card">
            {services.map((service) => {
              const state = states[serviceState(service.status)];
              return <li key={service.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="break-words text-sm font-medium">{service.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{service.updated_at ? `Status updated: ${timestamp(service.updated_at)}` : "Awaiting a status source"}</p>
                </div>
                <span className={`flex shrink-0 items-center gap-2 text-xs font-medium ${state.color}`}><state.icon className="h-4 w-4" aria-hidden />{state.label}</span>
              </li>;
            })}
          </ul>
        </section>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">Having trouble with a service?</p>
          <Button asChild size="sm" variant="outline"><Link to="/portal">Contact service desk</Link></Button>
        </div>
      </main>
    </div>
  );
}