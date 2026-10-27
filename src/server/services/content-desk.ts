import type { Tx } from "@/server/db/client";
import { contentDeskSchema, reelSpecSchema, type ContentBody, type ContentDeskOutput, type ReelSpec } from "@/domain/ai/schemas";
import type { Actor } from "./content";
import { decideApproval, editContent, runAgent, runReviews, scheduleItem, submitForApproval } from "./content";
import { draftingKnowledge } from "./knowledge-context";
import { performanceSummary } from "./threads-studio";

/**
 * Content desk. Every morning: research (web + our own data) → ready Instagram single-image posts and carousels,
 * drawn as cards in Back's look, and article ideas for the website. Each passes the safety rules and waits for the
 * owner. Approve places it on the calendar: posts and carousels are published at their time from the posting queue,
 * article ideas become planned articles with a brief.
 */
export type DeskKind = "post" | "carousel" | "article" | "reel";
export type Slide = { title: string; text: string };

export interface DeskSettings {
  enabled: boolean;
  posts_per_day: number;
  carousels_per_day: number;
  articles_per_week: number;
  post_time: string;
  carousel_time: string;
  reels_per_week: number;
  reel_time: string;
  web_research: boolean;
  last_generated_at: string | null;
}

export async function getDeskSettings(tx: Tx, workspaceId: string, productId: string): Promise<DeskSettings> {
  await tx.query("insert into content_desk_settings (product_id, workspace_id) values ($1,$2) on conflict (product_id) do nothing", [productId, workspaceId]);
  return tx.one<DeskSettings>(
    "select enabled, posts_per_day, carousels_per_day, articles_per_week, post_time, carousel_time, reels_per_week, reel_time, web_research, last_generated_at::text from content_desk_settings where product_id = $1",
    [productId],
  );
}

export async function updateDeskSettings(tx: Tx, workspaceId: string, productId: string, s: Omit<DeskSettings, "last_generated_at">) {
  for (const t of [s.post_time, s.carousel_time, s.reel_time]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`Times look like 18:30; "${t}" does not.`);
  await getDeskSettings(tx, workspaceId, productId);
  await tx.query(
    "update content_desk_settings set enabled = $2, posts_per_day = $3, carousels_per_day = $4, articles_per_week = $5, post_time = $6, carousel_time = $7, web_research = $8, reels_per_week = $9, reel_time = $10 where product_id = $1",
    [productId, s.enabled, s.posts_per_day, s.carousels_per_day, s.articles_per_week, s.post_time, s.carousel_time, s.web_research, s.reels_per_week, s.reel_time],
  );
}

const FORMAT: Record<DeskKind, { channel: string; format: string }> = {
  post: { channel: "instagram", format: "static_concept" },
  carousel: { channel: "instagram", format: "carousel" },
  article: { channel: "website", format: "article" },
  reel: { channel: "instagram", format: "reels_script" },
};

export interface DeskMedia {
  render(format: "static_concept" | "carousel", slides: Slide[]): Promise<Uint8Array[]>;
  store(key: string, bytes: Uint8Array): Promise<void>;
}

/** Draws the cards for the item's current version and keeps them as creative assets. */
async function drawCards(tx: Tx, productId: string, itemId: string, media: DeskMedia) {
  const it = await tx.one<{ workspace_id: string; format: string; title: string; current_version_id: string; body: ContentBody }>(
    "select i.workspace_id, i.format, i.title, i.current_version_id, v.body from content_items i join content_versions v on v.id = i.current_version_id where i.id = $1",
    [itemId],
  );
  if (it.format !== "static_concept" && it.format !== "carousel") return;
  const slides = (it.body.slides ?? []).map((s) => ({ title: s.title, text: s.text ?? "" }));
  try {
    const images = await media.render(it.format, it.format === "static_concept" ? slides.slice(0, 1) : slides);
    const ids: string[] = [];
    for (const [i, bytes] of images.entries()) {
      const key = `${it.workspace_id}/${productId}/desk/${it.current_version_id}-${i + 1}.jpg`;
      await media.store(key, bytes);
      const a = await tx.one<{ id: string }>(
        `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, origin, tags, rights_note)
         values ($1,$2,'image',$3,$4,'image/jpeg','generated','{desk-card}','Drawn by God of Marketing in Back''s brand style (Fraunces, Outfit; OFL).') returning id`,
        [it.workspace_id, productId, `${it.title} · ${i + 1}`.slice(0, 200), key],
      );
      ids.push(a.id);
    }
    await tx.query("update content_desk_items set image_asset_ids = $2, rendered_version_id = $3, render_error = null where content_item_id = $1", [itemId, ids, it.current_version_id]);
  } catch (e) {
    await tx.query("update content_desk_items set render_error = $2 where content_item_id = $1", [itemId, (e as Error).message.slice(0, 300)]);
  }
}

