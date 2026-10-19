import { EpistemicTag } from "@/components/ui/epistemic";

export interface Recommendation {
  title: string;
  dataUsed: string;
  sample: string;
  period: string;
  facts: string[];
  hypothesis: string;
  nextAction: string;
  confirmingMetric: string;
}

/** Recommendation card (brief §12): data, sample, period, facts vs hypothesis, next action, confirming metric. */
export function RecommendationCard({ r }: { r: Recommendation }) {
  return (
    <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="flex items-start gap-2"><EpistemicTag kind="recommendation" /><h3 className="text-[14.5px]">{r.title}</h3></div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[150px_1fr]">
        <dt className="text-muted">Data used</dt><dd>{r.dataUsed}</dd>
        <dt className="text-muted">Sample</dt><dd>{r.sample}</dd>
        <dt className="text-muted">Period</dt><dd>{r.period}</dd>
        <dt className="text-muted">Facts</dt><dd><ul className="flex flex-col gap-1">{r.facts.map((f, i) => <li key={i} className="flex items-start gap-2"><EpistemicTag kind="observation" /><span>{f}</span></li>)}</ul></dd>
        <dt className="text-muted">Hypothesis</dt><dd className="flex items-start gap-2"><EpistemicTag kind="hypothesis" /><span>{r.hypothesis}</span></dd>
        <dt className="text-muted">Next action</dt><dd>{r.nextAction}</dd>
        <dt className="text-muted">Confirmed or rejected by</dt><dd>{r.confirmingMetric}</dd>
      </dl>
    </article>
  );
}
