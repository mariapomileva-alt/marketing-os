import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";
import { nextShortSlot } from "./calm-shorts";
import { mixShorts, type MixDeps } from "./shorts-mix";

/**
 * Spreads what is already approved evenly over the coming days, so no day is crowded and no day is empty:
 *   Instagram feed (content desk): 2 posts and 1 explainer Reel a day, at the desk's times;
 *   calm shorts: per day at most 3 on YouTube Shorts, 2 Instagram Reels and 3 on TikTok, at the short times.
 * Order is kept (what was planned first goes first); then shorts are mixed so one look does not repeat on a day.
 * Only items not sent anywhere yet and more than two hours away move; YouTube gets the new times too.
 */
// Calm shorts a day; the day's 2 explainers add two more YouTube Shorts and two more Reels (3 of each in all).
export const DAILY_CAPS = { youtube: 1, instagram: 1, tiktok: 3 } as const;

const rigaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Riga", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Desk times for a kind: the explainer Reel takes the middle time of the day, posts the others. */
export function deskTimesFor(kind: "reel" | "post", slots: string[], reelsPerDay = 1) {
  if (slots.length < 2 || reelsPerDay <= 0) return kind === "reel" ? [] : slots;
  // Reels take the middle times of the day (afternoon), posts the morning and evening ones.
  const k = Math.min(reelsPerDay, slots.length - 1);
  const start = Math.floor((slots.length - k) / 2);
  const reel = new Set(slots.slice(start, start + k));
  return kind === "reel" ? slots.filter((t) => reel.has(t)) : slots.filter((t) => !reel.has(t));
}

async function rigaAt(tx: Tx, day: number, time: string, now: Date) {
  return new Date((await tx.one<{ at: string }>(
    "select ((date_trunc('day', $1::timestamptz at time zone 'Europe/Riga') + $2::interval + $3::time) at time zone 'Europe/Riga')::text at",
    [now.toISOString(), `${day} days`, time])).at);
}

/** Instagram feed pieces from the desk: re-spread, oldest first, 2 posts + 1 Reel a day. Overdue ones move forward. */
export async function evenDesk(tx: Tx, productId: string, now = new Date(), mover: MixDeps | null = null) {
  const ds = await tx.maybeOne<{ slots: string[]; reels: number }>("select slots, reels_per_day reels from content_desk_settings where product_id = $1", [productId]);
  const slots = ds?.slots ?? ["10:30", "15:30", "21:00"];
  const items = await tx.query<{ id: string; format: string; scheduled_for: string; explain: boolean; youtube_video_id: string | null }>(
    `select i.id, i.format, i.scheduled_for::text, coalesce(d.reel->>'format' = 'explain', false) explain,
            case when d.youtube_status = 'uploaded' then d.youtube_video_id end youtube_video_id
       from content_items i join content_desk_items d on d.content_item_id = i.id
      where i.product_id = $1 and i.channel = 'instagram' and i.status = 'scheduled' and i.published_at is null
        and (i.scheduled_for is null or i.scheduled_for > $2::timestamptz + interval '2 hours' or i.scheduled_for < $2::timestamptz)
        and d.ig_container_id is null and ($3 or coalesce(d.youtube_status, '') <> 'uploaded')
      order by i.scheduled_for nulls last, i.created_at`,
    [productId, now.toISOString(), Boolean(mover)],
  );
  const fixed = new Set((await tx.query<{ k: string }>(
    `select to_char(scheduled_for at time zone 'Europe/Riga', 'YYYY-MM-DD HH24:MI') k from content_items
      where product_id = $1 and channel = 'instagram' and status in ('scheduled', 'published') and scheduled_for between $2::timestamptz and $2::timestamptz + interval '2 hours'`,
    [productId, now.toISOString()])).map((r) => r.k));
  // Explainer Reels (animated drawings with a voice) take the daily Reel time first; other desk Reels follow after them.
  const reels = items.filter((i) => i.format === "reels_script");
  const queues = { reel: [...reels.filter((r) => r.explain), ...reels.filter((r) => !r.explain)], post: items.filter((i) => i.format !== "reels_script") };
  let moved = 0;
  for (const kind of ["post", "reel"] as const) {
    const times = deskTimesFor(kind, slots, Math.max(1, ds?.reels ?? 1));
    let day = 0;
    let ti = 0;
    for (const it of queues[kind]) {
      for (;;) {
        if (ti >= times.length) { ti = 0; day++; }
        const at = await rigaAt(tx, day, times[ti], now);
        const key = `${rigaDay(at)} ${times[ti]}`;
        ti++;
        if (at.getTime() < now.getTime() + 2.5 * 3_600_000 || fixed.has(key)) continue;
        if (!it.scheduled_for || new Date(it.scheduled_for).getTime() !== at.getTime()) {
          // An explainer already scheduled on YouTube Shorts moves there too (same time as on Instagram).
          if (it.youtube_video_id && mover) await mover.move(it.youtube_video_id, at);
          await tx.query("update content_items set scheduled_for = $2 where id = $1", [it.id, at.toISOString()]);
          moved++;
        }
        break;
      }
    }
  }
  return { moved, posts: queues.post.length, reels: queues.reel.length };
}