/** How many of each kind to make today (articles spread over the week). */
export async function deskCounts(tx: Tx, productId: string, s: DeskSettings) {
  const week = await tx.one<{ articles: number; reels: number }>(
    `select count(*) filter (where kind = 'article')::int articles, count(*) filter (where kind = 'reel')::int reels
       from content_desk_items where product_id = $1 and created_at > now() - interval '7 days'`,
    [productId],
  );
  return { posts: s.posts_per_day, carousels: s.carousels_per_day, articles: week.articles < s.articles_per_week ? 1 : 0, reels: week.reels < s.reels_per_week ? 1 : 0 };
}

export async function generateDesk(tx: Tx, actor: Actor, productId: string, media: DeskMedia, counts?: { posts: number; carousels: number; articles: number; reels?: number }) {
  const s = await getDeskSettings(tx, actor.workspaceId, productId);
  const k = { reels: 0, ...(counts ?? (await deskCounts(tx, productId, s))) };
  if (!k.posts && !k.carousels && !k.articles && !k.reels) return { created: [], isMock: false };
  const articles = await tx.query<{ title: string; url: string }>(
    "select title, url from blog_articles where product_id = $1 and title is not null order by created_at desc limit 30", [productId]);
  const recent = await tx.query<{ kind: string; topic: string; hook: string }>(
    `select d.kind, d.topic, coalesce(d.hooks->d.chosen_hook->>'text', '') hook from content_desk_items d
      where d.product_id = $1 order by d.created_at desc limit 30`, [productId]);
  const questions = await tx.query<{ text: string }>(
    `select left(m.text, 240) text from conversation_messages m where m.product_id = $1 and m.direction = 'inbound'
      and m.occurred_at > now() - interval '30 days' order by m.occurred_at desc limit 25`, [productId]);
  const published = await tx.query<{ title: string; format: string; likes: number | null; saves: number | null; reach: number | null }>(
    `select i.title, i.format,
            (select max(value)::int from metric_events e join publications p on p.id = e.publication_id where p.content_item_id = i.id and e.metric = 'likes') likes,
            (select max(value)::int from metric_events e join publications p on p.id = e.publication_id where p.content_item_id = i.id and e.metric = 'saves') saves,
            (select max(value)::int from metric_events e join publications p on p.id = e.publication_id where p.content_item_id = i.id and e.metric = 'reach') reach
       from content_items i where i.product_id = $1 and i.channel = 'instagram' and i.status = 'published' order by i.published_at desc limit 15`, [productId]);
  const competitors = await tx.query<{ name: string }>("select name from competitors where product_id = $1 limit 10", [productId]);
  const wf = await tx.one<{ id: string }>(
    "insert into workflow_runs (workspace_id, product_id, workflow, input, status, current_step) values ($1,$2,'content_desk',$3,'running','research') returning id",
    [actor.workspaceId, productId, JSON.stringify(k)],
  );
  const input = {
    COUNTS: k,
    WEB_SEARCH_ALLOWED: s.web_research,
    ARTICLES: articles,
    RECENT: recent.map((r) => `${r.kind} · ${r.topic} · ${r.hook}`),
    QUESTIONS: questions.map((q) => q.text),
    PERFORMANCE: { threads: await performanceSummary(tx, productId), instagram_posts: published },
    COMPETITORS: competitors.map((c) => c.name),
    KNOWLEDGE: await draftingKnowledge(tx, actor.workspaceId, productId, "panic attack first minute what helps", 6),
  };
  const run = (inp: typeof input, web: boolean) => runAgent(tx, {
    actor, productId, workflowRunId: wf.id, step: "content_desk", task: "content_desk", promptKey: "content_desk.v1",
    schema: contentDeskSchema, sourceIds: [], input: inp, webSearch: web, maxTokens: 9000,
  });
  let r: { output: ContentDeskOutput; agentRunId: string; isMock: boolean };
  try {
    r = await run(input, s.web_research);
  } catch (e) {
    if (!s.web_research || !/web_search|tool|search/i.test((e as Error).message)) throw e;
    r = await run({ ...input, WEB_SEARCH_ALLOWED: false }, false);
  }
  const created: Array<{ id: string; kind: DeskKind; status: string }> = [];
  for (const it of r.output.items) {
    const hook = it.hooks[it.chosen_hook]?.text ?? it.hooks[0].text;
    const f = FORMAT[it.kind];
    const slides: Slide[] = it.kind === "post" ? [{ title: hook, text: "" }] : it.kind === "carousel" ? [{ title: hook, text: "" }, ...it.slides.slice(1).map((x) => ({ title: x.title, text: x.text ?? "" }))] : [];
    const reel: ReelSpec | null = it.kind === "reel" ? reelSpecSchema.parse(it.reel ?? { intro_style: "dark", intro_lines: [hook.slice(0, 28)], scenes: [{ shot: "home", caption: "" }, { shot: "breathe", caption: "" }] }) : null;
    const body: ContentBody = it.kind === "reel"
      ? { hook, caption: it.caption, script: reel!.scenes.map((sc, i) => ({ timecode: `scene ${i + 1}`, line: sc.caption, visual: sc.shot })) }
      : it.kind === "article"
      ? {
          hook: it.article?.title ?? hook,
          body: [it.article?.answer_first ?? "", "", ...(it.article?.outline ?? []).map((o) => `- ${o}`), "", `Search: ${it.article?.search_query ?? ""}`].join("\n").trim(),
          caption: it.caption,
        }
      : { hook, caption: it.caption, slides };
    const title = (it.kind === "article" ? it.article?.title ?? hook : hook).replace(/^\[MOCK\]\s*/, "");
    const item = await tx.one<{ id: string }>(
      `insert into content_items (workspace_id, product_id, channel, format, goal, funnel_stage, language, topic, title)
       values ($1,$2,$3,$4,$5,'awareness','en',$6,$7) returning id`,
      [actor.workspaceId, productId, f.channel, f.format, it.kind === "article" ? "traffic" : it.kind === "reel" ? "awareness" : "engagement", it.topic, title.slice(0, 200)],
    );
    const ver = await tx.one<{ id: string }>(
      `insert into content_versions (workspace_id, product_id, content_item_id, version, body, visual_concept, rationale, evidence, author_type, agent_run_id)
       values ($1,$2,$3,1,$4,$5,$6,$7,'ai',$8) returning id`,
      [actor.workspaceId, productId, item.id, JSON.stringify(body), it.kind === "article" ? "" : it.kind === "reel" ? "Reel from recorded app scenes, Back intro and end cards, original calm music" : "Back brand cards (ivory/forest, Fraunces + Outfit)",
       JSON.stringify({ insight: it.insight, why_now: it.why_now }), JSON.stringify(it.sources), r.agentRunId],
    );
    await tx.query("update content_items set current_version_id = $1 where id = $2", [ver.id, item.id]);
    await tx.query(
      `insert into content_desk_items (content_item_id, workspace_id, product_id, kind, topic, insight, why_now, sources, hooks, chosen_hook, reel, render_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [item.id, actor.workspaceId, productId, it.kind, it.topic, it.insight, it.why_now, JSON.stringify(it.sources), JSON.stringify(it.hooks), it.chosen_hook,
       reel ? JSON.stringify(reel) : null, reel ? "waiting" : null],
    );
    await drawCards(tx, productId, item.id, media);
    const review = await runReviews(tx, actor, productId, item.id, wf.id);
    if (review.outcome !== "block") await submitForApproval(tx, actor, productId, item.id);
    created.push({ id: item.id, kind: it.kind, status: review.outcome === "block" ? "blocked" : "waiting" });
  }
  await tx.query("update workflow_runs set status = 'waiting_for_human', current_step = 'approval' where id = $1", [wf.id]);
  await tx.query("update content_desk_settings set last_generated_at = now() where product_id = $1", [productId]);
  return { created, isMock: r.isMock };
}

/** Next free time for this kind (Riga), at least 30 minutes ahead, one per kind per day. Articles: Mon/Wed/Fri 15:00. */
export async function nextDeskSlot(tx: Tx, productId: string, kind: DeskKind, s: Pick<DeskSettings, "post_time" | "carousel_time"> & Partial<Pick<DeskSettings, "reel_time">>, now = new Date()) {
  const f = FORMAT[kind];
  const time = kind === "post" ? s.post_time : kind === "carousel" ? s.carousel_time : kind === "reel" ? s.reel_time ?? "20:00" : "15:00";
  const taken = new Set((await tx.query<{ d: string }>(
    `select to_char(scheduled_for at time zone 'Europe/Riga', 'YYYY-MM-DD') d from content_items
      where product_id = $1 and channel = $2 and format = $3 and status in ('scheduled', 'published') and scheduled_for > $4`,
    [productId, f.channel, f.format, new Date(now.getTime() - 86_400_000).toISOString()],
  )).map((r) => r.d));
  for (let day = 0; day < 60; day++) {
    const c = await tx.one<{ at: string; d: string; dow: number }>(
      `select ((date_trunc('day', $1::timestamptz at time zone 'Europe/Riga') + $2::interval + $3::time) at time zone 'Europe/Riga')::text at,
              to_char(date_trunc('day', $1::timestamptz at time zone 'Europe/Riga') + $2::interval, 'YYYY-MM-DD') d,
              extract(isodow from date_trunc('day', $1::timestamptz at time zone 'Europe/Riga') + $2::interval)::int dow`,
      [now.toISOString(), `${day} days`, time],
    );
    if (kind === "article" && ![1, 3, 5].includes(c.dow)) continue;
    const t = new Date(c.at);
    if (t.getTime() < now.getTime() + 30 * 60_000 || taken.has(c.d)) continue;
    return t;
  }
  throw new Error("No free day in the next 60 days.");
}

export interface DeskEdits {
  caption?: string;
  hookIndex?: number;
  slides?: Slide[];
}

/** The owner's approve: optional edits (re-drawn and re-checked), then approved and placed on the calendar. */
export async function approveDeskItem(tx: Tx, actor: Actor, productId: string, itemId: string, media: DeskMedia, edits: DeskEdits = {}) {
  const s = await getDeskSettings(tx, actor.workspaceId, productId);
  const it = await tx.one<{ status: string; body: ContentBody; kind: DeskKind; hooks: Array<{ text: string }>; chosen_hook: number }>(
    `select i.status, v.body, d.kind, d.hooks, d.chosen_hook from content_items i join content_versions v on v.id = i.current_version_id
       join content_desk_items d on d.content_item_id = i.id where i.id = $1 and i.product_id = $2`,
    [itemId, productId],
  );
  if (["scheduled", "published"].includes(it.status)) throw new Error("This piece is already approved.");
  if (it.kind === "reel") {
    const d = await tx.one<{ reel: ReelSpec; render_status: string | null; video_asset_id: string | null; render_error: string | null }>(
      "select reel, render_status, video_asset_id, render_error from content_desk_items where content_item_id = $1", [itemId]);
    if (edits.hookIndex !== undefined && edits.hookIndex !== it.chosen_hook && it.hooks[edits.hookIndex]) {
      // A different hook changes what is on screen: the Reel is made again, then it can be approved.
      const reel = { ...d.reel, intro_lines: hookLines(it.hooks[edits.hookIndex].text) };
      await tx.query("update content_desk_items set chosen_hook = $2, reel = $3, render_status = 'waiting', video_asset_id = null, render_error = null where content_item_id = $1",
        [itemId, edits.hookIndex, JSON.stringify(reel)]);
      return { scheduledFor: null, kind: it.kind, note: "The Reel is being made again with the new hook. Approve it when it is ready." };
    }
    if (d.render_status !== "ready" || !d.video_asset_id) {
      throw new Error(d.render_status === "failed" ? `The Reel could not be made: ${d.render_error ?? "unknown error"}.` : "The Reel is still being made. Approve it once you have watched it.");
    }
  }
  const body: ContentBody = structuredClone(it.body);
  if (edits.slides && it.kind !== "article") body.slides = edits.slides.filter((x) => x.title.trim()).map((x) => ({ title: x.title.trim(), text: x.text.trim() }));
  if (edits.hookIndex !== undefined && edits.hookIndex !== it.chosen_hook && it.hooks[edits.hookIndex]) {
    const h = it.hooks[edits.hookIndex].text;
    if (it.kind === "article") body.hook = h;
    else {
      body.hook = h;
      if (body.slides?.length) body.slides[0] = { title: h, text: body.slides[0].text ?? "" };
    }
    await tx.query("update content_desk_items set chosen_hook = $2 where content_item_id = $1", [itemId, edits.hookIndex]);
  }
  if (edits.caption !== undefined && edits.caption.trim()) body.caption = edits.caption.trim();
  if (it.kind === "post" && (body.caption?.length ?? 0) > 2200) throw new Error("Instagram captions are up to 2,200 characters.");
  if (it.kind === "carousel" && ((body.slides?.length ?? 0) < 2 || (body.slides?.length ?? 0) > 10)) throw new Error("A carousel needs 2 to 10 slides.");
  const changed = JSON.stringify(body) !== JSON.stringify(it.body);
  if (changed) {
    await editContent(tx, actor, productId, itemId, body, it.kind === "article" ? "" : "Back brand cards (ivory/forest, Fraunces + Outfit)", "Edited on the content desk before approval");
    await drawCards(tx, productId, itemId, media);
  }
  const st = (await tx.one<{ status: string }>("select status from content_items where id = $1", [itemId])).status;
  if (st === "draft" || st === "ai_review") {
    const review = await runReviews(tx, actor, productId, itemId);
    if (review.outcome === "block") {
      const msgs = review.findings.filter((f) => f.severity === "block").map((f) => f.message).join(" ");
      throw new Error(`The safety rules stopped this: ${msgs || "see the review"}. Change it and approve again.`);
    }
  }
  if (it.kind === "post" || it.kind === "carousel") {
    const d = await tx.one<{ rendered_version_id: string | null; n: number; render_error: string | null }>(
      "select d.rendered_version_id, cardinality(d.image_asset_ids) n, d.render_error from content_desk_items d where d.content_item_id = $1", [itemId]);
    const cur = (await tx.one<{ v: string }>("select current_version_id v from content_items where id = $1", [itemId])).v;
    if (d.rendered_version_id !== cur || !d.n) throw new Error(`The cards for this version are not drawn${d.render_error ? `: ${d.render_error}` : ""}. Try again.`);
  }
  if ((await tx.one<{ status: string }>("select status from content_items where id = $1", [itemId])).status === "needs_human_review") {
    const a = await submitForApproval(tx, actor, productId, itemId);
    try {
      await decideApproval(tx, actor, productId, a.id, "approved", "Approved on the content desk");
    } catch {
      // The destination changed since it was queued (e.g. Instagram connected later): the old queue entry is now
      // invalid, so queue the current payload and approve exactly that.
      const fresh = await submitForApproval(tx, actor, productId, itemId);
      await decideApproval(tx, actor, productId, fresh.id, "approved", "Approved on the content desk");
    }
  }
  const at = await nextDeskSlot(tx, productId, it.kind, s);
  await scheduleItem(tx, productId, itemId, at);
  return { scheduledFor: at as Date | null, kind: it.kind, note: null as string | null };
}

/** A hook split into short lines for the Reel's opening card (each under 28 characters). */
export function hookLines(hook: string) {
  const words = hook.replace(/^\[MOCK\]\s*/, "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${w}`.length <= 26 && !/[.!?]$/.test(last)) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w.slice(0, 28));
  }
  return lines.slice(0, 4);
}

