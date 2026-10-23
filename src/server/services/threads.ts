import type { Tx } from "@/server/db/client";
import { communityCommentSchema } from "@/domain/ai/schemas";
import { publishableText } from "@/domain/content";
import type { ContentBody } from "@/domain/ai/schemas";
import { classifyMessage } from "@/domain/youtube";
import { runAgent, type Actor } from "./content";
import { brandName, checkDraft, getYtSettings, previousTeamTexts, productRules, queueDraft, receiveReply, startRun, CHANNEL_NAME } from "./youtube";
import { channelConnection, publishingEnabled, threadsToken, type ThreadsWriteApi } from "./youtube-publish";

/**
 * Threads and Instagram community work. Threads: keyword search through the official API (our own posts only until
 * Meta approves keyword search), replies drafted for approval, posted from the queue; our approved Threads posts
 * published through the API. Instagram: reels are added by hand, comments are drafted for approval and posted by
 * a person (the API does not allow commenting on other people's media).
 */
export interface ThreadsSettings {
  enabled: boolean;
  queries: string[];
  drafts_per_run: number;
  author_cooldown_days: number;
  last_run_at: string | null;
}

export async function getThreadsSettings(tx: Tx, workspaceId: string, productId: string): Promise<ThreadsSettings> {
  await tx.query("insert into threads_settings (product_id, workspace_id) values ($1, $2) on conflict (product_id) do nothing", [productId, workspaceId]);
  return tx.one<ThreadsSettings>("select enabled, queries, drafts_per_run, author_cooldown_days, last_run_at::text from threads_settings where product_id = $1", [productId]);
}

export async function updateThreadsSettings(tx: Tx, workspaceId: string, productId: string, s: Omit<ThreadsSettings, "last_run_at">) {
  await getThreadsSettings(tx, workspaceId, productId);
  await tx.query("update threads_settings set enabled = $2, queries = $3, drafts_per_run = $4, author_cooldown_days = $5 where product_id = $1",
    [productId, s.enabled, s.queries, s.drafts_per_run, s.author_cooldown_days]);
}

