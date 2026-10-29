import { styleNotes } from "@/domain/youtube";
import { productBrief } from "./marketing-brief";
import { deskRules } from "./content-desk";
import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";
import { decideApproval, editContent, runAgent, runReviews, scheduleItem, submitForApproval } from "./content";
import { draftingKnowledge } from "./knowledge-context";
import { threadsBatchSchema, type ThreadsBatchOutput } from "@/domain/ai/schemas";
import { taggedUrl } from "@/domain/traffic";
import { reactionScore } from "@/domain/threads-studio";
import type { ThreadsInsights } from "@/server/threads/api";

/**
 * Threads Studio: our own Threads posts, written daily from our articles, knowledge and product facts (and, when
 * allowed, one current trend). Every post passes the product's safety rules and the AI reviews, waits for the owner's
 * approval, then goes out at the next free slot through the posting queue. Reactions are read back per post, so the
 * next batch leans towards what works.
 */
export interface StudioSettings {
  enabled: boolean;
  posts_per_day: number;
  slots: string[];
  language: string;
  web_trends: boolean;
  last_generated_at: string | null;
}

export async function getStudioSettings(tx: Tx, workspaceId: string, productId: string): Promise<StudioSettings> {
  await tx.query("insert into threads_studio_settings (product_id, workspace_id) values ($1, $2) on conflict (product_id) do nothing", [productId, workspaceId]);
  return tx.one<StudioSettings>("select enabled, posts_per_day, slots, language, web_trends, last_generated_at::text from threads_studio_settings where product_id = $1", [productId]);
}

export async function updateStudioSettings(tx: Tx, workspaceId: string, productId: string, s: Omit<StudioSettings, "last_generated_at">) {
  await getStudioSettings(tx, workspaceId, productId);
  const slots = [...new Set(s.slots.filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)))].sort();
  if (!slots.length) throw new Error("Add at least one posting time, like 09:30.");
  await tx.query(
    "update threads_studio_settings set enabled = $2, posts_per_day = $3, slots = $4, language = $5, web_trends = $6 where product_id = $1",
    [productId, s.enabled, s.posts_per_day, slots, s.language, s.web_trends],
  );
}

const engagement = reactionScore;

/** What the generator should know about past results: formats and topics by average reactions, best posts. */
export async function performanceSummary(tx: Tx, productId: string) {
  const rows = await tx.query<{ format: string; topic: string; text: string; views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null }>(
    `select m.format, m.topic, coalesce(v.body->>'body', '') text, m.views, m.likes, m.replies, m.reposts, m.quotes
       from threads_studio_posts m join content_items i on i.id = m.content_item_id join content_versions v on v.id = i.current_version_id
      where m.product_id = $1 and i.status = 'published' and m.stats_checked_at is not null order by i.published_at desc limit 60`,
    [productId],
  );
  const byFormat = new Map<string, { n: number; views: number; score: number }>();
  for (const r of rows) {
    const f = byFormat.get(r.format) ?? { n: 0, views: 0, score: 0 };
    f.n++;
    f.views += r.views ?? 0;
    f.score += engagement(r);
    byFormat.set(r.format, f);
  }
  return {
    published_with_stats: rows.length,
    by_format: [...byFormat.entries()].map(([format, f]) => ({ format, posts: f.n, avg_views: Math.round(f.views / f.n), avg_reactions: Math.round((f.score / f.n) * 10) / 10 }))
      .sort((a, b) => b.avg_reactions - a.avg_reactions),
    best_posts: [...rows].sort((a, b) => engagement(b) - engagement(a)).slice(0, 3)
      .map((r) => ({ format: r.format, text: r.text.slice(0, 220), views: r.views ?? 0, likes: r.likes ?? 0, replies: r.replies ?? 0, reposts: (r.reposts ?? 0) + (r.quotes ?? 0) })),
    note: rows.length < 10 ? "Fewer than 10 measured posts: treat this as an early signal, keep experimenting." : "",
  };
}