/** Which platforms a short goes to. */
const platformsOf = (targets: string[]) => targets.filter((t): t is keyof typeof DAILY_CAPS => t in DAILY_CAPS);

/**
 * Calm shorts: each one gets the first time (from the short times, at least 3 hours ahead) where none of its platforms
 * already has a short at that time and the day is under that platform's daily cap. Then looks are mixed.
 */
export async function evenShorts(tx: Tx, actor: Actor, productId: string, mover: MixDeps | null, now = new Date()) {
  const slots = (await tx.maybeOne<{ s: string[] }>("select short_slots s from calm_settings where product_id = $1", [productId]))?.s ?? ["06:30", "11:30", "17:30"];
  const movable = await tx.query<{ id: string; targets: string[]; publish_at: string; youtube_video_id: string | null; title: string }>(
    `select id, targets, publish_at::text, youtube_video_id, title from calm_shorts
      where product_id = $1 and status = 'scheduled' and publish_at > $2::timestamptz + interval '2 hours'
        and coalesce(instagram_status, 'queued') = 'queued' and coalesce(tiktok_status, 'queued') = 'queued'
      order by publish_at, idx`,
    [productId, now.toISOString()],
  );
  const ids = new Set(movable.map((m) => m.id));
  // What stays where it is: shorts about to go out, and shorts scheduled on YouTube outside God of Marketing.
  const fixed = [
    ...(await tx.query<{ id: string; targets: string[]; publish_at: string }>(
      "select id, targets, publish_at::text from calm_shorts where product_id = $1 and status in ('scheduled', 'published') and publish_at > $2::timestamptz - interval '1 day'",
      [productId, now.toISOString()])).filter((f) => !ids.has(f.id)),
    ...(await tx.query<{ publish_at: string }>(
      `select e.at::text publish_at from calendar_events e where e.product_id = $1 and e.source = 'youtube' and e.kind = 'short' and e.status = 'scheduled' and e.at > $2
         and not exists (select 1 from calm_shorts s where s.product_id = e.product_id and s.youtube_video_id = e.external_id)`,
      [productId, now.toISOString()])).map((e) => ({ id: "", targets: ["youtube"], publish_at: e.publish_at })),
  ];
  const at = new Map<string, Set<number>>(); // platform -> times taken (ms)
  const perDay = new Map<string, number>(); // "platform|day" -> count
  const take = (targets: string[], t: Date) => {
    for (const p of platformsOf(targets)) {
      (at.get(p) ?? at.set(p, new Set()).get(p)!).add(t.getTime());
      const k = `${p}|${rigaDay(t)}`;
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
  };
  for (const f of fixed) take(f.targets, new Date(f.publish_at));
  const fits = (targets: string[], t: Date) =>
    platformsOf(targets).every((p) => !(at.get(p)?.has(t.getTime())) && (perDay.get(`${p}|${rigaDay(t)}`) ?? 0) < DAILY_CAPS[p]);
  let moved = 0;
  const failed: string[] = [];
  for (const s of movable) {
    let t = nextShortSlot(slots, [], now);
    for (let guard = 0; guard < 400 && !fits(s.targets, t); guard++) t = nextShortSlot(slots, [], new Date(t.getTime() - 3 * 3_600_000 + 60_000));
    take(s.targets, t);
    if (t.getTime() === new Date(s.publish_at).getTime()) continue;
    try {
      if (s.youtube_video_id && s.targets.includes("youtube")) {
        if (!mover) throw new Error("YouTube is not connected");
        await mover.move(s.youtube_video_id, t);
        await tx.query("update calendar_events set at = $3 where product_id = $1 and source = 'youtube' and external_id = $2", [productId, s.youtube_video_id, t.toISOString()]);
      }
      await tx.query("update calm_shorts set publish_at = $2 where id = $1", [s.id, t.toISOString()]);
      moved++;
    } catch (e) {
      failed.push(`${s.title}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  if (moved) {
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4) on conflict do nothing",
      [actor.workspaceId, productId, `even-shorts:${now.toISOString()}`, `${moved} scheduled short(s) spread evenly over the coming days by the owner`],
    );
  }
  const mix = await mixShorts(tx, actor, productId, mover, { includeOwn: false });
  return { moved, failed: [...failed, ...mix.failed], mixed: mix.moved };
}