export interface FoundPost {
  id: string;
  text: string;
  username: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export interface PostSource {
  kind: "api" | "demo";
  search(query: string): Promise<FoundPost[]>;
}

const AD_OR_SPAM = /\b(promo code|discount|link in bio|dm me|giveaway|follow for|buy now|crypto|onlyfans|course|coaching|webinar)\b|скидк|промокод|розыгрыш|курс\b|марафон/i;
const CHILD = /\b(my (son|daughter|kid|child)|for kids|teen(ager)?s?|i'?m 1[0-7]\b)/i;

/** Should the team answer this post at all? Plain rules first; the drafter can still skip. */
export function judgePost(p: FoundPost, queries: string[], ownUsername: string | null, lastContactWithAuthor: Date | null, cooldownDays: number, now = new Date()) {
  const text = p.text.trim();
  const flags: string[] = [];
  if (ownUsername && p.username && p.username.toLowerCase() === ownUsername.toLowerCase()) flags.push("our own post");
  if (text.length < 25) flags.push("too short to answer meaningfully");
  const risk = classifyMessage(text);
  if (risk.risk === "high") flags.push("the person may be in crisis: a person should decide, not a draft");
  if (AD_OR_SPAM.test(text)) flags.push("looks like an ad or a promotion");
  if (CHILD.test(text)) flags.push("about or by a child or teenager");
  if (lastContactWithAuthor && now.getTime() - lastContactWithAuthor.getTime() < cooldownDays * 86_400_000) flags.push(`we answered this person in the last ${cooldownDays} days`);
  const lower = text.toLowerCase();
  const matched = queries.filter((q) => lower.includes(q.toLowerCase()));
  const topical = /panic|anxiety|паник|тревог/i.test(text);
  const relevance = Math.min(100, (matched.length ? 50 : 0) + (topical ? 30 : 0) + Math.min(20, Math.floor(text.length / 20)));
  if (!matched.length && !topical) flags.push("not clearly about panic or anxiety");
  const eligible = flags.length === 0;
  const reason = eligible ? `About ${matched[0] ?? "panic or anxiety"}; a short, warm reply fits.` : `Skipped: ${flags.join("; ")}.`;
  return { eligible, relevance, flags, reason, risk: risk.risk };
}

/** Drafts the team's comment for one found post (Threads) or hand-added reel (Instagram). */
export async function draftSocialComment(tx: Tx, actor: Actor, productId: string, socialPostId: string, seed = 0) {
  const p = await tx.one<{ id: string; channel: "threads" | "instagram"; post_id: string | null; url: string | null; author: string | null; text: string; conversation_id: string | null }>(
    "select id, channel, post_id, url, author, text, conversation_id from social_posts where id = $1 and product_id = $2",
    [socialPostId, productId],
  );
  if (p.conversation_id) throw new Error("This post already has drafts.");
  const name = await brandName(tx, productId, await getYtSettings(tx, actor.workspaceId, productId));
  const previous = await previousTeamTexts(tx, productId, p.channel);
  const rules = await productRules(tx, productId);
  const wf = await startRun(tx, actor, productId, `${p.channel}_comment`);
  const platform = CHANNEL_NAME[p.channel];
  const r = await runAgent(tx, {
    actor, productId, workflowRunId: wf.id, step: "community_comment", task: "community_comment", promptKey: "community_social_comment.v1",
    schema: communityCommentSchema, sourceIds: [],
    input: { platform, productName: name, post: p.text.slice(0, 1500), author: p.author, videoTitle: p.text.slice(0, 80), previousComments: previous.slice(0, 20), seed },
  });
  await tx.query("update workflow_runs set status = 'waiting_for_human' where id = $1", [wf.id]);
  if (r.output.skip) {
    await tx.query("update social_posts set status = 'skipped', reason = $2 where id = $1", [p.id, `Drafter skipped: ${r.output.skip_reason || "no reply fits"}`]);
    return { queued: 0, rejected: 0, skipped: true };
  }
  const subject = `${p.author ? `${p.author} · ` : ""}${p.text.replace(/\s+/g, " ").slice(0, 90)}`;
  const conv = await tx.one<{ id: string; thread_url: string | null; subject: string | null; channel: string }>(
    `insert into conversations (workspace_id, product_id, channel, thread_url, status, external_ref, subject, risk)
     values ($1,$2,$3,$4,'needs_reply',$5,$6,'low') returning id, thread_url, subject, channel`,
    [actor.workspaceId, productId, p.channel, p.url, p.post_id, subject],
  );
  let queued = 0;
  let rejected = 0;
  for (const v of r.output.variants) {
    const check = checkDraft(v.text, previous, name, rules, p.channel);
    const q = await queueDraft(tx, actor, productId, conv, v.text, v.variant, check, r.agentRunId,
      `${platform} ${p.channel === "instagram" ? "reel" : "post"}${p.author ? ` by ${p.author}` : ""}. Responds to: ${r.output.responds_to}`);
    if (q.queued) queued++; else rejected++;
  }
  await tx.query("update social_posts set status = 'drafted', conversation_id = $2 where id = $1", [p.id, conv.id]);
  return { queued, rejected, skipped: false };
}

export interface ThreadsDiscoveryStats {
  source: string;
  found: number;
  newPosts: number;
  eligible: number;
  draftsQueued: number;
  draftsRejected: number;
  errors: string[];
}

export async function runThreadsDiscovery(tx: Tx, actor: Actor, productId: string, source: PostSource, ownUsername: string | null, now = new Date()): Promise<ThreadsDiscoveryStats> {
  const s = await getThreadsSettings(tx, actor.workspaceId, productId);
  const stats: ThreadsDiscoveryStats = { source: source.kind, found: 0, newPosts: 0, eligible: 0, draftsQueued: 0, draftsRejected: 0, errors: [] };
  const seen = new Map<string, { p: FoundPost; query: string }>();
  for (const query of s.queries) {
    try {
      for (const p of await source.search(query)) if (!seen.has(p.id)) seen.set(p.id, { p, query });
    } catch (e) {
      stats.errors.push(`"${query}": ${(e as Error).message}`);
      if (/limit|forbidden|403|429|permission/i.test((e as Error).message)) break;
    }
  }
  stats.found = seen.size;
  const existing = new Set((await tx.query<{ post_id: string }>("select post_id from social_posts where product_id = $1 and channel = 'threads' and post_id = any($2)", [productId, [...seen.keys()]])).map((r) => r.post_id));
  const lastByAuthor = new Map((await tx.query<{ author: string; last: string }>(
    "select author, max(found_at)::text last from social_posts where product_id = $1 and channel = 'threads' and status in ('drafted','reviewed','approved','published') and author is not null group by 1",
    [productId],
  )).map((r) => [r.author.toLowerCase(), new Date(r.last)]));
  const fresh: Array<{ id: string; relevance: number; author: string | null }> = [];
  for (const { p, query } of seen.values()) {
    if (existing.has(p.id)) continue;
    const author = p.username ? `@${p.username}` : null;
    const v = judgePost(p, s.queries, ownUsername, author ? lastByAuthor.get(author.toLowerCase()) ?? null : null, s.author_cooldown_days, now);
    const row = await tx.one<{ id: string }>(
      `insert into social_posts (workspace_id, product_id, channel, post_id, url, author, text, posted_at, found_by_query, relevance, reason, flags, status, is_demo)
       values ($1,$2,'threads',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [actor.workspaceId, productId, p.id, p.permalink, author, p.text.slice(0, 3000), p.timestamp, query, v.relevance, v.reason, v.flags, v.eligible ? "new" : "skipped", source.kind === "demo"],
    );
    stats.newPosts++;
    if (v.eligible) { stats.eligible++; fresh.push({ id: row.id, relevance: v.relevance, author }); }
  }
  const picked: typeof fresh = [];
  for (const f of fresh.sort((a, b) => b.relevance - a.relevance)) {
    if (picked.length >= s.drafts_per_run) break;
    if (f.author && picked.some((x) => x.author === f.author)) continue;
    picked.push(f);
  }
  for (const [i, p] of picked.entries()) {
    try {
      const d = await draftSocialComment(tx, actor, productId, p.id, i + stats.newPosts);
      stats.draftsQueued += d.queued;
      stats.draftsRejected += d.rejected;
    } catch (e) {
      stats.errors.push(`Draft failed: ${(e as Error).message}`);
      if (/401|403|credit|billing|api key/i.test((e as Error).message)) break;
    }
  }
  await tx.query("update threads_settings set last_run_at = $2 where product_id = $1", [productId, now.toISOString()]);
  await tx.query(
    "insert into automation_runs (workspace_id, product_id, kind, status, stats, finished_at) values ($1,$2,'threads_discovery',$3,$4, now())",
    [actor.workspaceId, productId, stats.errors.length && !stats.found ? "error" : "ok", JSON.stringify(stats)],
  );
  return stats;
}

/** Instagram: the owner pastes a reel (link and what it says); the agent drafts a comment to post by hand. */
export async function addInstagramReel(tx: Tx, actor: Actor, productId: string, reel: { url: string; author: string | null; text: string }) {
  const risk = classifyMessage(reel.text);
  const row = await tx.one<{ id: string }>(
    `insert into social_posts (workspace_id, product_id, channel, url, author, text, relevance, reason, flags, status)
     values ($1,$2,'instagram',$3,$4,$5,50,$6,$7,$8) returning id`,
    [actor.workspaceId, productId, reel.url, reel.author, reel.text.slice(0, 3000),
     risk.risk === "high" ? "Not drafted: the reel may be about a crisis; decide yourself." : "Added by hand.", risk.risk === "high" ? ["crisis"] : [], risk.risk === "high" ? "skipped" : "new"],
  );
  if (risk.risk === "high") return { queued: 0, rejected: 0, skipped: true };
  return draftSocialComment(tx, actor, productId, row.id);
}

export interface ThreadsReadApi {
  replies(token: string, mediaId: string): Promise<FoundPost[]>;
  insights(token: string, mediaId: string): Promise<{ views: number; likes: number; replies: number; reposts: number; quotes: number }>;
}

/**
 * Reads replies on Threads: under our posted replies (continuing conversations) and under our own published posts
 * (each person replying starts a conversation). New messages get an answer drafted for approval.
 */
export async function syncThreadsReplies(tx: Tx, actor: Actor, productId: string, api: ThreadsReadApi & Pick<ThreadsWriteApi, "refresh">) {
  const conn = await channelConnection(tx, productId, "threads");
  if (!conn) return { checked: 0, fresh: 0, highRisk: 0, errors: [] as string[] };
  const token = await threadsToken(tx, conn, api);
  const own = (conn.account_label ?? "").replace(/^@/, "").toLowerCase();
  const isOurs = (p: FoundPost) => Boolean(own && p.username?.toLowerCase() === own);
  let fresh = 0;
  let highRisk = 0;
  let checked = 0;
  const errors: string[] = [];
  // 1. Conversations we are in: replies under each of our posted messages.
  const ours = await tx.query<{ conversation_id: string; external_id: string }>(
    `select m.conversation_id, m.external_id from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'threads' and c.status <> 'closed' and m.direction = 'outbound' and m.status = 'posted' and m.external_id is not null
      order by m.occurred_at desc limit 40`,
    [productId],
  );
  for (const o of ours) {
    try {
      checked++;
      const known = new Set((await tx.query<{ external_id: string }>("select external_id from conversation_messages where conversation_id = $1 and external_id is not null", [o.conversation_id])).map((r) => r.external_id));
      for (const r of (await api.replies(token, o.external_id)).sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))) {
        if (known.has(r.id) || isOurs(r)) continue;
        const res = await receiveReply(tx, actor, productId, o.conversation_id, r.username ? `@${r.username}` : null, r.text, { externalId: r.id, occurredAt: r.timestamp ?? undefined });
        fresh++;
        if (res.risk === "high") highRisk++;
      }
      await tx.query("update conversations set replies_checked_at = now() where id = $1", [o.conversation_id]);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  // 2. Our own posts: every new direct reply is its own conversation.
  const pubs = await tx.query<{ id: string; external_id: string; external_url: string | null; title: string }>(
    `select p.id, p.external_id, p.external_url, i.title from publications p join content_items i on i.id = p.content_item_id
      where p.product_id = $1 and p.channel = 'threads' and p.external_id is not null and p.published_at > now() - interval '30 days'
      order by p.published_at desc limit 20`,
    [productId],
  );
  for (const pub of pubs) {
    try {
      checked++;
      for (const r of await api.replies(token, pub.external_id)) {
        if (isOurs(r)) continue;
        const exists = await tx.maybeOne("select 1 from conversations where product_id = $1 and channel = 'threads' and external_ref = $2", [productId, r.id]);
        if (exists) continue;
        const conv = await tx.one<{ id: string }>(
          `insert into conversations (workspace_id, product_id, publication_id, channel, thread_url, status, external_ref, external_thread_id, subject, risk)
           values ($1,$2,$3,'threads',$4,'needs_reply',$5,$5,$6,'low') returning id`,
          [actor.workspaceId, productId, pub.id, r.permalink ?? pub.external_url, r.id, `Reply to our post “${pub.title.slice(0, 70)}”`],
        );
        const res = await receiveReply(tx, actor, productId, conv.id, r.username ? `@${r.username}` : null, r.text, { externalId: r.id, occurredAt: r.timestamp ?? undefined });
        fresh++;
        if (res.risk === "high") highRisk++;
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { checked, fresh, highRisk, errors };
}

/** Likes, replies, views for our Threads posts (as metrics) and our replies (on the messages). */
export async function refreshThreadsStats(tx: Tx, actor: Actor, productId: string, api: ThreadsReadApi & Pick<ThreadsWriteApi, "refresh">) {
  const conn = await channelConnection(tx, productId, "threads");
  if (!conn) return { checked: 0 };
  const token = await threadsToken(tx, conn, api);
  let checked = 0;
  const msgs = await tx.query<{ id: string; external_id: string }>(
    `select m.id, m.external_id from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'threads' and m.direction = 'outbound' and m.status = 'posted' and m.external_id is not null
      order by m.stats_checked_at nulls first limit 50`,
    [productId],
  );
  for (const m of msgs) {
    const i = await api.insights(token, m.external_id).catch(() => null);
    if (!i) continue;
    await tx.query("update conversation_messages set like_count = $2, reply_count = $3, stats_checked_at = now() where id = $1", [m.id, i.likes, i.replies]);
    checked++;
  }
  const pubs = await tx.query<{ id: string; external_id: string }>(
    "select id, external_id from publications where product_id = $1 and channel = 'threads' and external_id is not null and published_at > now() - interval '60 days' limit 30",
    [productId],
  );
  for (const p of pubs) {
    const i = await api.insights(token, p.external_id).catch(() => null);
    if (!i) continue;
    const now = new Date().toISOString();
    for (const [metric, value] of [["views", i.views], ["likes", i.likes], ["comments", i.replies], ["shares", i.reposts + i.quotes]] as const) {
      await tx.query(
        "insert into metric_events (workspace_id, product_id, publication_id, metric, value, observed_at, source) values ($1,$2,$3,$4,$5,$6,'api')",
        [actor.workspaceId, productId, p.id, metric, value, now],
      );
    }
    checked++;
  }
  return { checked };
}

/** Publishes an approved Threads post from Content Studio. The exact approved version is what goes out. */
export async function publishThreadsPost(tx: Tx, actor: Actor, productId: string, itemId: string, api: Pick<ThreadsWriteApi, "publish" | "refresh">) {
  const item = await tx.one<{ id: string; status: string; channel: string; format: string; current_version_id: string; body: ContentBody }>(
    `select i.id, i.status, i.channel, i.format, i.current_version_id, v.body from content_items i join content_versions v on v.id = i.current_version_id
      where i.id = $1 and i.product_id = $2`,
    [itemId, productId],
  );
  if (item.channel !== "threads") throw new Error("Only Threads posts can be published to Threads.");
  if (!["approved", "scheduled"].includes(item.status)) throw new Error("Only approved posts can be published.");
  const approval = await tx.maybeOne<{ id: string }>(
    "select id from approval_items where content_version_id = $1 and state = 'approved' order by decided_at desc limit 1",
    [item.current_version_id],
  );
  if (!approval) throw new Error("This version is not approved.");
  if (!publishingEnabled("threads")) return { published: false, reason: "Posting to Threads is switched off (THREADS_PUBLISHING_ENABLED). Copy the text and post it yourself, then mark it as published." };
  const conn = await channelConnection(tx, productId, "threads");
  if (!conn?.external_account_id) return { published: false, reason: "The Threads account is not connected yet (Connections → Connect Threads)." };
  if (conn.status !== "connected") return { published: false, reason: `Threads is paused: ${conn.paused_reason ?? conn.status}.` };
  const done = await tx.maybeOne("select 1 from outbound_actions where product_id = $1 and dedupe_key = $2 and result = 'executed'", [productId, `threads-post:${item.current_version_id}`]);
  if (done) return { published: false, reason: "This version was already published." };
  const utm = await tx.maybeOne<{ full_url: string }>("select full_url from utm_links where content_item_id = $1 order by created_at desc limit 1", [itemId]);
  let text = publishableText(item.body, item.format).trim();
  if (utm && !text.includes(utm.full_url) && /\bhttps?:\/\//.test(text) === false && text.length + utm.full_url.length + 2 <= 500) text = `${text}\n\n${utm.full_url}`;
  if (text.length > 500) return { published: false, reason: `Threads allows 500 characters; this post has ${text.length}. Shorten it and approve again.` };
  try {
    const token = await threadsToken(tx, conn, api);
    const r = await api.publish(token, conn.external_account_id, text, null);
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, dedupe_key, result, reason) values ($1,$2,$3,$4,'publish',$5,'executed','post published after approval')",
      [actor.workspaceId, productId, conn.id, approval.id, `threads-post:${item.current_version_id}`],
    );
    const pub = await tx.one<{ id: string }>(
      `insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, connection_id, method, external_url, external_id, approval_item_id)
       values ($1,$2,$3,$4,'threads',$5,'api',$6,$7,$8) returning id`,
      [actor.workspaceId, productId, itemId, item.current_version_id, conn.id, r.permalink, r.id, approval.id],
    );
    await tx.query("update content_items set status = 'published', published_at = now() where id = $1", [itemId]);
    return { published: true, reason: "Published on Threads.", publicationId: pub.id, url: r.permalink };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, result, reason) values ($1,$2,$3,$4,'publish','failed',$5)",
      [actor.workspaceId, productId, conn.id, approval.id, msg],
    );
    await tx.query("update channel_connections set status = 'paused', paused_reason = $2, paused_until = now() + interval '6 hours', last_error = $2 where id = $1", [conn.id, msg]);
    return { published: false, reason: `Threads refused: ${msg} Posting is paused for 6 h.` };
  }
}

/** Scheduled, approved Threads posts whose time has come. */
export async function dueThreadsPosts(tx: Tx, productId: string, now = new Date()) {
  return tx.query<{ id: string }>(
    "select id from content_items where product_id = $1 and channel = 'threads' and status = 'scheduled' and scheduled_for <= $2 order by scheduled_for limit 3",
    [productId, now.toISOString()],
  );
}
