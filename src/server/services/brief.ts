import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";
import { runAgent } from "./content";
import { morningBriefSchema, type MorningBriefOutput } from "@/domain/ai/schemas";
import { AI_SOURCES, SOURCE_LABEL, type Source } from "@/domain/traffic";
import { pagePerformance } from "./traffic";

/**
 * The owner's morning brief. Facts are counted here, in SQL, so every number in the brief comes from the database;
 * the model only explains them in plain language, picks today's actions and looks outside (web search) for trends
 * and what competitors did. A spoken version is voiced with the workspace's OpenAI key when one is connected.
 */
export const BRIEF_SECTIONS: Record<string, string> = {
  overview: "Today", analytics: "Analytics (site visitors, sources, articles)", conversations: "Conversations (comments and replies on YouTube, Threads, Instagram)",
  approvals: "Approval Queue", calm: "Calm Videos (long videos and shorts)", knowledge: "Knowledge (our articles and methodology)",
  studio: "Content Studio (posts)", ideas: "Hooks & Ideas", competitors: "Competitors", connections: "Connections (integrations)", calendar: "Calendar",
};

type Win = { yesterday: number; last7: number; prev7: number };

export async function gatherFacts(tx: Tx, productId: string) {
  const t0 = (await tx.one<{ t0: string }>("select (date_trunc('day', now() at time zone 'Europe/Riga') at time zone 'Europe/Riga')::text t0")).t0;
  const day = (await tx.one<{ d: string }>("select to_char(now() at time zone 'Europe/Riga', 'YYYY-MM-DD') d")).d;
  // $2 = start of today (Riga). Windows: yesterday, last 7 full days, the 7 days before.
  const wins = (defs: Array<[string, string]>, col: string) =>
    defs.flatMap(([k, cond]) => [
      `count(*) filter (where ${cond} and ${col} >= $2::timestamptz - interval '1 day' and ${col} < $2::timestamptz)::int ${k}_y`,
      `count(*) filter (where ${cond} and ${col} >= $2::timestamptz - interval '7 days' and ${col} < $2::timestamptz)::int ${k}_w`,
      `count(*) filter (where ${cond} and ${col} >= $2::timestamptz - interval '14 days' and ${col} < $2::timestamptz - interval '7 days')::int ${k}_p`,
    ]).join(", ");
  const triple = (r: Record<string, number>, k: string): Win => ({ yesterday: r[`${k}_y`], last7: r[`${k}_w`], prev7: r[`${k}_p`] });
  const siteRow = await tx.one<Record<string, number>>(
    `select ${wins([["visits", "kind = 'pageview'"], ["app_store", "kind = 'app_store_click'"], ["ai", "kind = 'pageview' and source = any($3)"], ["direct", "kind = 'pageview' and source = 'direct'"]], "occurred_at")}
       from site_events where product_id = $1`,
    [productId, t0, [...AI_SOURCES]],
  );
  const sources = await tx.query<{ source: string; visits: number; app_store_clicks: number }>(
    `select source, count(*) filter (where kind = 'pageview')::int visits, count(*) filter (where kind = 'app_store_click')::int app_store_clicks
       from site_events where product_id = $1 and occurred_at >= $2::timestamptz - interval '7 days' and occurred_at < $2::timestamptz group by source order by visits desc limit 8`,
    [productId, t0],
  );
  const pages = (await pagePerformance(tx, productId, new Date(Date.parse(t0) - 7 * 86_400_000), AI_SOURCES)).slice(0, 5);

  const convRow = await tx.one<Record<string, number>>(
    `select ${wins([
      ["yt_posted", "c.channel = 'youtube' and m.direction = 'outbound' and m.status = 'posted'"], ["yt_replies_in", "c.channel = 'youtube' and m.direction = 'inbound'"],
      ["threads_posted", "c.channel = 'threads' and m.direction = 'outbound' and m.status = 'posted'"], ["threads_in", "c.channel = 'threads' and m.direction = 'inbound'"],
      ["ig_posted", "c.channel = 'instagram' and m.direction = 'outbound' and m.status = 'posted'"], ["ig_in", "c.channel = 'instagram' and m.direction = 'inbound'"],
    ], "m.occurred_at")}
       from conversation_messages m join conversations c on c.id = m.conversation_id where m.product_id = $1`,
    [productId, t0],
  );
  const likes = await tx.one<{ likes: number; replies: number }>(
    `select coalesce(sum(m.like_count), 0)::int likes, coalesce(sum(m.reply_count), 0)::int replies from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'youtube' and m.direction = 'outbound' and m.status = 'posted' and m.occurred_at >= now() - interval '30 days'`,
    [productId],
  );
  const bestComment = await tx.maybeOne<{ text: string; like_count: number | null; reply_count: number | null; video: string | null }>(
    `select m.text, m.like_count, m.reply_count, c.subject video from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'youtube' and m.direction = 'outbound' and m.status = 'posted' and m.occurred_at >= now() - interval '30 days'
        and coalesce(m.like_count, 0) + coalesce(m.reply_count, 0) > 0
      order by coalesce(m.like_count, 0) + 2 * coalesce(m.reply_count, 0) desc limit 1`,
    [productId],
  );
  const waiting = await tx.one<Record<string, number>>(
    `select (select count(*)::int from approval_items where product_id = $1 and state = 'pending') approvals,
            (select count(*)::int from conversations where product_id = $1 and status = 'needs_reply' and channel = 'youtube') youtube_needs_reply,
            (select count(*)::int from conversations where product_id = $1 and status = 'needs_reply' and channel = 'threads') threads_needs_reply,
            (select count(*)::int from conversations where product_id = $1 and status = 'needs_reply' and channel = 'instagram') instagram_needs_reply,
            (select count(*)::int from calm_videos where product_id = $1 and status = 'review') calm_videos_to_watch,
            (select count(*)::int from calm_shorts where product_id = $1 and status = 'review') shorts_to_watch,
            (select count(*)::int from calm_shorts where product_id = $1 and status = 'planned') shorts_not_chosen`,
    [productId],
  );
  const calm = await tx.one<Record<string, number | string | null>>(
    `select (select count(*)::int from calm_videos where product_id = $1 and status in ('scheduled', 'published') and publish_at >= now() - interval '7 days' and publish_at < now()) videos_published_7d,
            (select count(*)::int from calm_shorts where product_id = $1 and status in ('scheduled', 'published') and publish_at >= now() - interval '7 days' and publish_at < now()) shorts_published_7d,
            (select to_char(min(publish_at) at time zone 'Europe/Riga', 'YYYY-MM-DD HH24:MI') || ' Riga time' from calm_videos where product_id = $1 and status = 'scheduled' and publish_at > now()) next_video_at,
            (select count(*)::int from calm_videos where product_id = $1 and status = 'failed' and updated_at > now() - interval '3 days') videos_failed_recently`,
    [productId],
  );
  const connections = await tx.query<{ channel: string; status: string; problem: string | null }>(
    "select channel, status, coalesce(paused_reason, last_error) problem from channel_connections where product_id = $1 and status <> 'revoked'", [productId]);
  const site = await tx.maybeOne<{ domain: string | null }>("select domain from site_settings where product_id = $1", [productId]);
  const competitors = await tx.query<{ name: string; website_url: string | null; positioning: string }>(
    "select name, website_url, positioning from competitors where product_id = $1 order by created_at limit 8", [productId]);
  const product = await tx.one<{ name: string; short_description: string }>("select name, short_description from products where id = $1", [productId]);

  const connected = new Set(connections.filter((c) => c.status === "connected").map((c) => c.channel));
  return {
    day,
    product: { name: product.name, about: product.short_description, website: site?.domain ?? null },
    website: {
      visits: triple(siteRow, "visits"), app_store_clicks: triple(siteRow, "app_store"), from_ai_assistants: triple(siteRow, "ai"), direct_unknown: triple(siteRow, "direct"),
      top_sources_7d: sources.map((s) => ({ source: SOURCE_LABEL[s.source as Source] ?? s.source, visits: s.visits, app_store_clicks: s.app_store_clicks })),
      top_landing_pages_7d: pages.map((p) => ({ page: p.path, visits_started: p.entries, from_ai: p.ai, from_search: p.search, app_store_clicks: p.app_store_clicks })),
    },
    community: {
      youtube: { our_comments_posted: triple(convRow, "yt_posted"), replies_from_people: triple(convRow, "yt_replies_in"), likes_on_our_comments_30d: likes.likes, replies_on_our_comments_30d: likes.replies,
        best_comment_30d: bestComment ? { text: bestComment.text.slice(0, 200), likes: bestComment.like_count ?? 0, replies: bestComment.reply_count ?? 0, video: bestComment.video } : null },
      threads: { our_posts_and_replies: triple(convRow, "threads_posted"), messages_from_people: triple(convRow, "threads_in") },
      instagram: { our_replies: triple(convRow, "ig_posted"), comments_from_people: triple(convRow, "ig_in") },
    },
    calm_videos: calm,
    waiting_for_you: waiting,
    integrations: connections.map((c) => ({ channel: c.channel, status: c.status, problem: c.problem })),
    not_connected: [
      "Sales, installs and revenue: App Store Connect is not connected, so the system cannot see downloads or purchases.",
      ...(["youtube", "threads", "instagram"].filter((c) => !connected.has(c)).map((c) => `${c} is not connected.`)),
    ],
    competitors,
    sections: BRIEF_SECTIONS,
  };
}
export type BriefFacts = Awaited<ReturnType<typeof gatherFacts>>;

