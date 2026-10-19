import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { compareBy, publicationRows, thresholdsFor } from "@/server/services/analytics";
import { PageHeader, Section } from "@/components/ui/layout";
import { ContentStatus, DataFlag, Status } from "@/components/ui/status";
import { STUDIO_CHANNELS } from "@/domain/content";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Overview" };

/**
 * Answers within five seconds (brief §16): which product, what needs attention, what waits for approval,
 * what is scheduled, what was published, what performs well, whether any integration has a problem.
 */
export default async function OverviewPage({ params }: PageProps<"/p/[product]/overview">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const now = new Date();
  const d = await db(async (tx, ctx) => {
    const stages = await tx.one<{ ideas: number; drafts: number; review: number; approved: number; scheduled: number; published: number; measured: number; concluded: number }>(
      `select (select count(*)::int from ideas where product_id = $1 and status in ('open','in_production')) ideas,
              (select count(*)::int from content_items where product_id = $1 and status in ('draft','ai_review')) drafts,
              (select count(*)::int from content_items where product_id = $1 and status = 'needs_human_review') review,
              (select count(*)::int from content_items where product_id = $1 and status = 'approved') approved,
              (select count(*)::int from content_items where product_id = $1 and status = 'scheduled') scheduled,
              (select count(*)::int from content_items where product_id = $1 and status = 'published') published,
              (select count(distinct p.content_item_id)::int from publications p join metric_events m on m.publication_id = p.id where p.product_id = $1) measured,
              (select count(*)::int from experiments where product_id = $1 and outcome_status <> 'open') concluded`,
      [product.id],
    );
    const attention = await tx.query<{ kind: string; label: string; href: string }>(
      `select 'blocked' kind, i.title label, '/studio/' || i.id href from content_items i
         where i.product_id = $1 and exists (select 1 from content_reviews r where r.content_version_id = i.current_version_id and r.outcome = 'block')
       union all
       select 'review', i.title, '/studio/' || i.id from content_items i where i.product_id = $1 and i.status = 'needs_human_review'
         and not exists (select 1 from approval_items a where a.content_version_id = i.current_version_id and a.state = 'pending')
       union all
       select 'window_ended', i.title, '/experiments' from experiments e join content_items i on i.id = e.content_item_id
         where e.product_id = $1 and e.outcome_status = 'open' and e.locked_at is not null and e.locked_at + (e.window_days || ' days')::interval < now()
       union all
       select 'unapproved_rule', 'Safety rules and facts proposed for ' || p.name || ' need your approval', '/products' from products p
         where p.id = $1 and exists (select 1 from product_claims c where c.product_id = p.id and c.approved_at is null and not c.archived)
       union all
       select 'connection', c.channel || ': ' || coalesce(c.paused_reason, c.last_error, c.status), '/connections' from channel_connections c
         where c.product_id = $1 and c.status in ('paused','error')
       limit 12`,
      [product.id],
    );
    const pending = await tx.query<{ id: string; subject_summary: string; created_at: string }>(
      "select id, subject_summary, created_at::text from approval_items where product_id = $1 and state = 'pending' order by created_at limit 5", [product.id]);
    const scheduled = await tx.query<{ id: string; title: string; channel: string; scheduled_for: string }>(
      "select id, title, channel, scheduled_for::text from content_items where product_id = $1 and status = 'scheduled' and scheduled_for >= now() - interval '1 day' order by scheduled_for limit 6", [product.id]);
    const published = await tx.query<{ id: string; title: string; channel: string; published_at: string }>(
      "select id, title, channel, published_at::text from content_items where product_id = $1 and status = 'published' order by published_at desc limit 6", [product.id]);
    const rows = await publicationRows(tx, product.id, new Date(now.getTime() - 90 * 86_400_000), new Date(now.getTime() + 86_400_000), product.is_demo);
    const t = await thresholdsFor(tx, ctx.workspaceId);
    const integrations = await tx.query<{ name: string; status: string; detail: string | null }>(
      `select channel name, status, coalesce(paused_reason, last_error) detail from channel_connections where product_id = $1 and status <> 'revoked'
       union all select provider, status, last_error from ai_provider_connections where workspace_id = $2 and status <> 'revoked'`,
      [product.id, ctx.workspaceId],
    );
    return { stages, attention, pending, scheduled, published, rows, t, integrations };
  });
  const hook = compareBy(d.rows, "hook", d.t);
  const leader = hook.verdict.kind === "leader" ? hook.groups.find((g) => g.key === (hook.verdict as { key: string }).key) : null;
  const flywheel: Array<[string, number, string]> = [
    ["Ideas", d.stages.ideas, "/ideas"], ["Drafts", d.stages.drafts, "/studio?status=draft"], ["Your review", d.stages.review, "/studio?status=needs_human_review"],
    ["Approved", d.stages.approved, "/studio?status=approved"], ["Scheduled", d.stages.scheduled, "/calendar"], ["Published", d.stages.published, "/publications"],
    ["Measured", d.stages.measured, "/publications"], ["Concluded", d.stages.concluded, "/experiments"],
  ];
  const ATTN: Record<string, string> = { blocked: "Blocked by a safety rule", review: "Ready for your review", window_ended: "Experiment window ended, needs a conclusion", unapproved_rule: "Needs approval", connection: "Integration problem" };
  const base = `/p/${slug}`;

  return (
    <>
      <PageHeader title={product.name} description={product.short_description || "Overview of this product's marketing cycle."} flags={product.is_demo ? <DataFlag kind="demo" /> : null} />

      <Section title="Flywheel" description="Where work is right now, from idea to a concluded experiment.">
        <ol className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface sm:grid-cols-4 xl:grid-cols-8">
          {flywheel.map(([label, n, href], i) => (
            <li key={label} className={cn("border-line", i > 0 && "border-l", "border-b xl:border-b-0")}>
              <Link href={`${base}${href}`} className="flex h-full flex-col gap-0.5 px-3 py-3 hover:bg-sage-tint">
                <span className="text-[12px] text-muted">{label}</span>
                <span className={cn("num text-[22px] font-semibold tracking-tight", n === 0 && "text-faint")}>{n}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Needs your attention">
          {d.attention.length ? (
            <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
              {d.attention.map((a, i) => (
                <li key={i}><Link href={`${base}${a.href}`} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-sage-tint">
                  <span className="min-w-0 truncate">{a.label}</span>
                  <Status tone={a.kind === "blocked" || a.kind === "connection" ? "red" : "amber"} className="shrink-0">{ATTN[a.kind]}</Status>
                </Link></li>
              ))}
            </ul>
          ) : <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px] text-muted">Nothing needs you right now.</p>}
        </Section>

        <Section title="Waiting for approval" actions={<Link href={`${base}/approvals`} className="text-[13px] text-green hover:underline">Approval Queue</Link>}>
          {d.pending.length ? (
            <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
              {d.pending.map((p) => <li key={p.id} className="flex justify-between gap-3 px-4 py-2.5"><span className="truncate">{p.subject_summary}</span><span className="num shrink-0 text-[12.5px] text-muted">{formatDateTime(p.created_at)}</span></li>)}
            </ul>
          ) : <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px] text-muted">Nothing is waiting.</p>}
        </Section>

        <Section title="Scheduled" actions={<Link href={`${base}/calendar`} className="text-[13px] text-green hover:underline">Calendar</Link>}>
          {d.scheduled.length ? (
            <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
              {d.scheduled.map((s) => <li key={s.id}><Link href={`${base}/studio/${s.id}`} className="flex justify-between gap-3 px-4 py-2.5 hover:bg-sage-tint"><span className="truncate">{s.title}</span><span className="num shrink-0 text-[12.5px] text-muted">{STUDIO_CHANNELS[s.channel] ?? s.channel}, {formatDateTime(s.scheduled_for)}</span></Link></li>)}
            </ul>
          ) : <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px] text-muted">Nothing scheduled.</p>}
        </Section>

        <Section title="Recently published" actions={<Link href={`${base}/publications`} className="text-[13px] text-green hover:underline">Publications</Link>}>
          {d.published.length ? (
            <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
              {d.published.map((s) => <li key={s.id}><Link href={`${base}/studio/${s.id}`} className="flex justify-between gap-3 px-4 py-2.5 hover:bg-sage-tint"><span className="truncate">{s.title}</span><span className="flex shrink-0 items-center gap-3 text-[12.5px] text-muted">{STUDIO_CHANNELS[s.channel] ?? s.channel}<ContentStatus status="published" /></span></Link></li>)}
            </ul>
          ) : <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px] text-muted">Nothing published yet.</p>}
        </Section>

        <Section title="What performs well" actions={<Link href={`${base}/analytics`} className="text-[13px] text-green hover:underline">Analytics</Link>}>
          <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px]">
            {leader ? (
              <p>Hook “{leader.label}” has the highest click rate ({formatPercent(leader.rate)} on {formatNumber(leader.impressions)} exposure, {leader.publications} posts) and its interval does not overlap the others. <span className="text-muted">An observation, not proof of cause.</span></p>
            ) : <p className="text-muted">{d.rows.length ? `Not enough data to call a difference yet (${d.rows.length} published posts with metrics in 90 days).` : "No metrics yet."}</p>}
          </div>
        </Section>

        <Section title="Integrations" actions={<Link href={`${base}/connections`} className="text-[13px] text-green hover:underline">Connections</Link>}>
          {d.integrations.length ? (
            <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
              {d.integrations.map((c, i) => <li key={i} className="flex justify-between gap-3 px-4 py-2.5"><span>{c.name}</span><Status tone={c.status === "connected" ? "green" : "red"}>{c.status === "connected" ? "Working" : `${c.status}${c.detail ? `: ${c.detail}` : ""}`}</Status></li>)}
            </ul>
          ) : <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13px] text-muted">No integrations connected. Content is exported and posted manually; the AI is the mock provider.</p>}
        </Section>
      </div>
    </>
  );
}