/** Owner's edit of the on-screen text of a Reel: saved, then made again. */
export async function rerenderReel(tx: Tx, productId: string, itemId: string, reel: ReelSpec) {
  const spec = reelSpecSchema.parse(reel);
  const r = await tx.query(
    `update content_desk_items d set reel = $3, render_status = 'waiting', video_asset_id = null, render_error = null
       from content_items i where i.id = d.content_item_id and d.content_item_id = $1 and d.product_id = $2 and d.kind = 'reel' and i.status not in ('scheduled', 'published') returning d.content_item_id`,
    [itemId, productId, JSON.stringify(spec)],
  );
  if (!r.length) throw new Error("Only a Reel that is not approved yet can be changed.");
}

/** The renderer takes the next Reel to make (a stuck one is retried after an hour). */
export async function claimReelJob(tx: Tx, productId: string) {
  const r = await tx.maybeOne<{ id: string; workspace_id: string; reel: ReelSpec; title: string }>(
    `select d.content_item_id id, d.workspace_id, d.reel, i.title from content_desk_items d join content_items i on i.id = d.content_item_id
      where d.product_id = $1 and d.kind = 'reel' and i.status not in ('rejected', 'published')
        and (d.render_status = 'waiting' or (d.render_status = 'rendering' and d.render_started_at < now() - interval '1 hour'))
      order by d.created_at limit 1 for update of d skip locked`,
    [productId],
  );
  if (!r) return null;
  await tx.query("update content_desk_items set render_status = 'rendering', render_started_at = now() where content_item_id = $1", [r.id]);
  return { id: r.id, spec: r.reel, title: r.title, storageKey: `${r.workspace_id}/${productId}/desk/reels/${r.id}-${Date.now()}.mp4` };
}