/** Writes a batch of posts and sends the ones that pass review to approval. */
export async function generateThreadsPosts(tx: Tx, actor: Actor, productId: string, count?: number) {
  const s = await getStudioSettings(tx, actor.workspaceId, productId);
  const n = Math.max(1, Math.min(4, count ?? s.posts_per_day));
  const domain = (await tx.maybeOne<{ domain: string | null }>("select domain from site_settings where product_id = $1", [productId]))?.domain ?? null;
  // Rotate through our articles: the ones used least recently first.
  const articles = await tx.query<{ title: string; url: string }>(
    `select a.title, a.url from blog_articles a
      where a.product_id = $1 and a.status in ('ingested', 'drafted') and a.title is not null
      order by (select max(m.created_at) from threads_studio_posts m where m.product_id = a.product_id and m.source_url like a.url || '%') nulls first, random()
      limit 3`,
    [productId],
  );
  const knowledge = await draftingKnowledge(tx, actor.workspaceId, productId, articles[0]?.title ?? (await productBrief(tx, productId)).niche, 6);
  const recent = await tx.query<{ text: string; format: string }>(
    `select coalesce(v.body->>'body', '') text, m.format from threads_studio_posts m join content_items i on i.id = m.content_item_id
       join content_versions v on v.id = i.current_version_id where m.product_id = $1 order by m.created_at desc limit 20`,
    [productId],
  );
  const wf = await tx.one<{ id: string }>(
    "insert into workflow_runs (workspace_id, product_id, workflow, input, status, current_step) values ($1,$2,'threads_studio',$3,'running','write') returning id",
    [actor.workspaceId, productId, JSON.stringify({ count: n })],
  );
  const input = {
    COUNT: n,
    LANGUAGE: s.language === "ru" ? "Russian" : "English",
    WEB_SEARCH_ALLOWED: s.web_trends,
    RULES: await deskRules(tx, productId),
    ARTICLES: articles.map((a) => ({ title: a.title, url: a.url })),
    KNOWLEDGE: knowledge,
    RECENT: recent.map((r) => `${r.format}: ${r.text.slice(0, 160)}`),
    STYLE_NOTES: styleNotes(recent.filter((r) => r.format !== "question").map((r) => r.text), "posts"),
    PERFORMANCE: await performanceSummary(tx, productId),
  };
  let r: { output: ThreadsBatchOutput; agentRunId: string; isMock: boolean };
  try {
    r = await runAgent(tx, { actor, productId, workflowRunId: wf.id, step: "threads_posts", task: "threads_posts", promptKey: "threads_posts.v1", schema: threadsBatchSchema, sourceIds: [], input, webSearch: s.web_trends, maxTokens: 5000 });
  } catch (e) {
    if (!s.web_trends || !/web_search|tool|search/i.test((e as Error).message)) throw e;
    r = await runAgent(tx, { actor, productId, workflowRunId: wf.id, step: "threads_posts", task: "threads_posts", promptKey: "threads_posts.v1", schema: threadsBatchSchema, sourceIds: [], input: { ...input, WEB_SEARCH_ALLOWED: false }, maxTokens: 5000 });
  }
  const created: Array<{ id: string; status: string }> = [];
  for (const p of r.output.posts.slice(0, n)) {
    let text = p.text.trim();
    // Our article links carry a tag, so visits from each post show up in Analytics.
    if (p.source_url && domain && p.source_url.includes(domain)) {
      const tagged = taggedUrl(p.source_url, { source: "threads", medium: "post", key: `threads_${p.format}` });
      text = text.includes(p.source_url) ? text.replace(p.source_url, tagged) : text.length + tagged.length + 2 <= 500 ? `${text}\n\n${tagged}` : text;
    }
    const firstLine = text.split("\n")[0].replace(/^\[MOCK\]\s*/, "");
    const item = await tx.one<{ id: string }>(
      `insert into content_items (workspace_id, product_id, channel, format, goal, funnel_stage, language, topic, title)
       values ($1,$2,'threads','short_post','awareness','awareness',$3,$4,$5) returning id`,
      [actor.workspaceId, productId, s.language, p.topic, `Threads: ${firstLine}`.slice(0, 200)],
    );
    const ver = await tx.one<{ id: string }>(
      `insert into content_versions (workspace_id, product_id, content_item_id, version, body, visual_concept, rationale, evidence, author_type, agent_run_id)
       values ($1,$2,$3,1,$4,'',$5,'[]','ai',$6) returning id`,
      [actor.workspaceId, productId, item.id, JSON.stringify({ body: text }), JSON.stringify({ why: p.why, format: p.format }), r.agentRunId],
    );
    await tx.query("update content_items set current_version_id = $1 where id = $2", [ver.id, item.id]);
    await tx.query(
      `insert into threads_studio_posts (content_item_id, workspace_id, product_id, format, topic, source_kind, source_title, source_url, why)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [item.id, actor.workspaceId, productId, p.format, p.topic, p.source_kind, p.source_title, p.source_url, p.why],
    );
    const review = await runReviews(tx, actor, productId, item.id, wf.id);
    if (review.outcome !== "block") await submitForApproval(tx, actor, productId, item.id);
    created.push({ id: item.id, status: review.outcome === "block" ? "blocked" : "waiting" });
  }
  await tx.query("update workflow_runs set status = 'waiting_for_human', current_step = 'approval' where id = $1", [wf.id]);
  await tx.query("update threads_studio_settings set last_generated_at = now() where product_id = $1", [productId]);
  return { created, isMock: r.isMock };
}

/** Next free posting time (Riga) at least 10 minutes from now, one post per slot. */
export async function nextThreadsSlot(tx: Tx, productId: string, slots: string[], now = new Date()) {
  const taken = (await tx.query<{ at: string }>(
    "select scheduled_for::text at from content_items where product_id = $1 and channel = 'threads' and status in ('scheduled', 'published') and scheduled_for > $2",
    [productId, new Date(now.getTime() - 86_400_000).toISOString()],
  )).map((r) => new Date(r.at).getTime());
  for (let day = 0; day < 30; day++) {
    for (const slot of [...slots].sort()) {
      const at = (await tx.one<{ at: string }>(
        "select ((date_trunc('day', $1::timestamptz at time zone 'Europe/Riga') + $2::interval + $3::time) at time zone 'Europe/Riga')::text at",
        [now.toISOString(), `${day} days`, slot],
      )).at;
      const t = new Date(at).getTime();
      if (t < now.getTime() + 10 * 60_000) continue;
      if (taken.some((x) => Math.abs(x - t) < 45 * 60_000)) continue;
      return new Date(t);
    }
  }
  throw new Error("No free posting time in the next 30 days.");
}

/**
 * The owner's one click: optional edit, then approve the exact text and place it on the next free slot.
 * An edited text is checked by the rules again first; a blocked text is not approved.
 */
export async function approveThreadsPost(tx: Tx, actor: Actor, productId: string, itemId: string, editedText?: string) {
  const s = await getStudioSettings(tx, actor.workspaceId, productId);
  const item = await tx.one<{ status: string; body: { body?: string } }>(
    "select i.status, v.body from content_items i join content_versions v on v.id = i.current_version_id where i.id = $1 and i.product_id = $2 and i.channel = 'threads'",
    [itemId, productId],
  );
  if (["scheduled", "published"].includes(item.status)) throw new Error("This post is already approved.");
  if (editedText !== undefined && editedText.trim() && editedText.trim() !== (item.body.body ?? "").trim()) {
    if (editedText.trim().length > 500) throw new Error(`Threads allows 500 characters; this post has ${editedText.trim().length}.`);
    await editContent(tx, actor, productId, itemId, { body: editedText.trim() }, "", "Edited in Threads Studio before approval");
  }
  const st = (await tx.one<{ status: string }>("select status from content_items where id = $1", [itemId])).status;
  if (st === "draft" || st === "ai_review") {
    const review = await runReviews(tx, actor, productId, itemId);
    if (review.outcome === "block") {
      const msgs = review.findings.filter((f) => f.severity === "block").map((f) => f.message).join(" ");
      throw new Error(`The safety rules stopped this text: ${msgs || "see the review"}. Change it and approve again.`);
    }
  }
  if ((await tx.one<{ status: string }>("select status from content_items where id = $1", [itemId])).status === "needs_human_review") {
    const a = await submitForApproval(tx, actor, productId, itemId);
    await decideApproval(tx, actor, productId, a.id, "approved", "Approved in Threads Studio");
  }
  const at = await nextThreadsSlot(tx, productId, s.slots);
  await scheduleItem(tx, productId, itemId, at);
  return { scheduledFor: at };
}

export async function rejectThreadsPost(tx: Tx, actor: Actor, productId: string, itemId: string) {
  const a = await tx.maybeOne<{ id: string }>(
    "select a.id from approval_items a join content_items i on i.current_version_id = a.content_version_id where i.id = $1 and i.product_id = $2 and a.state = 'pending'",
    [itemId, productId],
  );
  if (a) await decideApproval(tx, actor, productId, a.id, "rejected", "Rejected in Threads Studio");
  await tx.query("update content_items set status = 'rejected', scheduled_for = null where id = $1 and product_id = $2 and status <> 'published'", [itemId, productId]);
}

/** Posts approved elsewhere (e.g. the Approval Queue) but not placed on a slot yet: give them the next free one. */
export async function scheduleApprovedStudioPosts(tx: Tx, productId: string) {
  const items = await tx.query<{ id: string; workspace_id: string }>(
    `select i.id, i.workspace_id from content_items i join threads_studio_posts m on m.content_item_id = i.id
      where i.product_id = $1 and i.status = 'approved' and i.scheduled_for is null order by i.created_at limit 4`,
    [productId],
  );
  if (!items.length) return 0;
  const s = await getStudioSettings(tx, items[0].workspace_id, productId);
  for (const it of items) await scheduleItem(tx, productId, it.id, await nextThreadsSlot(tx, productId, s.slots));
  return items.length;
}

/** Reactions for our published studio posts (newest first), kept on the post and as metric events. */
export async function refreshStudioStats(tx: Tx, productId: string, insights: (externalId: string) => Promise<ThreadsInsights>, limit = 30) {
  const pubs = await tx.query<{ item_id: string; publication_id: string; workspace_id: string; external_id: string }>(
    `select m.content_item_id item_id, p.id publication_id, p.workspace_id, p.external_id from threads_studio_posts m
       join publications p on p.content_item_id = m.content_item_id and p.channel = 'threads' and p.external_id is not null
      where m.product_id = $1 and p.published_at > now() - interval '60 days'
      order by m.stats_checked_at nulls first, p.published_at desc limit $2`,
    [productId, limit],
  );
  let checked = 0;
  for (const p of pubs) {
    const i = await insights(p.external_id).catch(() => null);
    if (!i) continue;
    await tx.query(
      "update threads_studio_posts set views = $2, likes = $3, replies = $4, reposts = $5, quotes = $6, stats_checked_at = now() where content_item_id = $1",
      [p.item_id, i.views, i.likes, i.replies, i.reposts, i.quotes],
    );
    const now = new Date().toISOString();
    for (const [metric, value] of [["views", i.views], ["likes", i.likes], ["comments", i.replies], ["shares", i.reposts + i.quotes]] as const) {
      await tx.query(
        "insert into metric_events (workspace_id, product_id, publication_id, metric, value, observed_at, source) values ($1,$2,$3,$4,$5,$6,'api')",
        [p.workspace_id, productId, p.publication_id, metric, value, now],
      );
    }
    checked++;
  }
  return { checked };
}

export interface StudioPost {
  id: string;
  status: string;
  text: string;
  format: string;
  topic: string;
  source_kind: string;
  source_title: string | null;
  source_url: string | null;
  why: string;
  scheduled_for: string | null;
  published_at: string | null;
  external_url: string | null;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  stats_checked_at: string | null;
  blocked_reason: string | null;
  created_at: string;
}

export async function studioPosts(tx: Tx, productId: string): Promise<StudioPost[]> {
  return tx.query<StudioPost>(
    `select i.id, i.status, coalesce(v.body->>'body', '') text, m.format, m.topic, m.source_kind, m.source_title, m.source_url, m.why,
            i.scheduled_for::text, i.published_at::text,
            (select p.external_url from publications p where p.content_item_id = i.id order by p.created_at desc limit 1) external_url,
            m.views, m.likes, m.replies, m.reposts, m.quotes, m.stats_checked_at::text,
            (select string_agg(f->>'message', ' ') from content_reviews r, jsonb_array_elements(r.findings) f
              where r.content_version_id = i.current_version_id and r.outcome = 'block' and f->>'severity' = 'block') blocked_reason,
            m.created_at::text
       from threads_studio_posts m join content_items i on i.id = m.content_item_id join content_versions v on v.id = i.current_version_id
      where m.product_id = $1 and i.status <> 'archived'
      order by coalesce(i.published_at, i.scheduled_for, m.created_at) desc limit 200`,
    [productId],
  );
}

