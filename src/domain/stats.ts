/**
 * Statistics used by Analytics. All numbers shown to the owner come from here or from SQL —
 * never from a language model ("the model does not count").
 */
export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval for a binomial proportion (default 95%). */
export function wilson(successes: number, trials: number, z = 1.959963984540054): Interval | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) return null;
  if (successes < 0 || successes > trials) throw new RangeError("successes must be between 0 and trials");
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export interface Thresholds {
  minPublicationsPerGroup: number;
  minImpressionsPerGroup: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { minPublicationsPerGroup: 5, minImpressionsPerGroup: 1000 };

export interface GroupStats {
  key: string;
  label: string;
  publications: number;
  impressions: number;
  successes: number; // numerator of the rate being compared (e.g. clicks)
}

export type Verdict =
  | { kind: "not_enough_data"; reason: string }
  | { kind: "no_difference"; reason: string }
  | { kind: "leader"; key: string; reason: string };

export interface RatedGroup extends GroupStats {
  rate: number | null;
  interval: Interval | null;
  sufficient: boolean;
  insufficiencyReason: string | null;
}

export function rateGroups(groups: GroupStats[], t: Thresholds = DEFAULT_THRESHOLDS): RatedGroup[] {
  return groups.map((g) => {
    const reasons: string[] = [];
    if (g.publications < t.minPublicationsPerGroup) reasons.push(`${g.publications} of ${t.minPublicationsPerGroup} publications`);
    if (g.impressions < t.minImpressionsPerGroup) reasons.push(`${g.impressions} of ${t.minImpressionsPerGroup} impressions`);
    return {
      ...g,
      rate: g.impressions > 0 ? g.successes / g.impressions : null,
      interval: g.impressions > 0 ? wilson(Math.min(g.successes, g.impressions), g.impressions) : null,
      sufficient: reasons.length === 0,
      insufficiencyReason: reasons.length ? reasons.join(", ") : null,
    };
  });
}

/**
 * Declares a leader only when at least two groups meet the sample thresholds and the best group's
 * 95% interval does not overlap any other sufficient group's interval. Otherwise: not enough data / no difference.
 */
export function compareGroups(groups: GroupStats[], t: Thresholds = DEFAULT_THRESHOLDS): { groups: RatedGroup[]; verdict: Verdict } {
  const rated = rateGroups(groups, t);
  const ok = rated.filter((g) => g.sufficient && g.interval);
  if (ok.length < 2) {
    return { groups: rated, verdict: { kind: "not_enough_data", reason: `Need at least two groups with ≥ ${t.minPublicationsPerGroup} publications and ≥ ${t.minImpressionsPerGroup} impressions.` } };
  }
  const sorted = [...ok].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const best = sorted[0];
  const overlaps = sorted.slice(1).some((g) => g.interval!.high >= best.interval!.low);
  if (overlaps) {
    return { groups: rated, verdict: { kind: "no_difference", reason: "The 95% intervals overlap; the difference may be noise." } };
  }
  return { groups: rated, verdict: { kind: "leader", key: best.key, reason: "Best group's 95% interval does not overlap the others. This is an observation, not proof of cause." } };
}

export function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Cost per result; null when spend or results are missing (never shown as 0). */
export function costPer(spend: number | null, results: number): number | null {
  if (spend === null || spend <= 0 || results <= 0) return null;
  return spend / results;
}
