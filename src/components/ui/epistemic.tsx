import { cn } from "@/lib/cn";

/**
 * Epistemic status tag (brief §3): fact, verbatim quote, observation, hypothesis, recommendation,
 * confirmed result. Each has a distinct shape as well as colour, so they are told apart at a glance
 * and in greyscale: facts are solid, quotes carry quote marks, hypotheses are dashed, recommendations
 * are outlined in green, observations are plain, confirmed results are solid green.
 */
export type EpistemicKind = "fact" | "quote" | "observation" | "hypothesis" | "recommendation" | "confirmed_result";

const style: Record<EpistemicKind, { label: string; cls: string }> = {
  fact: { label: "Fact", cls: "bg-ink text-white border-ink" },
  quote: { label: "“Quote”", cls: "bg-surface text-ink border-ink/60" },
  observation: { label: "Observation", cls: "bg-slate-tint text-slate border-transparent" },
  hypothesis: { label: "Hypothesis", cls: "bg-surface text-amber border-amber border-dashed" },
  recommendation: { label: "Recommendation", cls: "bg-surface text-green border-green" },
  confirmed_result: { label: "Confirmed result", cls: "bg-green text-white border-green" },
};

export function EpistemicTag({ kind, className }: { kind: EpistemicKind; className?: string }) {
  const s = style[kind];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-[4px] border px-1.5 text-[11.5px] font-medium", s.cls, className)}>{s.label}</span>;
}
