import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold text-foreground sm:text-[28px] sm:leading-9">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm leading-normal text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="col-span-2 flex shrink-0 flex-wrap items-center gap-2 sm:col-span-1">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}