export async function finishReelRender(tx: Tx, productId: string, id: string, result: { storageKey?: string; error?: string }) {
  const d = await tx.maybeOne<{ workspace_id: string; title: string }>(
    "select d.workspace_id, i.title from content_desk_items d join content_items i on i.id = d.content_item_id where d.content_item_id = $1 and d.product_id = $2 and d.render_status = 'rendering'",
    [id, productId],
  );
  if (!d) return false;
  if (result.error || !result.storageKey || !result.storageKey.startsWith(`${d.workspace_id}/${productId}/desk/reels/${id}-`)) {
    await tx.query("update content_desk_items set render_status = 'failed', render_error = $2 where content_item_id = $1", [id, (result.error ?? "the file did not arrive").slice(0, 300)]);
    return true;
  }
  const a = await tx.one<{ id: string }>(
    `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, origin, tags, rights_note)
     values ($1,$2,'video',$3,$4,'video/mp4','generated','{desk-reel}','Made by God of Marketing from recordings of the Back app; original synthesized music.') returning id`,
    [d.workspace_id, productId, d.title.slice(0, 200), result.storageKey],
  );
  await tx.query("update content_desk_items set render_status = 'ready', video_asset_id = $2, render_error = null where content_item_id = $1", [id, a.id]);
  return true;
}

