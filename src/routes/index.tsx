import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  GitBranch,
  BookOpen,
  Boxes,
  ShieldCheck,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WeCrew ITSM — Governed Service Management Platform" },
      {
        name: "description",
        content:
          "Incident, request, change, knowledge, and CMDB management with role-based access, SLA tracking, and immutable audit history.",
      },
      { property: "og:title", content: "WeCrew ITSM — Governed Service Management Platform" },
      {
        property: "og:description",
        content:
          "One workspace for service desk, engineering, change advisory, and leadership, with server-enforced permissions.",
      },
    ],
  }),
  component: Landing,
});

const capabilities = [
  {
    icon: AlertTriangle,
    title: "Incident & major incident",
    text: "Intake, impact and urgency priority, assignment groups, SLA timers, and resolution evidence.",
  },
  {
    icon: ClipboardList,
    title: "Service request & catalog",
    text: "Catalog items with entitlement rules, approvals, fulfillment tasks, and requester visibility.",
  },
  {
    icon: GitBranch,
    title: "Change enablement",
    text: "Standard, normal, and emergency change with risk, CAB approval, windows, and rollback plans.",
  },
  {
    icon: BookOpen,
    title: "Knowledge",
    text: "Draft, review, and publish articles that resolve repeat demand and support deflection.",
  },
  {
    icon: Boxes,
    title: "Assets & CMDB",
    text: "Configuration items, ownership, lifecycle state, service mapping, and typed relationships.",
  },
  {
    icon: ShieldCheck,
    title: "Governance & audit",
    text: "Role-based access enforced on the server, with immutable activity history on every record.",
  },
];

function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.user));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-primary font-mono text-sm font-semibold text-primary-foreground">
              W
            </span>
            <span className="text-sm font-semibold tracking-tight">WeCrew ITSM</span>
          </div>
          {signedIn ? (
            <Button asChild size="sm">
              <Link to="/dashboard">Open workspace</Link>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth" search={{ redirect: "/dashboard", mode: "signin" }}>
                  Sign in
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/auth" search={{ redirect: "/dashboard", mode: "signup" }}>
                  Create account
                </Link>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Enterprise service management
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
              One system of record for every service commitment.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              WeCrew ITSM brings the service desk, engineering, change advisory, asset owners, and
              leadership into a single governed workspace, with permissions enforced on the server
              and every state change recorded for audit.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link
                  to="/auth"
                  search={{ redirect: "/dashboard", mode: signedIn ? "signin" : "signup" }}
                >
                  {signedIn ? "Continue to workspace" : "Get started"}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#capabilities">See capabilities</a>
              </Button>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-border pt-6">
              {[
                ["Priority model", "Impact x urgency"],
                ["Approvals", "Request & CAB"],
                ["Evidence", "Immutable audit"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Operations snapshot
            </p>
            <div className="mt-4 space-y-3">
              {[
                ["INC0012847", "Checkout latency above threshold", "P1 Critical", "SLA at risk"],
                ["CHG0004182", "Upgrade production ingress", "High risk", "Awaiting CAB"],
                ["REQ0001004", "Application access", "Approval", "Pending manager"],
              ].map(([id, title, tag, state]) => (
                <div
                  key={id}
                  className="rounded-lg border border-border bg-background px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">{id}</span>
                    <span className="text-xs font-medium text-foreground">{tag}</span>
                  </div>
                  <p className="mt-1 font-medium text-foreground">{title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{state}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="capabilities" className="border-t border-border bg-card/60">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Built around the service lifecycle
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((item) => (
                <div key={item.title} className="rounded-lg border border-border bg-card p-5">
                  <item.icon className="h-5 w-5 text-primary" aria-hidden />
                  <h3 className="mt-3 text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted-foreground">
          WeCrew ITSM — service management workspace for regulated operations teams.
        </div>
      </footer>
    </div>
  );
}
