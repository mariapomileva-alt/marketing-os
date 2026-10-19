import Link from "next/link";
import { db, getProduct } from "@/server/context";
import {
  addSpendAction, commitAdsAction, commitConversionsAction, commitMetricsAction, manualMetricsAction, previewAdsAction, previewConversionsAction, previewMetricsAction, revertBatchAction,
} from "@/app/actions/measurement";
import { CsvImport } from "@/components/content/csv-import";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { STUDIO_CHANNELS } from "@/domain/content";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Tabs, tabParam } from "@/components/ui/tabs";

export const metadata = { title: "Publications" };
const SHOWN = ["reach", "views", "saves", "shares", "comments", "clicks"] as const;

export default async function PublicationsPage({ params, searchParams }: PageProps<"/p/[product]/publications">) {
  const { product: slug } = await params;
  const tab = tabParam(await searchParams, ["posts", "import", "history"], "posts");
  const product = await getProduct(slug);
  const d = await db(async (tx) => ({
    pubs: await tx.query<{ id: string; content_item_id: string; title: string; channel: string; external_url: string | null; published_at: string; is_demo: boolean; m: Record<string, number>; last: string | null }>(
      `select p.id, p.content_item_id, i.title, p.channel, p.external_url, p.published_at::text, p.is_demo or i.is_demo is_demo,
              coalesce((select jsonb_object_agg(metric, value) from metric_latest ml where ml.publication_id = p.id), '{}') m,
              (select max(observed_at)::text from metric_latest ml where ml.publication_id = p.id) last
         from publications p join content_items i on i.id = p.content_item_id where p.product_id = $1 order by p.published_at desc`,
      [product.id],
    ),
    batches: await tx.query<{ id: string; kind: string; status: string; source_label: string; stats: Record<string, number>; created_at: string; is_demo: boolean }>(
      "select id, kind, status, source_label, stats, created_at::text, is_demo from import_batches where product_id = $1 order by created_at desc limit 50",
      [product.id],
    ),
    unmatched: await tx.one<{ n: number }>("select count(*)::int n from conversions where product_id = $1 and match_status = 'unmatched'", [product.id]),
  }));
  return (
    <>
      <PageHeader title="Publications" description="Everything that went live, with the latest metrics. Metrics come from manual entry or CSV exports; every import can be undone." />
      <Tabs base={`/p/${slug}/publications`} current={tab} tabs={[{ id: "posts", label: "Published", count: d.pubs.length }, { id: "import", label: "Import data" }, { id: "history", label: "Import history" }]} />

      {tab === "posts" ? (
        <Section>
          {d.pubs.length ? (
            <Table>
              <thead><tr><th>Post</th><th>Channel</th><th>Published</th>{SHOWN.map((m) => <th key={m} className="text-right">{m}</th>)}<th>Add metrics</th></tr></thead>
              <tbody>{d.pubs.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[260px]"><Link href={`/p/${slug}/studio/${p.content_item_id}`} className="font-medium hover:text-green">{p.title}</Link>{p.is_demo ? <span className="ml-2 text-[12px] text-amber">demo</span> : null}
                    {p.external_url ? <a href={p.external_url} target="_blank" rel="noreferrer noopener" className="block truncate text-[12px] text-green">{p.external_url}</a> : null}
                    <span className="text-[12px] text-faint">{p.last ? `metrics as of ${formatDateTime(p.last)}` : "no metrics yet"}</span></td>
                  <td>{STUDIO_CHANNELS[p.channel] ?? p.channel}</td>
                  <td className="num whitespace-nowrap">{formatDateTime(p.published_at)}</td>
                  {SHOWN.map((m) => <td key={m} className="num text-right">{p.m[m] !== undefined ? formatNumber(p.m[m]) : "—"}</td>)}
                  <td className="min-w-[220px]">
                    <details>
                      <summary className="cursor-pointer text-[13px] text-green">Enter numbers</summary>
                      <ActionForm action={manualMetricsAction.bind(null, slug, p.id)} submitLabel="Save" className="mt-2 grid grid-cols-2 gap-2">
                        {(["reach", "impressions", "views", "likes", "saves", "shares", "comments", "clicks"] as const).map((k) => (
                          <Field key={k} label={k} htmlFor={`${p.id}-${k}`}><Input id={`${p.id}-${k}`} name={k} inputMode="numeric" className="h-7" /></Field>
                        ))}
                        <Field label="As of" htmlFor={`${p.id}-at`} className="col-span-2"><Input id={`${p.id}-at`} name="observed_at" type="datetime-local" className="h-7" /></Field>
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="Nothing published yet">Items appear here when you mark approved content as published, with the link to the live post.</EmptyState>}
        </Section>
      ) : null}

      {tab === "import" ? (
        <>
          <Section title="Post metrics (CSV)" description="Instagram, Threads or Facebook insights exports. Rows are matched to publications by the post link.">
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4"><CsvImport kind="metrics" preview={previewMetricsAction} commit={commitMetricsAction.bind(null, slug)} /></div>
          </Section>
          <Section title="Conversions (CSV)" description={`Registrations, trial starts, payments, cancellations and refunds from app analytics or store exports. Matched to tracking links by utm_campaign and utm_content. ${d.unmatched.n ? `${d.unmatched.n} conversions are currently unmatched.` : ""}`}>
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4"><CsvImport kind="conversions" preview={previewConversionsAction} commit={commitConversionsAction.bind(null, slug)} /></div>
          </Section>
          <Section title="Paid ads report (CSV)" description="Meta Ads Manager or Google Ads export with daily rows per ad. Platform-reported results are kept separate from your own conversions.">
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <CsvImport kind="ads" preview={previewAdsAction} commit={commitAdsAction.bind(null, slug)} extraFields={<>
                <Field label="Platform" htmlFor="ads-platform"><Select id="ads-platform" name="platform"><option value="meta_ads">Meta Ads</option><option value="google_ads">Google Ads</option></Select></Field>
                <Field label="Ad account id" htmlFor="ads-account"><Input id="ads-account" name="account_id" required /></Field>
              </>} />
            </div>
          </Section>
          <Section title="Other spend" description="Spend not in an ads report (e.g. a boosted post). Used for CPL and CAC.">
            <ActionForm action={addSpendAction.bind(null, slug)} submitLabel="Record spend" resetOnSuccess className="grid gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-5 sm:items-end">
              <Field label="Day" htmlFor="sp-day"><Input id="sp-day" name="day" type="date" /></Field>
              <Field label="Amount" htmlFor="sp-amount"><Input id="sp-amount" name="amount" inputMode="decimal" required /></Field>
              <Field label="Currency" htmlFor="sp-cur"><Input id="sp-cur" name="currency" defaultValue="EUR" /></Field>
              <Field label="Kind" htmlFor="sp-kind"><Select id="sp-kind" name="kind"><option value="ad_spend">Ad spend</option><option value="production">Production</option><option value="tooling">Tools</option></Select></Field>
              <Field label="Note" htmlFor="sp-note"><Input id="sp-note" name="note" /></Field>
            </ActionForm>
          </Section>
        </>
      ) : null}

      {tab === "history" ? (
        <Section description="Undoing an import excludes its rows from every view and analysis. The rows stay in history.">
          {d.batches.length ? (
            <Table>
              <thead><tr><th>When</th><th>Kind</th><th>Rows</th><th>Imported</th><th>Skipped</th><th>Status</th><th /></tr></thead>
              <tbody>{d.batches.map((b) => (
                <tr key={b.id}>
                  <td className="num whitespace-nowrap">{formatDateTime(b.created_at)}</td><td>{b.source_label || b.kind}{b.is_demo ? <span className="ml-2 text-[12px] text-amber">demo</span> : null}</td>
                  <td className="num">{b.stats.rows ?? "—"}</td><td className="num">{b.stats.imported ?? "—"}</td><td className="num">{b.stats.skipped ?? "—"}</td>
                  <td><Status tone={b.status === "completed" ? "green" : b.status === "reverted" ? "neutral" : "amber"}>{b.status}</Status></td>
                  <td>{b.status === "completed" && b.kind !== "course_methodology" ? <form action={revertBatchAction.bind(null, slug, b.id)}><Button size="sm" variant="ghost">Undo import</Button></form> : null}</td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="No imports yet" />}
        </Section>
      ) : null}
    </>
  );
}
