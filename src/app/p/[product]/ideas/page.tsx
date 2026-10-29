import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { createIdeaAction } from "@/app/actions/content";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatDate } from "@/lib/format";
import { deskItems, getDeskSettings } from "@/server/services/content-desk";
import { addOwnReelAction, generateDeskAction, saveDeskSettingsAction } from "@/app/actions/content-desk";
import { channelConnection, publishingEnabled } from "@/server/services/youtube-publish";
import { DeskCard, type DeskCardData } from "./desk-card";
import { FORMATS, MUSIC, SHOTS } from "./reel-options";

const TZ = "Europe/Riga";
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
const KIND: Record<string, string> = { post: "Post", carousel: "Carousel", article: "Article", reel: "Reel" };

export const metadata = { title: "Ideas & hooks" };
export const maxDuration = 300;

export default async function IdeasPage({ params }: PageProps<"/p/[product]/ideas">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => ({
    desk: await deskItems(tx, product.id),
    deskSettings: await getDeskSettings(tx, ctx.workspaceId, product.id),
    ig: await channelConnection(tx, product.id, "instagram"),
    ideas: await tx.query<{ id: string; title: string; status: string; segment: string | null; job: string | null; hooks: number; items: number; created_at: string }>(
      `select i.id, i.title, i.status, s.code segment, j.statement job, i.created_at::text,
              (select count(*)::int from hooks h where h.idea_id = i.id) hooks, (select count(*)::int from content_items c where c.idea_id = i.id) items
         from ideas i left join segments s on s.id = i.segment_id left join jobs j on j.id = i.job_id where i.product_id = $1 order by i.created_at desc`,
      [product.id],
    ),
    segments: await tx.query<{ id: string; code: string; name: string }>("select id, code, name from segments where product_id = $1 and status = 'active' order by code", [product.id]),
    jobs: await tx.query<{ id: string; statement: string }>("select id, statement from jobs where product_id = $1 order by created_at", [product.id]),
    fears: await tx.query<{ id: string; fear: string }>("select id, fear from fears where product_id = $1 order by created_at", [product.id]),
    quotes: await tx.query<{ id: string; text_verbatim: string }>("select id, text_verbatim from client_quotes where product_id = $1 order by created_at desc", [product.id]),
    signals: await tx.query<{ id: string; label: string }>("select id, coalesce(nullif(hook,''), nullif(topic,''), platform) label from signals where product_id = $1 and validation_status <> 'rejected' order by created_at desc", [product.id]),
    sources: await tx.query<{ id: string; title: string; scope: string }>(
      "select id, title, scope from knowledge_sources where workspace_id = $1 and (product_id = $2 or scope = 'workspace') and status = 'ready' order by scope, title",
      [product.workspace_id, product.id],
    ),
    stages: await tx.query<{ label: string }>("select label from taxonomy_terms where product_id = $1 and vocabulary = 'funnel_stage' and not archived order by label", [product.id]),
  }));
  const waiting = d.desk.filter((x) => ["needs_human_review", "draft", "ai_review"].includes(x.status));
  const planned = d.desk.filter((x) => ["scheduled", "approved", "published"].includes(x.status)).sort((a, b) => (a.scheduled_for ?? a.published_at ?? "").localeCompare(b.scheduled_for ?? b.published_at ?? ""));
  const card = (x: (typeof d.desk)[number]): DeskCardData => ({
    id: x.id, kind: x.kind, topic: x.topic, insight: x.insight, why_now: x.why_now, sources: x.sources, hooks: x.hooks, chosen_hook: x.chosen_hook,
    caption: x.body.caption ?? "", slides: (x.body.slides ?? []).map((s) => ({ title: s.title, text: s.text ?? "" })), brief: x.body.body ?? "",
    images: x.image_asset_ids.map((id) => `/p/${slug}/creatives/${id}`), render_error: x.render_error, blocked: x.status === "draft" ? x.blocked_reason : null,
    reel: x.reel, video: x.video_asset_id ? `/p/${slug}/creatives/${x.video_asset_id}` : null, render_status: x.render_status,
    share_reason: x.craft?.share_reason ?? "", borrowed_mechanism: x.craft?.borrowed_mechanism ?? "",
  });
  const s = d.deskSettings;
  return (
    <>
      <PageHeader
        title="Ideas & hooks"
        description={`Every morning at 7:40 the desk researches what ${product.name}'s audience asks and shares right now, what worked for us and what we have not covered yet, then prepares ready pieces for Instagram: ${s.reels_per_day} Reel(s), ${s.carousels_per_day} carousel(s) and ${s.posts_per_day} post(s) a day, in ${product.name}'s look, and ${s.articles_per_week} article idea(s) a week. Approve puts a piece on the calendar.`}
      />
      <Section
        title={`Today's desk${waiting.length ? ` · ${waiting.length} waiting` : ""}`}
        description={d.ig?.status === "connected" ? (publishingEnabled("instagram") ? `Approved pieces go out on Instagram by themselves, each at the next free time: ${s.slots.join(", ")} (Riga), one piece per time.` : "Instagram posting is switched off on the server (INSTAGRAM_PUBLISHING_ENABLED), so approved posts wait on the calendar.") : "Instagram is not connected: approved posts wait on the calendar until it is (Connections)."}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ActionForm action={generateDeskAction.bind(null, slug)} submitLabel="Research and prepare now" pendingLabel="Researching and drawing, 1–2 minutes…" submitVariant="secondary" className="flex items-center gap-2 [&_p]:max-w-[360px] [&_p]:text-[12px]"><span className="sr-only">Prepare the desk now</span></ActionForm>
        </div>
        {waiting.length ? (
          <div className="grid gap-4 xl:grid-cols-2">{waiting.map((x) => <DeskCard key={x.id} slug={slug} d={card(x)} />)}</div>
        ) : (
          <p className="text-[13px] text-muted">Nothing waits for you. The next desk is prepared tomorrow at 7:40{s.enabled ? "" : " when the desk is switched on (settings below)"}.</p>
        )}
        {planned.length ? (
          <>
            <h3 className="mt-8 text-[15px] font-medium">On the calendar</h3>
            <ol className="mt-2 flex flex-col divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface">
              {planned.slice(0, 20).map((x) => (
                <li key={x.id} className="flex items-center gap-4 px-4 py-2.5 text-[13px]">
                  <span className="num w-[132px] shrink-0 text-green">{x.published_at ? when(x.published_at) : x.scheduled_for ? when(x.scheduled_for) : "—"}</span>
                  <span className="w-[72px] shrink-0 text-[12px] text-faint">{KIND[x.kind]}</span>
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  {x.external_url ? <a href={x.external_url} target="_blank" rel="noreferrer noopener" className="text-[12px] underline">open</a> : <span className="text-[12px] text-muted">{x.status === "published" ? "published" : x.kind === "article" ? "planned" : "scheduled"}</span>}
                </li>
              ))}
            </ol>
          </>
        ) : null}
        <details className="mt-6 rounded-[10px] border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium">Desk settings</summary>
          <ActionForm action={saveDeskSettingsAction.bind(null, slug)} submitLabel="Save" className="grid gap-4 border-t border-line p-4 md:grid-cols-3">
            <label className="flex items-center gap-2 text-[13.5px] md:col-span-3"><input type="checkbox" name="enabled" defaultChecked={s.enabled} className="size-4" /> Prepare a desk every morning</label>
            <Field label="Reels a day" htmlFor="dk-r"><Select id="dk-r" name="reels_per_day" defaultValue={String(s.reels_per_day)}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</Select></Field>
            <Field label="Carousels a day" htmlFor="dk-c"><Select id="dk-c" name="carousels_per_day" defaultValue={String(s.carousels_per_day)}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</Select></Field>
            <Field label="Posts a day" htmlFor="dk-p"><Select id="dk-p" name="posts_per_day" defaultValue={String(s.posts_per_day)}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</Select></Field>
            <Field label="Publishing times (Riga), one piece each" htmlFor="dk-sl"><Input id="dk-sl" name="slots" defaultValue={s.slots.join(", ")} /></Field>
            <Field label="Article ideas a week" htmlFor="dk-a"><Select id="dk-a" name="articles_per_week" defaultValue={String(s.articles_per_week)}>{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n}>{n}</option>)}</Select></Field>
            <label className="flex items-center gap-2 self-end text-[13.5px]"><input type="checkbox" name="web_research" defaultChecked={s.web_research} className="size-4" /> Research the web</label>
          </ActionForm>
        </details>
        <details className="mt-3 rounded-[10px] border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium">Add a Reel of your own</summary>
          <ActionForm action={addOwnReelAction.bind(null, slug)} submitLabel="Add to the desk" pendingLabel="Checking and adding…" resetOnSuccess className="grid gap-4 border-t border-line p-4 md:grid-cols-3">
            <p className="text-[13px] text-muted md:col-span-3">Your own text goes through the same checks, is made by the renderer within two hours and then waits here for your approve, like the desk&apos;s Reels.</p>
            <Field label="Topic (2–4 words)" htmlFor="or-topic"><Input id="or-topic" name="topic" required maxLength={60} /></Field>
            <Field label="Format" htmlFor="or-format"><Select id="or-format" name="format" defaultValue="scenes">{Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Music" htmlFor="or-music"><Select id="or-music" name="music" defaultValue="warm">{Object.entries(MUSIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Hook: 1–4 short lines, up to 28 characters each" htmlFor="or-intro"><Textarea id="or-intro" name="intro_lines" rows={4} required /></Field>
            <Field label="Opening card" htmlFor="or-style"><Select id="or-style" name="intro_style" defaultValue="dark"><option value="dark">Dark green</option><option value="light">Light</option></Select></Field>
            <Field label="Melody no. (optional, 1–97)" htmlFor="or-melody" hint="Keeps the melody of a version you already heard."><Input id="or-melody" name="melody" type="number" min={1} max={97} /></Field>
            <Field label="Calm lines (read slowly: 3–8; breathe along: up to 3), one per line" htmlFor="or-text" className="md:col-span-3"><Textarea id="or-text" name="text_lines" rows={4} /></Field>
            {[0, 1, 2].map((i) => (
              <Field key={i} label={`Scene ${i + 1} (app scenes)`} htmlFor={`or-shot-${i}`}>
                <Select id={`or-shot-${i}`} name={`shot_${i}`} defaultValue=""><option value="">None</option>{Object.entries(SHOTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                <Input name={`scene_caption_${i}`} maxLength={48} placeholder="Caption for this scene" className="mt-1" aria-label={`Scene ${i + 1} caption`} />
              </Field>
            ))}
            <Field label="Instagram caption" htmlFor="or-caption" className="md:col-span-3"><Textarea id="or-caption" name="caption" rows={4} maxLength={2000} /></Field>
          </ActionForm>
        </details>
      </Section>

      <div className="mt-12">
        <h2 className="text-[19px]">Your own ideas</h2>
        <p className="mt-1 max-w-[70ch] text-[13px] text-muted">An idea ties one segment and one Job (or fear) to the evidence behind it. Hooks and content are generated from the idea, so every variant can explain where it came from.</p>
      </div>
      <Section>
        {d.ideas.length ? (
          <Table>
            <thead><tr><th>Idea</th><th>Segment</th><th>Job</th><th className="text-right">Hooks</th><th className="text-right">Content</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{d.ideas.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/p/${slug}/ideas/${i.id}`} className="font-medium hover:text-green">{i.title}</Link></td>
                <td>{i.segment ?? "—"}</td><td className="max-w-[320px] text-muted">{i.job ?? "—"}</td>
                <td className="num text-right">{i.hooks}</td><td className="num text-right">{i.items}</td>
                <td><Status tone={i.status === "done" ? "green" : i.status === "in_production" ? "slate" : "neutral"}>{i.status.replace("_", " ")}</Status></td>
                <td className="num whitespace-nowrap text-muted">{formatDate(i.created_at)}</td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No ideas yet">Start from a segment and a Job you have evidence for, then attach the sources that support the idea.</EmptyState>}
      </Section>
      <Section title="New idea">
        <ActionForm action={createIdeaAction.bind(null, slug)} submitLabel="Create idea" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-2">
          <Field label="Title" htmlFor="i-title" className="md:col-span-2"><Input id="i-title" name="title" required placeholder="The first minute of a panic wave on the metro" /></Field>
          <Field label="Insight" htmlFor="i-insight" className="md:col-span-2" hint="What we noticed and why it matters. Label it a hypothesis if it is not backed by a quote."><Textarea id="i-insight" name="insight" rows={2} /></Field>
          <Field label="Segment" htmlFor="i-seg"><Select id="i-seg" name="segment_id"><option value="">None</option>{d.segments.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</Select></Field>
          <Field label="Job" htmlFor="i-job"><Select id="i-job" name="job_id"><option value="">None</option>{d.jobs.map((j) => <option key={j.id} value={j.id}>{j.statement.slice(0, 90)}</option>)}</Select></Field>
          <Field label="Fear it addresses" htmlFor="i-fear"><Select id="i-fear" name="fear_id"><option value="">None</option>{d.fears.map((f) => <option key={f.id} value={f.id}>{f.fear.slice(0, 90)}</option>)}</Select></Field>
          <Field label="Customer quote" htmlFor="i-quote"><Select id="i-quote" name="quote_id"><option value="">None</option>{d.quotes.map((q) => <option key={q.id} value={q.id}>“{q.text_verbatim.slice(0, 80)}”</option>)}</Select></Field>
          <Field label="Signal it builds on" htmlFor="i-signal"><Select id="i-signal" name="signal_id"><option value="">None</option>{d.signals.map((s) => <option key={s.id} value={s.id}>{s.label.slice(0, 80)}</option>)}</Select></Field>
          <Field label="Funnel stage" htmlFor="i-stage"><Select id="i-stage" name="funnel_stage"><option value="">Not set</option>{d.stages.map((s) => <option key={s.label}>{s.label}</option>)}</Select></Field>
          <Field label="Topic" htmlFor="i-topic"><Input id="i-topic" name="topic" /></Field>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-[13px] font-medium">Sources (evidence and methodology)</legend>
            {d.sources.length ? (
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-[var(--radius-control)] border border-line p-2 text-[13px] sm:grid-cols-2">
                {d.sources.map((s) => (
                  <label key={s.id} className="flex items-start gap-2"><input type="checkbox" name="source_ids" value={s.id} className="mt-1" /><span>{s.title}<span className="text-faint"> {s.scope === "workspace" ? "methodology" : "evidence"}</span></span></label>
                ))}
              </div>
            ) : <p className="text-[13px] text-muted">No sources yet. Add some in Knowledge.</p>}
          </fieldset>
        </ActionForm>
      </Section>
    </>
  );
}
