import { clsx } from "clsx";
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Styles follow the existing app's components (src/components/ui, status-badge.tsx) and its tokens.

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger"; busy?: boolean };

export function Button({ variant = "primary", busy, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "secondary" && "border border-input bg-card text-foreground shadow-xs hover:bg-accent",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        className,
      )}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Same outlined badge treatment as the existing StateBadge/PriorityBadge. */
const tones = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  muted: "border-border bg-muted text-muted-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
  good: "border-success/40 bg-success/15 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", mono, children }: { tone?: Tone; mono?: boolean; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        mono && "font-mono",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("rounded-md border border-border bg-card shadow-xs", className)}>{children}</section>;
}

export function StateMessage({ kind, children }: { kind: "loading" | "error" | "empty"; children: ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" || undefined}
      className={clsx(
        "flex items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm",
        kind === "error" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground",
      )}
    >
      {kind === "loading" && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </div>
  );
}

const control =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={clsx(control, "h-9 py-0", props.className)} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...props} className={clsx(control, props.className)} />
);
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={clsx(control, "h-9 py-0", props.className)} />;

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : "Something went wrong. Try again."}
    </p>
  );
}

/** Table header cell matching the existing workbench (muted band, uppercase label). */
export const th = "bg-muted px-4 py-2.5 text-left text-[11px] font-semibold tracking-[0.06em] text-foreground uppercase";