export async function rejectDeskItem(tx: Tx, actor: Actor, productId: string, itemId: string) {
  const a = await tx.maybeOne<{ id: string }>(
    "select a.id from approval_items a join content_items i on i.current_version_id = a.content_version_id where i.id = $1 and i.product_id = $2 and a.state = 'pending'",
    [itemId, productId],
  );
  if (a) await decideApproval(tx, actor, productId, a.id, "rejected", "Removed on the content desk").catch(() => undefined);
  await tx.query("update approval_items set state = 'invalidated' where id = $1 and state = 'pending'", [a?.id ?? null]);
  await tx.query("update content_items set status = 'rejected', scheduled_for = null where id = $1 and product_id = $2 and status <> 'published'", [itemId, productId]);
}

export interface DeskItem {
  id: string;
  kind: DeskKind;
  status: string;
  title: string;
  topic: string;
  insight: string;
  why_now: string;
  sources: Array<{ title: string; url: string | null }>;
  hooks: Array<{ text: string; mechanism: string }>;
  chosen_hook: number;
  body: ContentBody;
  image_asset_ids: string[];
  render_error: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  blocked_reason: string | null;
  external_url: string | null;
  created_at: string;
  reel: ReelSpec | null;
  video_asset_id: string | null;
  render_status: string | null;
}

