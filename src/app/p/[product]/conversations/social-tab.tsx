import Link from "next/link";
import type { Tx } from "@/server/db/client";
import { getThreadsSettings } from "@/server/services/threads";
import { channelConnection, publishingEnabled } from "@/server/services/youtube-publish";
import { addInstagramReelAction, publishThreadsPostAction, runThreadsDiscoveryAction, saveThreadsSettingsAction, syncInstagramAction, syncThreadsAction } from "@/app/actions/threads";
import { CopyButton } from "@/components/content/copy-button";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState, KeyValue, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatDateTime, formatNumber } from "@/lib/format";
import { groupThreads, ThreadCard, type Thread } from "./youtube-threads";

type Channel = "threads" | "instagram";

export async function loadSocial(tx: Tx, workspaceId: string, productId: string, channel: Channel) {
  return {
    settings: channel === "threads" ? await getThreadsSettings(tx, workspaceId, productId) : null,
    connection: await channelConnection(tx, productId, channel),
    queueRunning: (await tx.maybeOne<{ on: boolean }>("select last_queue_check_at > now() - interval '30 minutes' as on from yt_settings where product_id = $1", [productId]))?.on ?? false,
    lastRun: channel === "threads"
      ? await tx.maybeOne<{ stats: { errors?: string[]; found?: number; draftsQueued?: number }; started_at: string }>(
          "select stats, started_at::text from automation_runs where product_id = $1 and kind = 'threads_discovery' order by started_at desc limit 1", [productId])
      : null,
    posts: await tx.query<{ id: string; url: string | null; author: string | null; text: string; relevance: number; status: string; reason: string; found_at: string; is_demo: boolean }>(
      "select id, url, author, text, relevance, status, reason, found_at::text, is_demo from social_posts where product_id = $1 and channel = $2 order by found_at desc limit 40",
      [productId, channel],
    ),
    threads: await tx.query<Thread>(
      `select c.id, c.subject, c.thread_url, c.external_thread_id, c.risk, c.risk_reason, c.status, c.created_at::text,
              coalesce((select json_agg(json_build_object('id', m.id, 'direction', m.direction, 'author_handle', m.author_handle, 'text', m.text, 'status', m.status,
                                                          'variant', m.variant, 'kind', m.kind, 'voice', m.voice, 'occurred_at', m.occurred_at, 'like_count', m.like_count, 'reply_count', m.reply_count) order by m.occurred_at, m.created_at)
                          from conversation_messages m where m.conversation_id = c.id), '[]') messages
         from conversations c where c.product_id = $1 and c.channel = $2
        order by (c.risk = 'high') desc,
                 exists (select 1 from conversation_messages d where d.conversation_id = c.id and d.direction = 'outbound' and d.status in ('draft', 'approved')) desc,
                 c.created_at desc limit 40`,
      [productId, channel],
    ),
    ownPosts: channel === "threads"
      ? await tx.query<{ id: string; title: string; status: string; scheduled_for: string | null; external_url: string | null; published_at: string | null; views: number | null; likes: number | null; replies: number | null }>(
          `select i.id, i.title, i.status, i.scheduled_for::text, p.external_url, p.published_at::text,
                  (select value::int from metric_latest ml where ml.publication_id = p.id and ml.metric = 'views') views,
                  (select value::int from metric_latest ml where ml.publication_id = p.id and ml.metric = 'likes') likes,
                  (select value::int from metric_latest ml where ml.publication_id = p.id and ml.metric = 'comments') replies
             from content_items i left join publications p on p.content_item_id = i.id
            where i.product_id = $1 and i.channel = 'threads' and i.status in ('approved', 'scheduled', 'published')
            order by coalesce(p.published_at, i.scheduled_for, i.updated_at) desc limit 20`,
          [productId],
        )
      : [],
  };
}

