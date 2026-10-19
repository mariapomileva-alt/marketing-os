import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { concludeExperimentAction } from "@/app/actions/experiments";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { EpistemicTag } from "@/components/ui/epistemic";
import { Tabs, tabParam } from "@/components/ui/tabs";
import { formatDate, formatNumber } from "@/lib/format";
import { nowMs } from "@/lib/time";

export const metadata = { title: "Experiments" };

export default async function ExperimentsPage({ params, searchParams }: PageProps<"/p/[product]/experiments">) {
  const { product: slug } = await params;
  const tab = tabParam(await searchParams, ["open", "concluded", "planned"], "open");
  const product = await getProduct(slug);
  const rows = await db((tx) =>
    tx.query<{
      id: string; content_item_id: string; title: string; status: string; hypothesis: string; primary_metric: string; counter_metric: string | null; min_sample: number | null;
      window_days: number; locked_at: string | null; outcome_status: string; conclusion: string; concluded_at: string | null; value: number | null; exposure: number | null; dims: Record<string, string | null>; is_demo: boolean;
      kind: string | null;
    }>(
      `select e.id, e.content_item_id, i.title, i.status, e.hypothesis, e.primary_metric, e.counter_metric, e.min_sample, e.window_days, e.locked_at::text, e.outcome_status,
              e.conclusion, e.concluded_at::text, e.dimensions_snapshot dims, e.is_demo,
              (select coalesce(sum(ml.value), 0)::float from metric_latest ml join publications p on p.id = ml.publication_id where p.content_item_id = i.id and ml.metric = e.primary_metric)
                + (select count(*)::float from conversions c join utm_links u on u.id = c.utm_link_id where u.content_item_id = i.id and c.match_status = 'matched'
                    and c.type = case e.primary_metric when 'registrations' then 'registration' when 'trial_starts' then 'trial_start' when 'payments' then 'payment' else '-' end) value,
              (select coalesce(max(case when ml.metric in ('impressions','reach','views') then ml.value end), 0)::float from metric_latest ml join publications p on p.id = ml.publication_id where p.content_item_id = i.id) exposure,
              (select a.kind from assertions a where a.subject_type = 'experiment' and a.subject_id = e.id order by a.created_at desc limit 1) kind
         from experiments e join content_items i on i.id = e.content_item_id where e.product_id = $1 order by coalesce(e.locked_at, e.created_at) desc`,
      [product.id],
    ),
  );
  const open = rows.filter((r) => r.locked_at && r.outcome_status === "open");
  const concluded = rows.filter((r) => r.outcome_status !== "open");
  const planned = rows.filter((r) => !r.locked_at);
  const now = nowMs();
  return (
    <>
      <PageHeader title="Experiments" description="Every content item is an experiment. Its hypothesis and metrics are set before publishing and locked at publication; you write the conclusion. Only a test with comparable arms can become a confirmed result." />
      <Tabs base={`/p/${slug}/experiments`} current={tab} tabs={[{ id: "open", label: "Running", count: open.length }, { id: "concluded", label: "Concluded", count: concluded.length }, { id: "planned", label: "Not published yet", count: planned.length }]} />
      {tab === "open" ? (
        <Section>
          {open.length ? (
            <div className="flex flex-col gap-4">
              {open.map((e) => {
                const ends = new Date(e.locked_at!).getTime() + e.window_days * 86_400_000;
                const ended = ends < now;
                const enough = e.min_sample ? (e.exposure ?? 0) >= e.min_sample : null;
                return (
                  <article key={e.id} className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-w-0">
                      <Link href={`/p/${slug}/studio/${e.content_item_id}`} className="text-[15px] font-semibold hover:text-green">{e.title}</Link>
                      {e.is_demo ? <span className="ml-2 text-[12px] text-amber">demo</span> : null}
                      <p className="mt-1 flex items-start gap-2 text-[13px]"><EpistemicTag kind="hypothesis" />{e.hypothesis || "No hypothesis written"}</p>
                      <dl className="mt-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[150px_1fr]">
                        <dt className="text-muted">Primary metric</dt><dd>{e.primary_metric.replace("_", " ")}: <span className="num font-medium">{formatNumber(e.value)}</span></dd>
                        <dt className="text-muted">Exposure</dt><dd className="num">{formatNumber(e.exposure)}{enough === false ? <span className="ml-2 text-amber">below the planned minimum of {e.min_sample}</span> : null}</dd>
                        <dt className="text-muted">Window</dt><dd>{e.window_days} days from {formatDate(e.locked_at)}: {ended ? <Status tone="amber">ended, needs a conclusion</Status> : <Status>running until {formatDate(new Date(ends))}</Status>}</dd>
                        <dt className="text-muted">Hook / angle</dt><dd>{e.dims.hook ?? "—"} / {e.dims.angle ?? "—"}</dd>
                        <dt className="text-muted">Counter-metric</dt><dd>{e.counter_metric ?? "not set"}</dd>
                      </dl>
                    </div>
                    <ActionForm action={concludeExperimentAction.bind(null, slug, e.id)} submitLabel="Save conclusion" className="flex flex-col gap-2">
                      <Field label="Outcome" htmlFor={`o-${e.id}`}><Select id={`o-${e.id}`} name="outcome_status"><option value="inconclusive">Inconclusive</option><option value="supported">Supported</option><option value="not_supported">Not supported</option><option value="stopped">Stopped</option></Select></Field>
                      <Field label="Conclusion" htmlFor={`c-${e.id}`}><Textarea id={`c-${e.id}`} name="conclusion" rows={3} /></Field>
                      <label className="flex items-start gap-2 text-[12.5px] text-muted"><input type="checkbox" name="designed_test" className="mt-0.5" /> This was a designed test with comparable arms (only then can “supported” become a confirmed result).</label>
                    </ActionForm>
                  </article>
                );
              })}
            </div>
          ) : <EmptyState title="No running experiments">Experiments start when content is published.</EmptyState>}
        </Section>
      ) : null}
      {tab === "concluded" ? (
        <Section>
          {concluded.length ? (
            <Table>
              <thead><tr><th>Item</th><th>Outcome</th><th>Conclusion</th><th>Status of the claim</th><th>Concluded</th></tr></thead>
              <tbody>{concluded.map((e) => (
                <tr key={e.id}><td><Link href={`/p/${slug}/studio/${e.content_item_id}`} className="hover:text-green">{e.title}</Link></td>
                  <td>{e.outcome_status.replace("_", " ")}</td><td className="max-w-[420px]">{e.conclusion}</td>
                  <td>{e.kind ? <EpistemicTag kind={e.kind as "observation" | "confirmed_result"} /> : "—"}</td><td className="num whitespace-nowrap">{formatDate(e.concluded_at)}</td></tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="Nothing concluded yet" />}
        </Section>
      ) : null}
      {tab === "planned" ? (
        <Section>
          {planned.length ? (
            <Table>
              <thead><tr><th>Item</th><th>Status</th><th>Hypothesis</th><th>Primary metric</th></tr></thead>
              <tbody>{planned.map((e) => <tr key={e.id}><td><Link href={`/p/${slug}/studio/${e.content_item_id}`} className="hover:text-green">{e.title}</Link></td><td>{e.status.replaceAll("_", " ")}</td><td className="max-w-[420px] text-muted">{e.hypothesis || "—"}</td><td>{e.primary_metric}</td></tr>)}</tbody>
            </Table>
          ) : <EmptyState title="No unpublished experiments" />}
        </Section>
      ) : null}
    </>
  );
}
