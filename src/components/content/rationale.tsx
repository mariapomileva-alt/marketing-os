import { EpistemicTag } from "@/components/ui/epistemic";

/** The seven explanations every AI variant carries (brief §9). The intended outcome is a hypothesis, never a prediction. */
export function Rationale({ r }: { r: Record<string, unknown> }) {
  const claims = Array.isArray(r.claims_to_verify) ? (r.claims_to_verify as string[]) : [];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[130px_1fr]">
      <dt className="text-muted">For whom</dt><dd>{String(r.for_whom ?? "—")}</dd>
      <dt className="text-muted">Addresses</dt><dd>{String(r.addresses ?? "—")}</dd>
      <dt className="text-muted">Insight from</dt><dd>{String(r.insight_source ?? "—")}</dd>
      <dt className="text-muted">Differs by</dt><dd>{String(r.difference ?? "—")}</dd>
      <dt className="text-muted">Claims to verify</dt><dd>{claims.length ? claims.join("; ") : "None listed"}</dd>
      <dt className="text-muted">Brand risk</dt><dd>{String(r.brand_risk ?? "—")}</dd>
      <dt className="text-muted">Intended outcome</dt><dd className="flex items-start gap-2"><EpistemicTag kind="hypothesis" /><span>{String(r.intended_outcome ?? "—")}</span></dd>
    </dl>
  );
}
