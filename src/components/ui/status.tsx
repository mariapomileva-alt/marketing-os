import { cn } from "@/lib/cn";

type Tone = "neutral" | "green" | "amber" | "red" | "slate";

const dot: Record<Tone, string> = { neutral: "bg-faint", green: "bg-green", amber: "bg-amber", red: "bg-red", slate: "bg-slate" };

/** Small dot + label. Colour is never the only carrier of meaning: the label always says the state. */
export function Status({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-ink", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dot[tone])} />
      {children}
    </span>
  );
}

export const CONTENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ai_review: { label: "AI review", tone: "slate" },
  needs_human_review: { label: "Needs your review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  scheduled: { label: "Scheduled", tone: "green" },
  published: { label: "Published", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  archived: { label: "Archived", tone: "neutral" },
};

export function ContentStatus({ status }: { status: string }) {
  const s = CONTENT_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Status tone={s.tone}>{s.label}</Status>;
}

/** Marks for mock, demo and test data (brief §19: label mock, demo and production functionality). */
export function DataFlag({ kind }: { kind: "mock" | "demo" | "test" | "planned" }) {
  const map = {
    mock: ["Mock AI", "border-slate/40 text-slate bg-slate-tint"],
    demo: ["Demo data", "border-amber/40 text-amber bg-amber-tint"],
    test: ["Test data", "border-amber/40 text-amber bg-amber-tint"],
    planned: ["Planned", "border-line-strong text-muted bg-paper"],
  } as const;
  const [label, cls] = map[kind];
  return <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11.5px] font-medium", cls)}>{label}</span>;
}
