import Link from "next/link";
import { notFound } from "next/navigation";
import { db, getProduct } from "@/server/context";
import { generateContentAction, generateHooksAction } from "@/app/actions/content";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";
import { EmptyState, KeyValue, PageHeader, Section } from "@/components/ui/layout";
import { ContentStatus, DataFlag } from "@/components/ui/status";
import { EpistemicTag } from "@/components/ui/epistemic";
import { Rationale } from "@/components/content/rationale";
import { STUDIO_CHANNELS, STUDIO_FORMATS } from "@/domain/content";

export const metadata = { title: "Idea" };

export default async function IdeaPage({ params }: PageProps<"/p/[product]/ideas/[ideaId]">) {
  const { product: slug, ideaId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(ideaId)) notFound();
  const product = await getProduct(slug);
  const d = await db(async (tx) => {
    const idea = await tx.maybeOne<{ id: string; title: string; insight: string; segment: string | null; job: string | null; fear: string | null; quote: string | null; topic: string | null; funnel_stage: string | null }>(
      `select i.id, i.title, i.insight, s.code || ' ' || s.name segment, j.statement job, f.fear, q.text_verbatim quote, t.label topic, i.funnel_stage
         from ideas i left join segments s on s.id = i.segment_id left join jobs j on j.id = i.job_id left join fears f on f.id = i.fear_id
         left join client_quotes q on q.id = i.quote_id left join taxonomy_terms t on t.id = i.topic_term_id where i.id = $1 and i.product_id = $2`,
      [ideaId, product.id],
    );
    if (!idea) return null;
    return {
      idea,
      sources: await tx.query<{ id: string; title: string; scope: string }>("select s.id, s.title, s.scope from idea_sources x join knowledge_sources s on s.id = x.source_id where x.idea_id = $1", [ideaId]),
      hooks: await tx.query<{ id: string; text: string; hook_type: string; status: string; rationale: Record<string, string | string[]>; is_mock: boolean | null }>(
        "select h.id, h.text, h.hook_type, h.status, h.rationale, ar.is_mock from hooks h left join agent_runs ar on ar.id = h.agent_run_id where h.idea_id = $1 order by h.created_at",
        [ideaId],
      ),
      items: await tx.query<{ id: string; title: string; status: string; channel: string; format: string }>("select id, title, status, channel, format from content_items where idea_id = $1 order by created_at", [ideaId]),
      ctas: await tx.query<{ id: string; label: string }>("select id, label from taxonomy_terms where product_id = $1 and vocabulary = 'cta' and not archived order by label", [product.id]),
      goals: await tx.query<{ label: string }>("select label from taxonomy_terms where product_id = $1 and vocabulary = 'goal' and not archived order by label", [product.id]),
      locales: await tx.query<{ language: string }>("select distinct language from product_locales where product_id = $1 order by language", [product.id]),
      campaigns: await tx.query<{ id: string; name: string }>("select id, name from campaigns where product_id = $1 and status in ('planned','active') order by name", [product.id]),
    };
  });
  if (!d) notFound();
  const { idea } = d;
  const anyMock = d.hooks.some((h) => h.is_mock);
  return (
    <>
      <PageHeader title={idea.title} description={idea.insight || undefined} flags={anyMock ? <DataFlag kind="mock" /> : null} actions={<Link href={`/p/${slug}/ideas`} className="text-[13px] text-green underline-offset-2 hover:underline">All ideas</Link>} />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <Section title="Hooks" description="Variants differ by mechanism, not only wording. Each explains who it is for, what it addresses and where the insight came from.">
            {d.hooks.length ? (
              <ol className="flex flex-col gap-3">
                {d.hooks.map((h, i) => (
                  <li key={h.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                      <span>Variant {i + 1}</span><span>{h.hook_type.replace("_", " ")}</span><span>angle: {String(h.rationale.angle ?? "—")}</span>
                      {h.status === "chosen" ? <span className="text-green">used for content</span> : null}
                    </div>
                    <p className="text-[15px] font-medium">{h.text}</p>
                    <div className="mt-3 border-t border-line pt-3"><Rationale r={h.rationale} /></div>
                  </li>
                ))}
              </ol>
            ) : <EmptyState title="No hooks yet">Generate variants from this idea's segment, Job, quotes and sources.</EmptyState>}
            <ActionForm action={generateHooksAction.bind(null, slug, ideaId)} submitLabel={d.hooks.length ? "Generate more hooks" : "Generate hooks"} pendingLabel="Generating…" className="mt-3 flex flex-wrap items-end gap-3" submitVariant={d.hooks.length ? "secondary" : "primary"}>
              <Field label="How many" htmlFor="count"><Select id="count" name="count" defaultValue="3" className="w-24">{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</Select></Field>
            </ActionForm>
          </Section>

          {d.hooks.length ? (
            <Section title="Create content from a hook" description="Generates two variants as separate content items, each with its own experiment, then runs the safety rules and AI reviews.">
              <ActionForm action={generateContentAction.bind(null, slug, ideaId)} submitLabel="Generate content" pendingLabel="Generating and reviewing…" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
                <Field label="Hook" htmlFor="hook_id" className="md:col-span-3"><Select id="hook_id" name="hook_id" required>{d.hooks.map((h) => <option key={h.id} value={h.id}>{h.text.slice(0, 120)}</option>)}</Select></Field>
                <Field label="Channel" htmlFor="channel"><Select id="channel" name="channel">{Object.entries(STUDIO_CHANNELS).filter(([k]) => k !== "website").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Format" htmlFor="format"><Select id="format" name="format">{Object.entries(STUDIO_FORMATS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.channels.join(", ")})</option>)}</Select></Field>
                <Field label="Goal" htmlFor="goal"><Select id="goal" name="goal">{d.goals.map((g) => <option key={g.label}>{g.label}</option>)}</Select></Field>
                <Field label="Call to action" htmlFor="cta_term_id"><Select id="cta_term_id" name="cta_term_id"><option value="">None</option>{d.ctas.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
                <Field label="Language" htmlFor="language" hint={d.locales.length ? undefined : "Add languages under Products."}><Select id="language" name="language">{(d.locales.length ? d.locales.map((l) => l.language) : ["en"]).map((l) => <option key={l}>{l}</option>)}</Select></Field>
                <Field label="Campaign" htmlFor="campaign_id"><Select id="campaign_id" name="campaign_id"><option value="">None</option>{d.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              </ActionForm>
            </Section>
          ) : null}

          {d.items.length ? (
            <Section title="Content from this idea">
              <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
                {d.items.map((it) => (
                  <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/p/${slug}/studio/${it.id}`} className="font-medium hover:text-green">{it.title}</Link>
                    <span className="flex items-center gap-3 text-[13px] text-muted">{STUDIO_CHANNELS[it.channel] ?? it.channel}, {STUDIO_FORMATS[it.format]?.label ?? it.format}<ContentStatus status={it.status} /></span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <aside>
          <Section title="Brief">
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <KeyValue items={[["Segment", idea.segment ?? "—"], ["Job", idea.job ?? "—"], ["Fear", idea.fear ?? "—"], ["Topic", idea.topic ?? "—"], ["Funnel stage", idea.funnel_stage ?? "—"]]} />
              {idea.quote ? <div className="mt-3 flex gap-2 border-t border-line pt-3"><EpistemicTag kind="quote" /><p className="text-[13px]">“{idea.quote}”</p></div> : null}
            </div>
          </Section>
          <Section title="Sources">
            {d.sources.length ? (
              <ul className="text-[13px]">{d.sources.map((s) => <li key={s.id} className="border-b border-line py-1.5"><Link href={`/p/${slug}/knowledge/${s.id}`} className="text-green hover:underline">{s.title}</Link> <span className="text-faint">{s.scope === "workspace" ? "methodology" : "evidence"}</span></li>)}</ul>
            ) : <p className="text-[13px] text-amber">No sources attached: generated insights cannot cite evidence.</p>}
          </Section>
        </aside>
      </div>
    </>
  );
}