export async function deskItems(tx: Tx, productId: string): Promise<DeskItem[]> {
  return tx.query<DeskItem>(
    `select i.id, d.kind, i.status, i.title, d.topic, d.insight, d.why_now, d.sources, d.hooks, d.chosen_hook, v.body, d.image_asset_ids, d.render_error,
            i.scheduled_for::text, i.published_at::text, i.created_at::text, d.reel, d.video_asset_id, d.render_status,
            (select string_agg(f->>'message', ' ') from content_reviews r, jsonb_array_elements(r.findings) f
              where r.content_version_id = i.current_version_id and r.outcome = 'block' and f->>'severity' = 'block') blocked_reason,
            (select p.external_url from publications p where p.content_item_id = i.id order by p.created_at desc limit 1) external_url
       from content_desk_items d join content_items i on i.id = d.content_item_id join content_versions v on v.id = i.current_version_id
      where d.product_id = $1 and i.status <> 'rejected' and i.created_at > now() - interval '45 days'
      order by i.created_at desc`,
    [productId],
  );
}

export interface IgImagesApi {
  token(): Promise<{ token: string; igUserId: string }>;
  fileUrl(storagePath: string): Promise<string>;
  image(token: string, igUserId: string, imageUrl: string, caption: string | null, carouselItem: boolean): Promise<string>;
  reel(token: string, igUserId: string, videoUrl: string, caption: string): Promise<string>;
  carousel(token: string, igUserId: string, children: string[], caption: string): Promise<string>;
  status(token: string, containerId: string): Promise<string>;
  publish(token: string, igUserId: string, containerId: string): Promise<string>;
  permalink(token: string, mediaId: string): Promise<string | null>;
  enabled: boolean;
}

