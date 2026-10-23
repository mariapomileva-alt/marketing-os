import type { Tx } from "@/server/db/client";
import { getYtSettings } from "@/server/services/youtube";
import { runYtDiscoveryAction, saveYtSettingsAction, syncYtRepliesAction } from "@/app/actions/youtube";
import { publishingEnabled, youtubeConnection } from "@/server/services/youtube-publish";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { groupThreads, ThreadCard, type Thread } from "./youtube-threads";
import { EmptyState, KeyValue, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { DataFlag } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

export async function loadYoutube(tx: Tx, workspaceId: string, productId: string) {
  return {
    settings: await getYtSettings(tx, workspaceId, productId),
    connection: await youtubeConnection(tx, productId),
    ...(await tx.one<{ queueCheckedAt: string | null; queueRunning: boolean }>(
      `select (select last_queue_check_at::text from yt_settings where product_id = $1) "queueCheckedAt",
              coalesce((select last_queue_check_at > now() - interval '30 minutes' from yt_settings where product_id = $1), false) "queueRunning"`,
      [productId],
    )),
    lastRun: await tx.maybeOne<{ stats: { errors?: string[]; draftsQueued?: number; found?: number }; started_at: string }>(
      "select stats, started_at::text from automation_runs where product_id = $1 and kind = 'youtube_discovery' order by started_at desc limit 1",
      [productId],
    ),
    aiErrors: await tx.query<{ error: string; created_at: string }>(
      "select error, created_at::text from agent_runs where product_id = $1 and error is not null and step like 'community%' and created_at > now() - interval '2 days' order by created_at desc limit 3",
      [productId],
    ),
    videos: await tx.query<{ id: string; title: string; url: string; channel_title: string; relevance: number; status: string; reason: string; found_at: string; is_demo: boolean }>(
      "select id, title, url, channel_title, relevance, status, reason, found_at::text, is_demo from yt_videos where product_id = $1 order by found_at desc, relevance desc limit 60",
      [productId],
    ),
    threads: await tx.query<Thread>(
      `select c.id, c.subject, c.thread_url, c.external_thread_id, c.risk, c.risk_reason, c.status, c.created_at::text,
              coalesce((select json_agg(json_build_object('id', m.id, 'direction', m.direction, 'author_handle', m.author_handle, 'text', m.text, 'status', m.status,
                                                          'variant', m.variant, 'kind', m.kind, 'voice', m.voice, 'occurred_at', m.occurred_at, 'like_count', m.like_count, 'reply_count', m.reply_count) order by m.occurred_at, m.created_at)
                          from conversation_messages m where m.conversation_id = c.id), '[]') messages
         from conversations c where c.product_id = $1 and c.channel = 'youtube'
        order by (c.risk = 'high') desc,
                 exists (select 1 from conversation_messages d where d.conversation_id = c.id and d.direction = 'outbound' and d.status in ('draft', 'approved')) desc,
                 c.created_at desc limit 40`,
      [productId],
    ),
  };
}

export function YoutubeTab({ slug, data }: { slug: string; data: Awaited<ReturnType<typeof loadYoutube>> }) {
  const s = data.settings;
  const apiKey = Boolean(process.env.YOUTUBE_API_KEY);
  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const publishing = publishingEnabled();
  const connected = data.connection?.status === "connected";
  const canPost = publishing && Boolean(data.connection);
  const brand = data.connection?.account_label ?? s.brand_name ?? "Our channel";
  const groups = groupThreads(data.threads);
  const queueRunning = data.queueRunning;
  const waiting = data.threads.reduce((n, t) => n + t.messages.filter((m) => m.direction === "outbound" && m.status === "draft").length, 0);
  const toPost = data.threads.reduce((n, t) => n + t.messages.filter((m) => m.direction === "outbound" && m.status === "approved").length, 0);
  return (
    <>
      <Section title="Start here">
        <ol className="grid gap-3 text-[13.5px] md:grid-cols-4">
          {[
            ["1. Read", `Below, each card is one video. ${waiting ? `${waiting} draft${waiting === 1 ? "" : "s"} wait for you.` : "Nothing waits for you right now."}`],
            ["2. Choose", canPost ? "Change any words right in the box, then press Approve: it goes out from your channel. Reject the ones you would not post." : "Pick the variant you like, change any words right in the box, then press Approve. Reject the ones you would not post."],
            ["3. Post", canPost ? `Approve as many as you like: they go out on their own, one every 10 minutes, 8:00–23:00${toPost ? `. ${toPost} in the queue now` : ""}.` : `${toPost ? `${toPost} approved comment${toPost === 1 ? "" : "s"} to post. ` : ""}Copy the text, post it as the channel, press “I posted it myself”. To post from here, connect the channel in Connections.`],
            ["4. Keep talking", connected ? "Replies to our comments appear under Live conversations with an answer drafted. Approve it the same way." : "When someone answers us, paste their words into the card; the agent drafts an answer that reads the whole thread."],
          ].map(([h, b]) => (
            <li key={h} className="rounded-[var(--radius-panel)] border border-line bg-surface p-3">
              <p className="font-medium">{h}</p>
              <p className="mt-1 text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section
        title="How it works"
        description="Once a day the agent looks for fresh YouTube videos about panic in the moment, skips the ones where a comment from the team would be wrong, and drafts a warm, specific comment for the best few. Every comment and every reply waits for your approval. The team always says who it is and never pretends to be a viewer."
      >
        <KeyValue
          items={[
            ["Daily search", s.enabled ? <Status tone="green">On</Status> : <Status>Off</Status>],
            ["YouTube access", apiKey ? <Status tone="green">API key set (read-only)</Status> : <Status tone="amber">Not set: add YOUTUBE_API_KEY</Status>],
            ["Telegram alerts", telegram ? <Status tone="green">On</Status> : <Status tone="amber">Not set: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID</Status>],
            ["Posting", canPost ? (connected ? <Status tone="green">{`From ${data.connection!.account_label}, after your approval only`}</Status> : <Status tone="red">{`Paused: ${data.connection!.paused_reason ?? "see Connections"}`}</Status>) : publishing ? <Status tone="amber">Channel not connected: Connections → Connect YouTube channel</Status> : <Status>Off: you post approved comments yourself</Status>],
            ["Posting queue", !canPost ? "Used once the channel is connected" : queueRunning ? <Status tone="green">{`Running: approved texts go out one by one, 10 min apart, 8:00–23:00 (checked ${formatDateTime(data.queueCheckedAt!)})`}</Status> : <Status tone="amber">Not running yet: approved texts wait for “Post now”</Status>],
            ["Last search", s.last_run_at ? `${formatDateTime(s.last_run_at)}${data.lastRun ? ` · ${data.lastRun.stats.found ?? 0} videos, ${data.lastRun.stats.draftsQueued ?? 0} new drafts` : ""}` : "Never"],
          ]}
        />
        {data.lastRun?.stats.errors?.length || data.aiErrors.length ? (
          <div className="mt-3 rounded-[var(--radius-control)] bg-red-tint px-3 py-2 text-[12.5px] text-red">
            <p className="font-medium">Problems in the last runs</p>
            <ul className="mt-1 list-disc pl-5">
              {(data.lastRun?.stats.errors ?? []).map((e) => <li key={e}>{e}</li>)}
              {data.aiErrors.map((e) => <li key={e.created_at}>AI draft failed ({formatDateTime(e.created_at)}): {e.error}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionForm action={runYtDiscoveryAction.bind(null, slug, "api")} submitLabel="Find videos now" pendingLabel="Searching…" className="flex flex-col gap-2"><span /></ActionForm>
          <ActionForm action={runYtDiscoveryAction.bind(null, slug, "demo")} submitLabel="Try with demo videos" submitVariant="secondary" pendingLabel="Drafting…" className="flex flex-col gap-2"><span /></ActionForm>
        </div>
      </Section>

      <Section
        title="Live conversations"
        description="Threads where people answered us. Our comment on top, the replies under it, and the answer the agent drafted, waiting for you."
      >
        {connected ? (
          <ActionForm action={syncYtRepliesAction.bind(null, slug)} submitLabel="Check for new replies" pendingLabel="Reading YouTube…" submitVariant="secondary" className="mb-3 flex flex-col gap-2"><span /></ActionForm>
        ) : null}
        {groups.live.length ? (
          <ul className="flex flex-col gap-3">{groups.live.map((t) => <ThreadCard key={t.id} slug={slug} t={t} canPost={canPost} brand={brand} connected={connected} queue={queueRunning} />)}</ul>
        ) : (
          <EmptyState title="No replies yet">{connected ? "Replies are checked every morning and when you press Check for new replies." : "Once comments are posted from here, replies show up on their own."}</EmptyState>
        )}
      </Section>

      <Section title="New comments to approve" description="One card per video. Two variants: pick one, edit it if you like, approve. The other closes by itself.">
        {groups.fresh.length ? (
          <ul className="flex flex-col gap-3">{groups.fresh.map((t) => <ThreadCard key={t.id} slug={slug} t={t} canPost={canPost} brand={brand} connected={connected} queue={queueRunning} />)}</ul>
        ) : (
          <EmptyState title="Nothing waits for you">Run a search, or try it with demo videos.</EmptyState>
        )}
      </Section>

      {groups.posted.length || groups.quiet.length ? (
        <Section title="Posted, no replies yet">
          <ul className="flex flex-col gap-1.5 text-[13.5px]">
            {groups.posted.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                <Status tone="green">posted</Status>
                {t.thread_url ? <a href={t.thread_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{t.subject ?? "Video"}</a> : t.subject}
                <span className="text-[12px] text-muted">{formatDateTime(t.created_at)}</span>
              </li>
            ))}
          </ul>
          {groups.quiet.length ? (
            <details className="mt-3 text-[12.5px] text-muted">
              <summary className="cursor-pointer">{groups.quiet.length} closed without posting</summary>
              <ul className="mt-2 flex flex-col gap-3">{groups.quiet.map((t) => <ThreadCard key={t.id} slug={slug} t={t} canPost={canPost} brand={brand} connected={connected} queue={queueRunning} />)}</ul>
            </details>
          ) : null}
        </Section>
      ) : null}

      <Section title="Videos found" description="Every video the search returned, with the reason it was or was not picked.">
        {data.videos.length ? (
          <Table>
            <thead><tr><th>Video</th><th>Relevance</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>
              {data.videos.map((v) => (
                <tr key={v.id}>
                  <td className="min-w-[220px]">
                    <a href={v.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{v.title}</a>
                    <div className="text-[12px] text-muted">{v.channel_title}{v.is_demo ? " · demo" : ""}</div>
                  </td>
                  <td className="num">{v.relevance}</td>
                  <td><Status tone={v.status === "skipped" || v.status === "rejected" ? "neutral" : v.status === "published" ? "green" : "amber"}>{v.status}</Status></td>
                  <td className="min-w-[240px] text-muted">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No videos yet" />
        )}
      </Section>

      <Section title="Settings">
        <ActionForm action={saveYtSettingsAction.bind(null, slug)} submitLabel="Save settings" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-[13.5px] md:col-span-3">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Search once a day and prepare drafts
          </label>
          <Field label="Product name in comments" htmlFor="yt-brand" hint="How the team names it, e.g. Back"><Input id="yt-brand" name="brand_name" defaultValue={s.brand_name ?? ""} /></Field>
          <Field label="Languages" htmlFor="yt-lang" hint="Two-letter codes"><Input id="yt-lang" name="languages" defaultValue={s.languages.join(", ")} /></Field>
          <Field label="Videos from the last, days" htmlFor="yt-days"><Input id="yt-days" name="published_within_days" type="number" min={1} max={90} defaultValue={s.published_within_days} /></Field>
          <Field label="Search phrases, one per line" htmlFor="yt-q" className="md:col-span-3" hint="Up to 150. YouTube's daily quota allows about 15 searches a day, so a longer list is searched 15 phrases a day in turn."><Textarea id="yt-q" name="queries" rows={6} defaultValue={s.queries.join("\n")} /></Field>
          <Field label="Skip videos shorter than, seconds" htmlFor="yt-min"><Input id="yt-min" name="min_duration_seconds" type="number" min={0} defaultValue={s.min_duration_seconds} /></Field>
          <Field label="One comment per channel every, days" htmlFor="yt-cd"><Input id="yt-cd" name="channel_cooldown_days" type="number" min={1} defaultValue={s.channel_cooldown_days} /></Field>
          <Field label="Drafts per search" htmlFor="yt-dr"><Input id="yt-dr" name="drafts_per_run" type="number" min={0} max={10} defaultValue={s.drafts_per_run} /></Field>
          <Field label="Comments per day, at most" htmlFor="yt-pl" hint="Applies when publishing is switched on"><Input id="yt-pl" name="daily_publish_limit" type="number" min={0} max={10} defaultValue={s.daily_publish_limit} /></Field>
        </ActionForm>
      </Section>
    </>
  );
}
