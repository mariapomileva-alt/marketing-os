import { db, getProduct } from "@/server/context";
import { getCalmSettings } from "@/server/services/calm";
import { openaiKey } from "@/server/ai";
import { youtubeConnection } from "@/server/services/youtube-publish";
import { approveCalmAction, createCalmVideoAction, createRendererTokenAction, rejectCalmAction, retryCalmMediaAction, saveCalmSettingsAction } from "@/app/actions/calm";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, KeyValue, PageHeader, Section } from "@/components/ui/layout";
import { DataFlag, Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";
import { planShorts } from "@/server/services/calm-shorts";
import { channelConnection } from "@/server/services/youtube-publish";
import { ShortsBlock, type ShortRow } from "./shorts-block";

export const metadata = { title: "Calm Videos" };
export const maxDuration = 300;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const THEMES = ["river", "forest", "clouds", "rain", "ocean", "snow", "lake", "meadow"];
const VOICES = ["sage", "shimmer", "coral", "alloy", "ash", "ballad", "echo", "fable", "nova", "onyx", "verse"];
const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  scripted: { label: "script written, waiting for voice", tone: "amber" },
  ready_to_render: { label: "waiting for the renderer", tone: "amber" },
  rendering: { label: "rendering", tone: "amber" },
  review: { label: "ready to watch: approve or reject", tone: "amber" },
  approved: { label: "approved", tone: "green" },
  scheduled: { label: "scheduled", tone: "green" },
  published: { label: "published", tone: "green" },
  rejected: { label: "rejected", tone: "neutral" },
  failed: { label: "failed", tone: "red" },
};