export interface BriefVoice {
  speak(text: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

export async function createBrief(tx: Tx, actor: Actor, productId: string, voice: BriefVoice | null, opts: { language?: string; webSearch?: boolean } = {}) {
  const facts = await gatherFacts(tx, productId);
  const language = opts.language ?? "ru";
  const wf = await tx.one<{ id: string }>(
    "insert into workflow_runs (workspace_id, product_id, workflow, input, status, current_step) values ($1,$2,'morning_brief',$3,'running','brief') returning id",
    [actor.workspaceId, productId, JSON.stringify({ day: facts.day })],
  );
  const args = { actor, productId, workflowRunId: wf.id, step: "morning_brief", task: "morning_brief" as const, promptKey: "morning_brief.v1", schema: morningBriefSchema, sourceIds: [], maxTokens: 6000,
    input: { LANGUAGE: language === "ru" ? "Russian" : "English", FACTS: facts } };
  let webSearch = opts.webSearch ?? true;
  let r: { output: MorningBriefOutput; agentRunId: string; isMock: boolean };
  try {
    r = await runAgent(tx, { ...args, webSearch });
  } catch (e) {
    // Web search can be switched off for the organisation; the brief still works without the outside section.
    if (!webSearch || !/web_search|tool|search/i.test((e as Error).message)) throw e;
    webSearch = false;
    r = await runAgent(tx, { ...args, webSearch: false });
  }
  let audioPath: string | null = null;
  let error: string | null = null;
  if (voice && !r.isMock) {
    try {
      const key = `${actor.workspaceId}/${productId}/briefs/${facts.day}-${Date.now()}.mp3`;
      await voice.put(key, await voice.speak(r.output.spoken));
      audioPath = key;
    } catch (e) {
      error = `Voice: ${(e as Error).message.slice(0, 200)}`;
    }
  }
  await tx.query("update workflow_runs set status = 'completed', current_step = 'done' where id = $1", [wf.id]);
  return tx.one<{ id: string }>(
    `insert into daily_briefs (workspace_id, product_id, day, facts, brief, audio_path, language, is_mock, web_search, agent_run_id, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (product_id, day) do update set facts = excluded.facts, brief = excluded.brief, audio_path = excluded.audio_path, language = excluded.language,
       is_mock = excluded.is_mock, web_search = excluded.web_search, agent_run_id = excluded.agent_run_id, error = excluded.error, updated_at = now(), created_at = now()
     returning id`,
    [actor.workspaceId, productId, facts.day, JSON.stringify(facts), JSON.stringify(r.output), audioPath, language, r.isMock, webSearch, r.agentRunId, error],
  );
}

export async function latestBrief(tx: Tx, productId: string) {
  return tx.maybeOne<{ id: string; day: string; facts: BriefFacts; brief: MorningBriefOutput | null; audio_path: string | null; is_mock: boolean; web_search: boolean; error: string | null; created_at: string }>(
    "select id, day::text, facts, brief, audio_path, is_mock, web_search, error, created_at::text from daily_briefs where product_id = $1 order by day desc limit 1",
    [productId],
  );
}