/** Approved Instagram posts and carousels whose time has come: images → containers → publish (one per run). */
export async function publishDueInstagramPosts(tx: Tx, actor: Actor, productId: string, api: IgImagesApi, now = new Date()) {
  const due = await tx.query<{ id: string; format: string; current_version_id: string; body: ContentBody; image_asset_ids: string[]; rendered_version_id: string | null; video_asset_id: string | null; ig_container_id: string | null }>(
    `select i.id, i.format, i.current_version_id, v.body, d.image_asset_ids, d.rendered_version_id, d.video_asset_id, d.ig_container_id
       from content_items i join content_versions v on v.id = i.current_version_id join content_desk_items d on d.content_item_id = i.id
      where i.product_id = $1 and i.channel = 'instagram' and i.format in ('static_concept', 'carousel', 'reels_script') and i.status = 'scheduled' and i.scheduled_for <= $2
      order by i.scheduled_for limit 1`,
    [productId, now.toISOString()],
  );
  const out: Array<{ id: string; result: string }> = [];
  for (const it of due) {
    const approval = await tx.maybeOne<{ id: string }>("select id from approval_items where content_version_id = $1 and state = 'approved' order by decided_at desc limit 1", [it.current_version_id]);
    if (!approval) { out.push({ id: it.id, result: "not approved" }); continue; }
    const isReel = it.format === "reels_script";
    if (isReel ? !it.video_asset_id : it.rendered_version_id !== it.current_version_id || !it.image_asset_ids.length) { out.push({ id: it.id, result: isReel ? "video missing" : "images missing" }); continue; }
    if (!api.enabled) { out.push({ id: it.id, result: "posting switched off (INSTAGRAM_PUBLISHING_ENABLED)" }); continue; }
    const key = `ig-post:${it.current_version_id}`;
    if (await tx.maybeOne("select 1 from outbound_actions where product_id = $1 and dedupe_key = $2 and result = 'executed'", [productId, key])) continue;
    const ids = isReel ? [it.video_asset_id!] : it.image_asset_ids;
    const paths = await tx.query<{ id: string; storage_path: string }>("select id, storage_path from creative_assets where id = any($1)", [ids]);
    const ordered = ids.map((id) => paths.find((p) => p.id === id)!.storage_path);
    const caption = it.body.caption ?? "";
    const conn = await tx.one<{ id: string }>("select id from channel_connections where product_id = $1 and channel = 'instagram' and status = 'connected' and adapter_kind = 'official_api' order by created_at desc limit 1", [productId]);
    try {
      const { token, igUserId } = await api.token();
      let container: string;
      if (isReel) {
        // Reels take a while to process: create the container, then publish on a later run when it is ready.
        if (!it.ig_container_id) {
          const c = await api.reel(token, igUserId, await api.fileUrl(ordered[0]), caption);
          await tx.query("update content_desk_items set ig_container_id = $2 where content_item_id = $1", [it.id, c]);
          out.push({ id: it.id, result: "processing" });
          continue;
        }
        const st = await api.status(token, it.ig_container_id);
        if (st === "IN_PROGRESS") { out.push({ id: it.id, result: "processing" }); continue; }
        if (st !== "FINISHED") {
          await tx.query("update content_desk_items set ig_container_id = null where content_item_id = $1", [it.id]);
          throw new Error(`Instagram could not process the Reel (${st}).`);
        }
        container = it.ig_container_id;
      } else if (it.format === "static_concept") {
        container = await api.image(token, igUserId, await api.fileUrl(ordered[0]), caption, false);
      } else {
        const children: string[] = [];
        for (const p of ordered) children.push(await api.image(token, igUserId, await api.fileUrl(p), null, true));
        container = await api.carousel(token, igUserId, children, caption);
      }
      // Images are usually ready at once; give Instagram a few seconds if not.
      for (let i = 0; i < 5; i++) {
        const st = await api.status(token, container);
        if (st === "FINISHED") break;
        if (st === "ERROR" || st === "EXPIRED") throw new Error(`Instagram could not process the images (${st}).`);
        await new Promise((r) => setTimeout(r, 1500));
      }
      const media = await api.publish(token, igUserId, container);
      const url = await api.permalink(token, media).catch(() => null);
      await tx.query(
        "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, dedupe_key, result, reason) values ($1,$2,$3,$4,'publish',$5,'executed','Instagram post published after approval')",
        [actor.workspaceId, productId, conn.id, approval.id, key],
      );
      await tx.query(
        `insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, connection_id, method, external_url, external_id, approval_item_id)
         values ($1,$2,$3,$4,'instagram',$5,'api',$6,$7,$8)`,
        [actor.workspaceId, productId, it.id, it.current_version_id, conn.id, url, media, approval.id],
      );
      await tx.query("update content_items set status = 'published', published_at = now() where id = $1", [it.id]);
      out.push({ id: it.id, result: "published" });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await tx.query(
        "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, result, reason) values ($1,$2,$3,$4,'publish','failed',$5)",
        [actor.workspaceId, productId, conn.id, approval.id, msg],
      );
      // Try again in an hour rather than at every queue run.
      await tx.query("update content_items set scheduled_for = now() + interval '1 hour' where id = $1", [it.id]);
      out.push({ id: it.id, result: `failed: ${msg}` });
    }
  }
  return out;
}
