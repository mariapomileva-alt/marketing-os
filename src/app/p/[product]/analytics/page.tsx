import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { adsTotals, compareBy, conversionTotals, DIMENSIONS, funnelCounts, productSummaries, publicationRows, thresholdsFor, totalsOf, type Dimension } from "@/server/services/analytics";
import { recommendationsFrom } from "@/server/services/recommendations";
import { RecommendationCard } from "@/components/content/recommendation";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { DataFlag, Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { formatNumber, formatPercent } from "@/lib/format";
import { nowMs } from "@/lib/time";
import { getSiteSettings, topYoutubeComments, trafficBySource, youtubeCommentTotals } from "@/server/services/traffic";
import { appUrl } from "@/server/notify/telegram";
import { CounterSetup, WebsiteTraffic, YoutubeCommentStats } from "./traffic-sections";

export const metadata = { title: "Analytics" };

const PERIODS: Record<string, number> = { "30": 30, "90": 90, "365": 365 };

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/p/[product]/analytics">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const days = PERIODS[typeof sp.days === "string" ? sp.days : "90"] ?? 90;
  const includeDemo = sp.demo === "1";
  const t0 = nowMs();
  const to = new Date(t0 + 86_400_000);
  const from = new Date(t0 - days * 86_400_000);
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => {
    const rows = await publicationRows(tx, product.id, from, to, includeDemo || product.is_demo);
    const ads = await adsTotals(tx, product.id, from, to);
    const conv = await conversionTotals(tx, product.id, from, to);
    const extraSpend = await tx.one<{ s: number | null }>("select sum(amount)::float s from spend_entries where product_id = $1 and day >= $2::date and kind = 'ad_spend'", [product.id, from.toISOString().slice(0, 10)]);
    const spend = ads.spend === null && extraSpend.s === null ? null : (ads.spend ?? 0) + (extraSpend.s ?? 0);
    return {
      rows,
      funnel: await funnelCounts(tx, product.id, from, to, includeDemo || product.is_demo),
      totals: totalsOf(rows, spend, conv),
      ads,
      conv,
      t: await thresholdsFor(tx, ctx.workspaceId),
      products: await productSummaries(tx, ctx.workspaceId, from, to),
      site: await getSiteSettings(tx, ctx.workspaceId, product.id),
      traffic: await trafficBySource(tx, product.id, from),
      ytTotals: await youtubeCommentTotals(tx, product.id, from),
      ytTop: await topYoutubeComments(tx, product.id),
      demoCount: (await tx.one<{ n: number }>("select count(*)::int n from publications where product_id = $1 and is_demo", [product.id])).n,
    };
  });
  const showsDemo = d.rows.some((r) => r.is_demo);
  const dims = Object.keys(DIMENSIONS) as Dimension[];
  const comparisons = dims.map((dim) => ({ dim, ...compareBy(d.rows, dim, d.t) }));
  const period = `last ${days} days`;
  const recs = recommendationsFrom(comparisons, period, d.t);
  const unmatched = Object.values(d.conv).reduce((a, c) => a + (c.total - c.matched), 0);
  const metric = (label: string, value: string, note?: string) => (
    <div className="min-w-[120px] px-4 py-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[20px] font-semibold tracking-tight">{value}</dd>
      {note ? <dd className="text-[11.5px] text-faint">{note}</dd> : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Numbers are computed from imported metrics and conversions. Differences are only called when samples are large enough and intervals do not overlap; even then they are observations, not proof of cause."
        flags={showsDemo ? <DataFlag kind="demo" /> : null}
      />
      <form className="mb-5 flex flex-wrap items-end gap-3" action={`/p/${slug}/analytics`}>
        <label className="text-[13px]">Period <Select name="days" defaultValue={String(days)} className="ml-1 inline-block w-36"><option value="30">30 days</option><option value="90">90 days</option><option value="365">12 months</option></Select></label>
        {d.demoCount && !product.is_demo ? <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="demo" value="1" defaultChecked={includeDemo} /> Include demo data</label> : null}
        <Button type="submit">Update</Button>
      </form>

      <Section title="Pipeline and results">
        <dl className="flex flex-wrap divide-x divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {metric("Items created", formatNumber(d.funnel.created))}
          {metric("Approved", formatNumber(d.funnel.approved))}
          {metric("Published", formatNumber(d.funnel.published))}
          {metric("Reach", formatNumber(d.totals.reach))}
          {metric("Engagement", formatNumber(d.totals.engagement), "likes + saves + shares + comments")}
          {metric("Saves", formatNumber(d.totals.saves))}
          {metric("Clicks", formatNumber(d.totals.clicks))}
        </dl>
        <dl className="mt-3 flex flex-wrap divide-x divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {metric("Registrations", formatNumber(d.totals.registrations))}
          {metric("Trial starts", formatNumber(d.totals.trials))}
          {metric("Paid subscriptions", formatNumber(d.totals.payments))}
          {metric("Registrations per click", formatPercent(d.totals.conversionRate), d.totals.clicks ? undefined : "no clicks yet")}
          {metric("Ad spend", d.totals.spend === null ? "—" : `${formatNumber(d.totals.spend, 2)} ${d.ads.currency ?? "EUR"}`, d.totals.spend === null ? "no spend recorded" : undefined)}
          {metric("CPL", d.totals.cpl === null ? "—" : formatNumber(d.totals.cpl, 2), d.totals.cpl === null ? "needs spend and leads" : undefined)}
          {metric("CAC", d.totals.cac === null ? "—" : formatNumber(d.totals.cac, 2), d.totals.cac === null ? "needs spend and payments" : undefined)}
        </dl>
        {unmatched ? <p className="mt-2 text-[12.5px] text-amber">{unmatched} conversions could not be matched to a tracking link; they count in totals but not in the comparisons below.</p> : null}
        {d.ads.platform_conversions !== null ? <p className="mt-1 text-[12.5px] text-muted">Ad platforms reported {formatNumber(d.ads.platform_conversions)} results themselves; these are platform claims and are not mixed with your conversions.</p> : null}
      </Section>

      <WebsiteTraffic traffic={d.traffic} period={period} />
      <YoutubeCommentStats totals={d.ytTotals} top={d.ytTop} />

      {d.rows.length ? (
        <>
          <Section title="Recommendations for the next cycle">
            {recs.length ? <div className="grid gap-3 lg:grid-cols-2">{recs.slice(0, 4).map((r, i) => <RecommendationCard key={i} r={r} />)}</div> : <p className="text-[13px] text-muted">No recommendation yet: groups either do not differ or there is only one group per dimension.</p>}
          </Section>
          {comparisons.map((c) => (
            <Section key={c.dim} title={`By ${DIMENSIONS[c.dim].toLowerCase()}`} description={c.verdict.reason}>
              <Table>
                <thead><tr><th>{DIMENSIONS[c.dim]}</th><th className="text-right">Posts</th><th className="text-right">Exposure</th><th className="text-right">Clicks</th><th className="text-right">Click rate</th><th>95% interval</th><th className="text-right">Engagement</th><th className="text-right">Saves</th><th className="text-right">Registrations</th><th>Verdict</th></tr></thead>
                <tbody>{c.groups.map((g) => (
                  <tr key={g.key}>
                    <td className="max-w-[300px]">{g.label}</td>
                    <td className="num text-right">{g.publications}</td><td className="num text-right">{formatNumber(g.impressions)}</td><td className="num text-right">{formatNumber(g.successes)}</td>
                    <td className="num text-right">{formatPercent(g.rate)}</td>
                    <td className="num whitespace-nowrap text-muted">{g.interval ? `${formatPercent(g.interval.low)}–${formatPercent(g.interval.high)}` : "—"}</td>
                    <td className="num text-right">{formatNumber(c.extra[g.key].engagement)}</td><td className="num text-right">{formatNumber(c.extra[g.key].saves)}</td><td className="num text-right">{formatNumber(c.extra[g.key].registrations)}</td>
                    <td className="whitespace-nowrap">
                      {!g.sufficient ? <Status tone="amber">Not enough data</Status>
                        : c.verdict.kind === "leader" && c.verdict.key === g.key ? <Status tone="green">Higher, not proven</Status>
                        : <Status>No clear difference</Status>}
                    </td>
                  </tr>
                ))}</tbody>
              </Table>
            </Section>
          ))}
        </>
      ) : (
        <EmptyState title="No published items with metrics in this period">
          Publish approved content, then add metrics in <Link className="text-green underline" href={`/p/${slug}/publications`}>Publications</Link>. {d.demoCount ? "Or tick 'Include demo data' to see how this page works." : ""}
        </EmptyState>
      )}

      <CounterSetup slug={slug} site={d.site} scriptUrl={appUrl("/t.js")} productName={product.name} />

      <Section title="By product" description="Workspace overview. Each product's data stays separate; this table only shows totals side by side.">
        <Table>
          <thead><tr><th>Product</th><th className="text-right">Published</th><th className="text-right">Clicks</th><th className="text-right">Registrations</th><th className="text-right">Ad spend</th></tr></thead>
          <tbody>{d.products.map((p) => (
            <tr key={p.id}><td><Link href={`/p/${p.slug}/analytics`} className="hover:text-green">{p.name}</Link>{p.is_demo ? <span className="ml-2 text-[12px] text-amber">demo</span> : null}</td>
              <td className="num text-right">{p.published}</td><td className="num text-right">{formatNumber(p.clicks)}</td><td className="num text-right">{p.registrations}</td><td className="num text-right">{p.spend === null ? "—" : formatNumber(p.spend, 2)}</td></tr>
          ))}</tbody>
        </Table>
      </Section>
    </>
  );
}
