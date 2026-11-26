import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href, tone }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "warn" | "ok";
}) {
  const body = (
    <div className={cn("rounded-lg border bg-card px-3.5 py-3 transition-colors", href && "hover:bg-muted/50")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("tabular mt-1 text-xl font-semibold", tone === "warn" && "text-warning", tone === "ok" && "text-success")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Section({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {actions}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

const tones: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  confirmed: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  arrived: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  in_progress: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  awaiting_approval: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ready: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  completed: "bg-muted text-muted-foreground",
  scheduled: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  no_show: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  unpaid: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  refunded: "bg-muted text-muted-foreground",
  overpaid: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  stored: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  released: "bg-muted text-muted-foreground",
  sent: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  queued: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  dead: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge variant="secondary" className={cn("rounded-md border-0 font-medium", tones[status])}>{label}</Badge>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Native select styled like shadcn inputs: fast, accessible and works without JS. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function DL({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