export function SocialTab({ slug, channel, data }: { slug: string; channel: Channel; data: Awaited<ReturnType<typeof loadSocial>> }) {
  const groups = groupThreads(data.threads);
  const connected = data.connection?.status === "connected";
  const canPost = publishingEnabled(channel) && Boolean(data.connection);
  const brand = data.connection?.account_label ?? "Our account";
  // Instagram: only comments under our own reels can be answered from here; other accounts' reels are posted by hand.
  const card = (t: Thread) => {
    const auto = canPost && (channel !== "instagram" || Boolean(t.external_thread_id));
    return <ThreadCard key={t.id} slug={slug} t={t} canPost={auto} brand={brand} connected={connected} queue={auto && data.queueRunning} />;
  };
  return (
    <>
      {channel === "threads" ? <ThreadsHeader slug={slug} data={data} canPost={canPost} /> : <InstagramHeader slug={slug} data={data} canPost={canPost} />}

      <Section title="Live conversations" description="Where people answered us: our comment on top, the replies under it, and the answer the agent drafted.">
        {channel === "instagram" && connected ? (
          <ActionForm action={syncInstagramAction.bind(null, slug)} submitLabel="Check comments on our reels" pendingLabel="Reading Instagram…" submitVariant="secondary" className="mb-3 flex flex-col gap-2"><span /></ActionForm>
        ) : null}
        {channel === "threads" && connected ? (
          <ActionForm action={syncThreadsAction.bind(null, slug)} submitLabel="Check for new replies" pendingLabel="Reading Threads…" submitVariant="secondary" className="mb-3 flex flex-col gap-2"><span /></ActionForm>
        ) : null}
        {groups.live.length ? <ul className="flex flex-col gap-3">{groups.live.map(card)}</ul> : (
          <EmptyState title="No replies yet">
            {channel === "threads" ? "Replies under our Threads replies and posts appear here with an answer drafted." : connected ? "Comments under our reels appear here every morning (or press Check comments on our reels), each with an answer drafted." : "Connect Instagram in Connections to read comments under our reels. Replies to our comments on other people's reels can be pasted into the card."}
          </EmptyState>
        )}
      </Section>

      <Section title={channel === "threads" ? "New replies to approve" : "New comments to approve"} description={channel === "instagram" ? "Approve, then copy the text, open the reel and post it from the Back account. Press “I posted it myself” after." : "Pick a variant, edit it if you like, approve. The other closes by itself."}>
        {groups.fresh.length ? <ul className="flex flex-col gap-3">{groups.fresh.map(card)}</ul> : <EmptyState title="Nothing waits for you">{channel === "threads" ? "Run a search, or try it with demo posts." : "Add a reel above."}</EmptyState>}
      </Section>

      {groups.posted.length || groups.quiet.length ? (
        <Section title="Posted, no replies yet">
          <ul className="flex flex-col gap-1.5 text-[13.5px]">
            {groups.posted.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                <Status tone="green">posted</Status>
                {t.thread_url ? <a href={t.thread_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{t.subject ?? "Open"}</a> : t.subject}
                <span className="text-[12px] text-muted">{formatDateTime(t.created_at)}</span>
              </li>
            ))}
          </ul>
          {groups.quiet.length ? (
            <details className="mt-3 text-[12.5px] text-muted">
              <summary className="cursor-pointer">{groups.quiet.length} closed without posting</summary>
              <ul className="mt-2 flex flex-col gap-3">{groups.quiet.map(card)}</ul>
            </details>
          ) : null}
        </Section>
      ) : null}

      {channel === "threads" ? <ThreadsOwnPosts slug={slug} posts={data.ownPosts} canPost={canPost} /> : null}

      <Section title={channel === "threads" ? "Posts found" : "Reels added"} description="Every post with the reason it was or was not picked.">
        {data.posts.length ? (
          <Table>
            <thead><tr><th>Post</th><th>Relevance</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>
              {data.posts.map((p) => (
                <tr key={p.id}>
                  <td className="min-w-[260px] max-w-[420px]">
                    <p className="line-clamp-2">{p.text}</p>
                    <div className="text-[12px] text-muted">{p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{p.author ?? "open"}</a> : p.author}{p.is_demo ? " · demo" : ""}</div>
                  </td>
                  <td className="num">{p.relevance}</td>
                  <td><Status tone={p.status === "skipped" || p.status === "rejected" ? "neutral" : p.status === "published" ? "green" : "amber"}>{p.status}</Status></td>
                  <td className="min-w-[220px] text-muted">{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState title="Nothing yet" />}
      </Section>

      {channel === "threads" && data.settings ? (
        <Section title="Settings">
          <ActionForm action={saveThreadsSettingsAction.bind(null, slug)} submitLabel="Save settings" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
            <label className="flex items-center gap-2 text-[13.5px] md:col-span-3"><input type="checkbox" name="enabled" defaultChecked={data.settings.enabled} /> Search Threads once a day and prepare drafts</label>
            <Field label="Search phrases, one per line" htmlFor="th-q" className="md:col-span-3"><Textarea id="th-q" name="queries" rows={5} defaultValue={data.settings.queries.join("\n")} /></Field>
            <Field label="Drafts per search" htmlFor="th-dr"><Input id="th-dr" name="drafts_per_run" type="number" min={0} max={10} defaultValue={data.settings.drafts_per_run} /></Field>
            <Field label="Answer the same person at most every, days" htmlFor="th-cd"><Input id="th-cd" name="author_cooldown_days" type="number" min={1} defaultValue={data.settings.author_cooldown_days} /></Field>
          </ActionForm>
        </Section>
      ) : null}
    </>
  );
}

function ThreadsHeader({ slug, data, canPost }: { slug: string; data: Awaited<ReturnType<typeof loadSocial>>; canPost: boolean }) {
  const c = data.connection;
  return (
    <Section
      title="How it works"
      description="Once a day the agent searches Threads for posts about panic in the moment, skips the ones where the team should not step in (crisis, ads, kids), and drafts a short, warm reply for the best few. You approve each one; approved replies go out one by one from the team's account. Replies people write back come here with an answer drafted."
    >
      <KeyValue
        items={[
          ["Threads account", c ? <Status tone={c.status === "connected" ? "green" : "red"}>{c.status === "connected" ? c.account_label : `Paused: ${c.paused_reason ?? c.status}`}</Status> : <span><Status tone="amber">Not connected</Status> <Link href={`/p/${slug}/connections`} className="ml-2 underline">Connect in Connections</Link></span>],
          ["Posting", canPost ? <Status tone="green">After your approval only, 10 min apart, 8:00–23:00</Status> : <Status>Off: add THREADS_PUBLISHING_ENABLED=true and connect the account</Status>],
          ["Search", "Until Meta approves keyword search for the app, Threads returns only the team's own posts. Replies under our posts work right away."],
          ["Daily search", data.settings?.enabled ? <Status tone="green">On</Status> : <Status>Off (Settings below)</Status>],
          ["Last search", data.settings?.last_run_at ? `${formatDateTime(data.settings.last_run_at)}${data.lastRun ? ` · ${data.lastRun.stats.found ?? 0} posts, ${data.lastRun.stats.draftsQueued ?? 0} drafts` : ""}` : "Never"],
        ]}
      />
      {data.lastRun?.stats.errors?.length ? (
        <ul className="mt-3 list-disc rounded-[var(--radius-control)] bg-red-tint px-8 py-2 text-[12.5px] text-red">{data.lastRun.stats.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionForm action={runThreadsDiscoveryAction.bind(null, slug, "api")} submitLabel="Find posts now" pendingLabel="Searching…" className="flex flex-col gap-2"><span /></ActionForm>
        <ActionForm action={runThreadsDiscoveryAction.bind(null, slug, "demo")} submitLabel="Try with demo posts" submitVariant="secondary" pendingLabel="Drafting…" className="flex flex-col gap-2"><span /></ActionForm>
      </div>
    </Section>
  );
}

function ThreadsOwnPosts({ slug, posts, canPost }: { slug: string; posts: Awaited<ReturnType<typeof loadSocial>>["ownPosts"]; canPost: boolean }) {
  return (
    <Section title="Our Threads posts" description="Posts are written and approved in Content Studio (channel Threads). Approved posts are published from here or, when placed on the calendar, at their time.">
      <p className="mb-3 text-[13px]"><Link href={`/p/${slug}/ideas`} className="underline">Write a new Threads post</Link> <span className="text-muted">(Hooks & Ideas → choose Threads → short post)</span></p>
      {posts.length ? (
        <Table>
          <thead><tr><th>Post</th><th>Status</th><th className="text-right">Views</th><th className="text-right">Likes</th><th className="text-right">Replies</th><th /></tr></thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td className="min-w-[220px]"><Link href={`/p/${slug}/studio/${p.id}`} className="underline underline-offset-2">{p.title}</Link>{p.external_url ? <div className="text-[12px]"><a href={p.external_url} target="_blank" rel="noreferrer noopener" className="text-muted underline">open on Threads</a></div> : null}</td>
                <td className="whitespace-nowrap">{p.status === "scheduled" && p.scheduled_for ? `scheduled ${formatDateTime(p.scheduled_for)}` : p.status === "published" && p.published_at ? `published ${formatDateTime(p.published_at)}` : p.status}</td>
                <td className="num text-right">{p.views === null ? "—" : formatNumber(p.views)}</td>
                <td className="num text-right">{p.likes === null ? "—" : formatNumber(p.likes)}</td>
                <td className="num text-right">{p.replies === null ? "—" : formatNumber(p.replies)}</td>
                <td>{p.status !== "published" && canPost ? <ActionForm action={publishThreadsPostAction.bind(null, slug, p.id)} submitLabel="Publish now" pendingLabel="Publishing…" className="flex flex-col gap-1"><span /></ActionForm> : null}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="No approved Threads posts yet" />}
    </Section>
  );
}

function InstagramHeader({ slug, data, canPost }: { slug: string; data: Awaited<ReturnType<typeof loadSocial>>; canPost: boolean }) {
  const c = data.connection;
  return (
    <Section
      title="How it works"
      description="Comments under our own reels: read every morning, an answer drafted for each, approved by you, posted automatically one by one. Other people's reels: Instagram does not let apps comment there, so you add a reel you found, the agent drafts a warm, specific comment, you approve it, copy it and post it yourself."
    >
      <KeyValue
        items={[
          ["Instagram account", c ? <Status tone={c.status === "connected" ? "green" : "red"}>{c.status === "connected" ? c.account_label : `Paused: ${c.paused_reason ?? c.status}`}</Status> : <span><Status tone="amber">Not connected</Status> <Link href={`/p/${slug}/connections`} className="ml-2 underline">Connect in Connections</Link></span>],
          ["Replies under our reels", canPost ? <Status tone="green">After your approval only, 10 min apart, 8:00–23:00</Status> : <Status>Off: add INSTAGRAM_PUBLISHING_ENABLED=true and connect the account</Status>],
          ["Comments on other reels", "Drafted here, posted by you"],
        ]}
      />
      <p className="mb-2 mt-5 text-[13.5px] font-medium">Add someone else&apos;s reel</p>
      <ActionForm action={addInstagramReelAction.bind(null, slug)} submitLabel="Draft a comment" pendingLabel="Reading the reel…" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-[1fr_200px]">
        <Field label="Reel link" htmlFor="ig-url"><Input id="ig-url" name="url" type="url" placeholder="https://www.instagram.com/reel/…" required /></Field>
        <Field label="Author" htmlFor="ig-author"><Input id="ig-author" name="author" placeholder="@account" /></Field>
        <Field label="What the reel says or shows" htmlFor="ig-text" className="md:col-span-2" hint="Paste the caption, or describe it in a sentence or two. The comment will pick up a detail from it.">
          <Textarea id="ig-text" name="text" rows={3} required />
        </Field>
      </ActionForm>
      <p className="mt-2 text-[12.5px] text-muted">Finding reels: search Instagram for #паническаяатака, #panicattack, #anxietyrelief, open recent reels, copy the link. <CopyButton text="#panicattack #panicattacks #anxietyrelief #паническаяатака #тревога" label="Copy hashtags" /></p>
    </Section>
  );
}