export default async function CalmPage({ params }: PageProps<"/p/[product]/calm">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => {
   // Videos made before Shorts existed get their plan the first time the page is opened.
   for (const v of await tx.query<{ id: string }>("select id from calm_videos v where product_id = $1 and status not in ('rejected') and not exists (select 1 from calm_shorts s where s.video_id = v.id)", [product.id])) {
     await planShorts(tx, product.id, v.id);
   }
   return {
    shorts: await tx.query<ShortRow>(
      `select id, video_id, idx, title, line_from, line_to, targets, status, error, youtube_video_id, instagram_status, preview_asset_id, publish_at::text
         from calm_shorts where product_id = $1 order by video_id, idx`, [product.id]),
    ig: await channelConnection(tx, product.id, "instagram"),
    s: await getCalmSettings(tx, ctx.workspaceId, product.id),
    yt: await youtubeConnection(tx, product.id),
    openai: Boolean(await openaiKey(ctx.workspaceId)),
    library: await tx.one<{ clips: number; music: number }>(
      `select count(*) filter (where kind in ('video', 'image'))::int clips, count(*) filter (where kind = 'audio')::int music
         from creative_assets where product_id = $1 and storage_path is not null and origin <> 'competitor_reference' and 'calm' = any(tags) and not ('calm-video' = any(tags))`,
      [product.id],
    ),
    videos: await tx.query<{ id: string; topic: string; theme: string; title: string; description: string; lines: Array<{ text: string; pause: number }>; status: string; error: string | null; youtube_video_id: string | null; publish_at: string | null; created_at: string; is_mock: boolean; clips: unknown[]; render_url: string | null; preview_asset_id: string | null }>(
      `select id, topic, theme, title, description, lines, status, error, youtube_video_id, publish_at::text, created_at::text, is_mock, clips, render_url, preview_asset_id
         from calm_videos where product_id = $1 order by created_at desc limit 30`,
      [product.id],
    ),
   };
  });
  const s = d.s;
  const rendererSeen = s.renderer_seen_at ? formatDateTime(s.renderer_seen_at) : null;
  const pexels = Boolean(process.env.PIXABAY_API_KEY || process.env.PEXELS_API_KEY);
  return (
    <>
      <PageHeader
        title="Calm Videos"
        description="Slow affirmation videos for YouTube: nature footage, the words on screen, a calm voice and soft music. The agent writes them, a renderer builds them and uploads them to YouTube as private. You watch each one and approve it; only then is it scheduled."
      />

      <Section title="Setup">
        <KeyValue
          items={[
            ["Script", <Status key="s" tone="green">Claude (as for every draft)</Status>],
            ["Voice", d.openai ? <Status key="v" tone="green">OpenAI text-to-speech, voice “{s.voice}”</Status> : <Status key="v" tone="amber">Add an OpenAI API key in Connections → AI providers</Status>],
            ["Footage", d.library.clips >= 3
              ? <Status key="f" tone="green">{`Your Creative Library: ${d.library.clips} clips and images tagged calm`}</Status>
              : <span key="f"><Status tone="amber">{`${d.library.clips} of yours tagged calm`}</Status> <span className="text-muted">{pexels ? "· the rest from free stock footage" : "· add clips in Creative Library (tag: calm, river…) or set PIXABAY_API_KEY; otherwise a soft gradient"}</span></span>],
            ["Music", d.library.music ? <Status key="m" tone="green">{`Your Creative Library: ${d.library.music} track${d.library.music === 1 ? "" : "s"} tagged calm, used in turn`}</Status> : "A soft ambient pad generated for each video. Add your own tracks in Creative Library with the tag calm."],
            ["YouTube", d.yt?.status === "connected" ? <Status key="y" tone="green">{`Uploads as private to ${d.yt.account_label}`}</Status> : <Status key="y" tone="red">Connect the YouTube channel in Connections</Status>],
            ["Renderer (GitHub)", s.renderer_token_hash ? (rendererSeen ? <Status key="r" tone="green">{`Last checked in ${rendererSeen}`}</Status> : <Status key="r" tone="amber">Key created; waiting for the first check-in</Status>) : <Status key="r" tone="amber">Create a renderer key below and add it to GitHub</Status>],
            ["Automatic videos", s.enabled ? <Status key="a" tone="green">{`On: two in the pipeline, published ${s.publish_days.map((x) => DAYS[x - 1]).join(" and ")} at ${s.publish_hour_utc}:00 UTC after your approval`}</Status> : <Status key="a">Off (Settings below)</Status>],
          ]}
        />
        <div className="mt-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-[13.5px]">
          <p className="font-medium">Renderer key</p>
          <p className="mt-1 text-muted">The renderer runs on GitHub (free) every two hours. It needs this key as the repository secret <code>MOS_RENDER_TOKEN</code>. Creating a new key replaces the old one.</p>
          <ActionForm action={createRendererTokenAction.bind(null, slug)} submitLabel={s.renderer_token_hash ? "Create a new key" : "Create renderer key"} submitVariant="secondary" className="mt-3 flex flex-col gap-2"><span /></ActionForm>
        </div>
      </Section>

      <Section title="Make a video now">
        <ActionForm action={createCalmVideoAction.bind(null, slug)} submitLabel="Write and prepare a video" pendingLabel="Writing the script and recording the voice…" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-[1fr_200px]">
          <Field label="Topic" htmlFor="calm-topic" hint="Leave empty to take the next one from your list"><Input id="calm-topic" name="topic" placeholder="e.g. a panic attack on the train" /></Field>
          <Field label="Nature" htmlFor="calm-theme"><Select id="calm-theme" name="theme" defaultValue=""><option value="">Next in turn</option>{THEMES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        </ActionForm>
      </Section>

      <Section title="Videos">
        {d.videos.length ? (
          <ul className="flex flex-col gap-3">
            {d.videos.map((v) => {
              const st = STATUS[v.status] ?? { label: v.status, tone: "neutral" as const };
              return (
                <li key={v.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{v.title} {v.is_mock ? <DataFlag kind="mock" /> : null}</p>
                      <p className="text-[12.5px] text-muted">{v.topic} · {v.theme} · {v.lines.length} lines · {formatDateTime(v.created_at)}</p>
                    </div>
                    <Status tone={st.tone}>{v.status === "scheduled" && v.publish_at ? `scheduled ${formatDateTime(v.publish_at)}` : st.label}</Status>
                  </div>
                  {v.error ? <p className="mt-2 rounded-[var(--radius-control)] bg-red-tint px-3 py-2 text-[12.5px] text-red">{v.error}</p> : null}
                  {v.preview_asset_id ? (
                    <video src={`/p/${slug}/creatives/${v.preview_asset_id}`} controls preload="metadata" playsInline className="mt-3 aspect-video w-full max-w-[720px] rounded-[var(--radius-panel)] bg-ink" />
                  ) : null}
                  {v.youtube_video_id && ["review", "scheduled", "published"].includes(v.status) ? (
                    <p className="mt-2 text-[13px]">
                      <a href={`https://studio.youtube.com/video/${v.youtube_video_id}/edit`} target="_blank" rel="noreferrer noopener" className="underline">Watch in YouTube Studio</a>
                      <span className="text-muted"> (private until approved)</span>
                      {v.render_url ? <> · <a href={v.render_url} target="_blank" rel="noreferrer noopener" className="underline">Download the file</a> <span className="text-muted">(GitHub run → Artifacts)</span></> : null}
                    </p>
                  ) : null}
                  {v.status === "review" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionForm action={approveCalmAction.bind(null, slug, v.id, "slot")} submitLabel="Approve and schedule" pendingLabel="Scheduling…" className="flex flex-col gap-1"><span /></ActionForm>
                      <ActionForm action={approveCalmAction.bind(null, slug, v.id, "now")} submitLabel="Approve and publish now" submitVariant="secondary" pendingLabel="Publishing…" className="flex flex-col gap-1"><span /></ActionForm>
                      <form action={rejectCalmAction.bind(null, slug, v.id)}><Button size="sm" variant="ghost">Reject</Button></form>
                    </div>
                  ) : null}
                  {v.status === "failed" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionForm action={retryCalmMediaAction.bind(null, slug, v.id)} submitLabel="Try again" submitVariant="secondary" pendingLabel="Retrying…" className="flex flex-col gap-1"><span /></ActionForm>
                      <form action={rejectCalmAction.bind(null, slug, v.id)}><Button size="sm" variant="ghost">Reject</Button></form>
                    </div>
                  ) : null}
                  {v.status !== "rejected" ? (
                    <ShortsBlock slug={slug} videoId={v.id} lines={v.lines} shorts={d.shorts.filter((x) => x.video_id === v.id)} instagram={d.ig?.status === "connected"} youtube={d.yt?.status === "connected"} />
                  ) : null}
                  <details className="mt-3 text-[13px]">
                    <summary className="cursor-pointer text-muted">Script and description</summary>
                    <ol className="mt-2 grid gap-1 md:grid-cols-2">
                      {v.lines.map((l, i) => <li key={i} className="flex gap-2"><span className="w-6 shrink-0 text-right text-faint">{i + 1}</span><span>{l.text} <span className="text-faint">· {l.pause}s</span></span></li>)}
                    </ol>
                    <pre className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-paper p-3 text-[12px]">{v.description}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No videos yet">Make the first one above. It takes about a minute to write and record; the renderer builds it within two hours.</EmptyState>
        )}
      </Section>

      <Section title="Settings">
        <ActionForm action={saveCalmSettingsAction.bind(null, slug)} submitLabel="Save settings" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-[13.5px] md:col-span-3"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Prepare new videos automatically (each still needs your approval)</label>
          <fieldset className="md:col-span-3">
            <legend className="mb-1 text-[13px] font-medium">Publishing days</legend>
            <div className="flex flex-wrap gap-3 text-[13.5px]">{DAYS.map((d0, i) => <label key={d0} className="flex items-center gap-1.5"><input type="checkbox" name="publish_days" value={i + 1} defaultChecked={s.publish_days.includes(i + 1)} /> {d0}</label>)}</div>
          </fieldset>
          <Field label="Publishing hour (UTC)" htmlFor="calm-hour" hint="16 UTC = 19:00 Riga, 12:00 New York"><Input id="calm-hour" name="publish_hour_utc" type="number" min={0} max={23} defaultValue={s.publish_hour_utc} /></Field>
          <Field label="Length, minutes" htmlFor="calm-min"><Input id="calm-min" name="minutes" type="number" min={3} max={30} defaultValue={s.minutes} /></Field>
          <Field label="Voice" htmlFor="calm-voice"><Select id="calm-voice" name="voice" defaultValue={s.voice}>{VOICES.map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          <fieldset className="md:col-span-3">
            <legend className="mb-1 text-[13px] font-medium">Nature</legend>
            <div className="flex flex-wrap gap-3 text-[13.5px]">{THEMES.map((t) => <label key={t} className="flex items-center gap-1.5"><input type="checkbox" name="themes" value={t} defaultChecked={s.themes.includes(t)} /> {t}</label>)}</div>
          </fieldset>
          <Field label="Topics, one per line (used in turn)" htmlFor="calm-topics" className="md:col-span-3"><Textarea id="calm-topics" name="topics" rows={8} defaultValue={s.topics.join("\n")} /></Field>
        </ActionForm>
      </Section>
    </>
  );
}
