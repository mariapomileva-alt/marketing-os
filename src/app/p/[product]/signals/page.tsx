import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { addSignalAction, setSignalStatusAction } from "@/app/actions/research";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatNumber } from "@/lib/format";

export const metadata = { title: "Signals & Research" };

const SORTS = { recent: "s.created_at desc", days_active: "(s.observed_performance->>'days_active')::numeric desc nulls last", platform: "s.platform, s.created_at desc" } as const;
const COLS: Array<[string, string]> = [["persona", "Persona"], ["problem", "Problem"], ["emotional_trigger", "Emotional trigger"], ["hook", "Hook"], ["angle", "Angle"], ["mechanism", "Mechanism"], ["proof", "Proof"], ["body_summary", "Body"], ["cta", "CTA"], ["visual_device", "Visual device"], ["funnel_destination", "Funnel destination"]];

export default async function SignalsPage({ params, searchParams }: PageProps<"/p/[product]/signals">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const sort = (typeof sp.sort === "string" && sp.sort in SORTS ? sp.sort : "recent") as keyof typeof SORTS;
  const platform = typeof sp.platform === "string" ? sp.platform : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const product = await getProduct(slug);
  const d = await db(async (tx) => ({
    rows: await tx.query<Record<string, string> & { id: string; observed_performance: Record<string, number>; competitor: string | null; validation_status: string; url: string | null; observed_on: string | null }>(
      `select s.*, s.observed_on::text, c.name competitor from signals s left join competitors c on c.id = s.competitor_id
        where s.product_id = $1 and ($2 = '' or s.platform = $2) and ($3 = '' or s.validation_status = $3) order by ${SORTS[sort]} limit 500`,
      [product.id, platform, status],
    ),
    competitors: await tx.query<{ id: string; name: string }>("select id, name from competitors where product_id = $1 order by name", [product.id]),
    platforms: await tx.query<{ platform: string }>("select distinct platform from signals where product_id = $1 order by 1", [product.id]),
  }));

  return (
    <>
      <PageHeader
        title="Signals & Research"
        description="Market observations broken down into their structure: persona, problem, trigger, hook, angle, mechanism, proof, CTA. We reuse the structure, never the wording. Performance values are observed proxies, not measured results."
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" action={`/p/${slug}/signals`}>
        <Field label="Platform" htmlFor="f-platform"><Select id="f-platform" name="platform" defaultValue={platform} className="w-40"><option value="">All</option>{d.platforms.map((p) => <option key={p.platform}>{p.platform}</option>)}</Select></Field>
        <Field label="Status" htmlFor="f-status"><Select id="f-status" name="status" defaultValue={status} className="w-40"><option value="">All</option>{["new", "shortlisted", "adapted", "rejected"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Sort by" htmlFor="f-sort"><Select id="f-sort" name="sort" defaultValue={sort} className="w-44"><option value="recent">Recently added</option><option value="days_active">Days active</option><option value="platform">Platform</option></Select></Field>
        <Button type="submit">Apply</Button>
      </form>
      <Section>
        {d.rows.length ? (
          <Table>
            <thead>
              <tr><th>Source</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>Observed proxies</th><th>Adaptation idea</th><th>Status</th></tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className="min-w-[160px]">
                    <div className="font-medium">{r.competitor ?? r.author ?? "Unknown"}</div>
                    <div className="text-[12px] text-muted">{r.platform}{r.observed_on ? `, ${r.observed_on}` : ""}</div>
                    {r.url ? <a href={r.url} target="_blank" rel="noreferrer noopener" className="text-[12px] text-green underline">open</a> : null}
                  </td>
                  {COLS.map(([k]) => <td key={k} className="min-w-[140px] max-w-[220px]">{r[k] || <span className="text-faint">—</span>}</td>)}
                  <td className="min-w-[140px] text-[12.5px] text-muted">
                    {Object.entries(r.observed_performance ?? {}).map(([k, v]) => <div key={k}>{k.replaceAll("_", " ")}: <span className="num">{formatNumber(v, 1)}</span></div>)}
                  </td>
                  <td className="min-w-[180px] max-w-[260px]">{r.adaptation_idea || "—"}</td>
                  <td className="min-w-[140px]">
                    <Status tone={r.validation_status === "adapted" ? "green" : r.validation_status === "rejected" ? "red" : r.validation_status === "shortlisted" ? "amber" : "neutral"}>{r.validation_status}</Status>
                    <div className="mt-1 flex gap-1">
                      {r.validation_status !== "shortlisted" ? <form action={setSignalStatusAction.bind(null, slug, r.id, "shortlisted")}><Button size="sm" variant="ghost">Shortlist</Button></form> : null}
                      {r.validation_status !== "rejected" ? <form action={setSignalStatusAction.bind(null, slug, r.id, "rejected")}><Button size="sm" variant="ghost">Reject</Button></form> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState title="No signals yet">Add creatives and posts you noticed. The table compares 20 or more side by side by structure.</EmptyState>}
      </Section>
      <Section title="Add a signal">
        <ActionForm action={addSignalAction.bind(null, slug)} submitLabel="Save signal" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-4">
          <Field label="Platform" htmlFor="s-platform"><Select id="s-platform" name="platform" required>{["instagram", "threads", "facebook", "tiktok", "youtube", "x", "linkedin", "meta_ads", "google_ads", "web", "other"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Competitor" htmlFor="s-comp"><Select id="s-comp" name="competitor_id"><option value="">Not a competitor</option>{d.competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Author or account" htmlFor="s-author"><Input id="s-author" name="author" /></Field>
          <Field label="Seen on" htmlFor="s-date"><Input id="s-date" name="observed_on" type="date" /></Field>
          <Field label="URL" htmlFor="s-url" className="md:col-span-2"><Input id="s-url" name="url" type="url" /></Field>
          <Field label="Format" htmlFor="s-format"><Input id="s-format" name="format" placeholder="reel, carousel, static" /></Field>
          <Field label="Topic" htmlFor="s-topic"><Input id="s-topic" name="topic" /></Field>
          <Field label="Text (for reference only)" htmlFor="s-text" className="md:col-span-4"><Textarea id="s-text" name="text_content" rows={2} /></Field>
          {COLS.map(([k, l]) => <Field key={k} label={l} htmlFor={`s-${k}`}><Input id={`s-${k}`} name={k} /></Field>)}
          <Field label="Days active" htmlFor="perf_days_active"><Input id="perf_days_active" name="perf_days_active" inputMode="numeric" /></Field>
          <Field label="Views" htmlFor="perf_views"><Input id="perf_views" name="perf_views" inputMode="numeric" /></Field>
          <Field label="Views vs account median" htmlFor="perf_vm"><Input id="perf_vm" name="perf_views_vs_account_median" inputMode="decimal" placeholder="e.g. 3.5" /></Field>
          <Field label="Number of variants" htmlFor="perf_var"><Input id="perf_var" name="perf_variants" inputMode="numeric" /></Field>
          <Field label="Why it is relevant" htmlFor="s-rel" className="md:col-span-2"><Input id="s-rel" name="relevance_reason" /></Field>
          <Field label="Adaptation idea for us" htmlFor="s-adapt" className="md:col-span-2"><Input id="s-adapt" name="adaptation_idea" /></Field>
        </ActionForm>
        <p className="mt-2 text-[12px] text-muted">Competitor list: <Link href={`/p/${slug}/competitors`} className="text-green underline">Competitors</Link>.</p>
      </Section>
    </>
  );
}
