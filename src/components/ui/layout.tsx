import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions, flags }: { title: string; description?: ReactNode; actions?: ReactNode; flags?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1>{title}</h1>
          {flags}
        </div>
        {description ? <p className="prose-measure mt-1.5 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-8", className)}>
      {title ? (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[var(--radius-panel)] border border-line bg-surface", className)}>{children}</div>;
}

/** An empty screen is an invitation to act: say what this is for and what to do first. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface/60 px-6 py-10">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children ? <div className="prose-measure mt-1.5 text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface", className)}>
      <table className="w-full border-collapse text-left text-[13px] [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-paper/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-[12px] [&_th]:font-medium [&_th]:text-muted [&_th]:whitespace-nowrap">
        {children}
      </table>
    </div>
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
