import type { RatedGroup, Verdict } from "@/domain/stats";
import type { Recommendation } from "@/components/content/recommendation";
import { DIMENSIONS, type Dimension } from "./analytics";

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

/**
 * Rule-based recommendations computed from the comparisons (no AI, no invented numbers).
 * A leader yields "make more and confirm"; insufficient data yields "publish more to compare".
 */
export function recommendationsFrom(
  comparisons: Array<{ dim: Dimension; groups: RatedGroup[]; verdict: Verdict }>,
  period: string,
  thresholds: { minPublicationsPerGroup: number; minImpressionsPerGroup: number },
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const c of comparisons) {
    const label = DIMENSIONS[c.dim].toLowerCase();
    const sample = c.groups.map((g) => `${g.label}: ${g.publications} posts, ${g.impressions} exposure`).join("; ");
    if (c.verdict.kind === "leader") {
      const lead = c.groups.find((g) => g.key === (c.verdict as { key: string }).key)!;
      const others = c.groups.filter((g) => g.sufficient && g.key !== lead.key);
      out.push({
        title: `Make more content with ${label} “${lead.label}”`,
        dataUsed: `Latest metrics of published posts grouped by ${label}; clicks divided by exposure (impressions, else reach, else views).`,
        sample,
        period,
        facts: [
          `“${lead.label}”: click rate ${pct(lead.rate)} (95% interval ${pct(lead.interval?.low ?? null)}–${pct(lead.interval?.high ?? null)}).`,
          ...others.map((o) => `“${o.label}”: ${pct(o.rate)} (${pct(o.interval?.low ?? null)}–${pct(o.interval?.high ?? null)}).`),
        ],
        hypothesis: `The ${label} itself drives more clicks for this audience. Timing, topic and platform distribution were not controlled, so this is not proven.`,
        nextAction: `Publish the next 3–5 items with “${lead.label}” while keeping topic and channel comparable, and keep at least one alternative running.`,
        confirmingMetric: `Click rate per exposure stays above the other groups' 95% intervals on the new posts; registrations per click do not fall.`,
      });
    } else if (c.verdict.kind === "not_enough_data" && c.groups.length > 1) {
      const short = c.groups.filter((g) => !g.sufficient);
      out.push({
        title: `Not enough data to compare by ${label}`,
        dataUsed: `Published posts grouped by ${label}.`,
        sample,
        period,
        facts: short.map((g) => `“${g.label}” has ${g.insufficiencyReason}.`),
        hypothesis: "No hypothesis yet: differences at this sample size are likely noise.",
        nextAction: `Publish more items so each ${label} reaches ${thresholds.minPublicationsPerGroup} posts and ${thresholds.minImpressionsPerGroup} exposure.`,
        confirmingMetric: "Not applicable until the minimum sample is reached.",
      });
    }
  }
  return out;
}
