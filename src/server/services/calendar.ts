import type { Tx } from "@/server/db/client";
import type { IgMedia } from "@/server/instagram/api";
import type { ThreadsOwnPost } from "@/server/threads/api";
import type { OwnVideo } from "@/server/youtube/write";

/**
 * One calendar for everything: what God of Marketing scheduled or published (calm videos, shorts, reels, posts,
 * comments) and what lives on the platforms themselves, read from the official APIs (also posts made outside, e.g.
 * in Meta Business Suite once they are published). Read-only: the calendar never posts anything.
 */
export type CalChannel = "instagram" | "facebook" | "threads" | "youtube" | "tiktok" | "website";
export const CAL_CHANNELS: CalChannel[] = ["instagram", "facebook", "threads", "youtube", "tiktok", "website"];

export interface CalendarReaders {
  instagram?: () => Promise<IgMedia[]>;
  threads?: () => Promise<ThreadsOwnPost[]>;
  youtube?: () => Promise<OwnVideo[]>;
}

type Ev = { source: CalChannel; external_id: string; kind: string; status: string; title: string; url: string | null; thumbnail_url: string | null; at: string };

export function eventsFromInstagram(media: IgMedia[]): Ev[] {
  return media.filter((m) => m.timestamp).map((m) => ({
    source: "instagram", external_id: m.id, status: "published",
    kind: m.media_product_type === "REELS" ? "reel" : m.media_product_type === "STORY" ? "story" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : m.media_type === "VIDEO" ? "video" : "image",
    title: m.caption.replace(/\s+/g, " ").slice(0, 140), url: m.permalink, thumbnail_url: m.thumbnail_url, at: m.timestamp!,
  }));
}

export function eventsFromThreads(posts: ThreadsOwnPost[]): Ev[] {
  // Replies are conversations, not posts: they are counted with the comments.
  return posts.filter((p) => p.timestamp && !p.is_reply && p.media_type !== "REPOST_FACADE").map((p) => ({
    source: "threads", external_id: p.id, status: "published",
    kind: p.media_type === "VIDEO" ? "video" : p.media_type === "IMAGE" ? "image" : p.media_type === "CAROUSEL_ALBUM" ? "carousel" : "text",
    title: p.text.replace(/\s+/g, " ").slice(0, 140), url: p.permalink, thumbnail_url: p.thumbnail_url, at: p.timestamp!,
  }));
}

export function eventsFromYoutube(videos: OwnVideo[]): Ev[] {
  return videos.flatMap((v) => {
    const scheduled = v.privacy === "private" && v.publishAt;
    const at = scheduled ? v.publishAt : v.publishedAt;
    if (!at) return [];
    return [{
      source: "youtube" as const, external_id: v.id, kind: v.seconds !== null && v.seconds <= 180 ? "short" : "video",
      status: scheduled ? "scheduled" : v.privacy === "private" ? "private" : "published",
      title: v.title.slice(0, 140), url: `https://www.youtube.com/watch?v=${v.id}`, thumbnail_url: v.privacy === "public" || v.privacy === "unlisted" ? v.thumbnail : null, at,
    }];
  });
}

/** Reads every connected platform and mirrors its posts. A platform that fails is reported and the others still sync. */
export async function syncCalendar(tx: Tx, workspaceId: string, productId: string, readers: CalendarReaders) {
  const out: Record<string, number | string> = {};
  const jobs: Array<[CalChannel, (() => Promise<Ev[]>) | undefined]> = [
    ["instagram", readers.instagram && (async () => eventsFromInstagram(await readers.instagram!()))],
    ["threads", readers.threads && (async () => eventsFromThreads(await readers.threads!()))],
    ["youtube", readers.youtube && (async () => eventsFromYoutube(await readers.youtube!()))],
  ];
  for (const [source, job] of jobs) {
    if (!job) continue;
    try {
      const evs = await job();
      for (const e of evs) {
        await tx.query(
          `insert into calendar_events (workspace_id, product_id, source, external_id, kind, status, title, url, thumbnail_url, at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (product_id, source, external_id) do update set kind = excluded.kind, status = excluded.status, title = excluded.title,
             url = excluded.url, thumbnail_url = excluded.thumbnail_url, at = excluded.at, synced_at = now(), updated_at = now()`,
          [workspaceId, productId, e.source, e.external_id, e.kind, e.status, e.title, e.url, e.thumbnail_url, e.at],
        );
      }
      // A scheduled video that was deleted on the platform disappears from the next read: drop it here too.
      const ids = evs.map((e) => e.external_id);
      await tx.query("delete from calendar_events where product_id = $1 and source = $2 and status <> 'published' and not (external_id = any($3))", [productId, source, ids]);
      out[source] = evs.length;
    } catch (e) {
      out[source] = `error: ${(e as Error).message.slice(0, 160)}`;
    }
  }
  return out;
}

export interface CalItem {
  key: string;
  at: string;
  channel: CalChannel;
  kind: string;
  status: "published" | "scheduled" | "review" | "private" | "failed";
  title: string;
  url: string | null;
  href: string | null;
  thumb: string | null;
  origin: "ours" | "platform";
}
export interface CalCount { day: string; channel: CalChannel; ours: number; people: number }

/** Everything between two moments, deduplicated (our own items win over their platform mirror: they know more). */
export async function calendarItems(tx: Tx, productId: string, from: Date, to: Date): Promise<{ items: CalItem[]; counts: CalCount[] }> {
  const p = [productId, from.toISOString(), to.toISOString()];
  const videos = await tx.query<{ id: string; title: string; status: string; publish_at: string; youtube_video_id: string | null }>(
    `select id, title, status, publish_at::text, youtube_video_id from calm_videos
      where product_id = $1 and publish_at between $2 and $3 and status in ('approved', 'scheduled', 'published')`, p);
  const shorts = await tx.query<{ id: string; title: string; status: string; publish_at: string; targets: string[]; youtube_video_id: string | null; instagram_media_id: string | null; instagram_status: string | null; tiktok_status: string | null }>(
    `select id, title, status, publish_at::text, targets, youtube_video_id, instagram_media_id, instagram_status, tiktok_status from calm_shorts
      where product_id = $1 and publish_at between $2 and $3 and status in ('scheduled', 'published')`, p);
  const posts = await tx.query<{ id: string; title: string; status: string; channel: string; at: string; external_id: string | null }>(
    `select i.id, i.title, i.status, i.channel, coalesce(i.published_at, i.scheduled_for)::text at,
            (select pb.external_id from publications pb where pb.content_item_id = i.id and pb.external_id is not null order by pb.created_at desc limit 1) external_id
       from content_items i where i.product_id = $1 and i.status in ('scheduled', 'published') and coalesce(i.published_at, i.scheduled_for) between $2 and $3`, p);
  const mirrored = await tx.query<{ id: string; source: CalChannel; external_id: string; kind: string; status: string; title: string; url: string | null; thumbnail_url: string | null; at: string }>(
    "select id, source, external_id, kind, status, title, url, thumbnail_url, at::text from calendar_events where product_id = $1 and at between $2 and $3", p);
  const counts = await tx.query<CalCount>(
    `select to_char(m.occurred_at at time zone 'Europe/Riga', 'YYYY-MM-DD') "day", c.channel,
            count(*) filter (where m.direction = 'outbound' and m.status = 'posted')::int ours, count(*) filter (where m.direction = 'inbound')::int people
       from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and m.occurred_at between $2 and $3 and c.channel in ('youtube', 'threads', 'instagram')
      group by 1, 2 having count(*) filter (where m.direction = 'outbound' and m.status = 'posted') + count(*) filter (where m.direction = 'inbound') > 0`, p);

  const known = new Map<string, CalItem>();
  const items: CalItem[] = [];
  const st = (s: string): CalItem["status"] => (s === "published" ? "published" : s === "approved" ? "scheduled" : (s as CalItem["status"]));
  for (const v of videos) {
    const it: CalItem = { key: `v:${v.id}`, at: v.publish_at, channel: "youtube", kind: "video", status: st(v.status), title: v.title, url: v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null, href: "/calm", thumb: null, origin: "ours" };
    if (v.youtube_video_id) known.set(`youtube:${v.youtube_video_id}`, it);
    items.push(it);
  }
  for (const s of shorts) {
    if (s.targets.includes("youtube")) {
      const it: CalItem = { key: `s:${s.id}:yt`, at: s.publish_at, channel: "youtube", kind: "short", status: st(s.status), title: s.title, url: s.youtube_video_id ? `https://www.youtube.com/shorts/${s.youtube_video_id}` : null, href: "/calm", thumb: null, origin: "ours" };
      if (s.youtube_video_id) known.set(`youtube:${s.youtube_video_id}`, it);
      items.push(it);
    }
    if (s.targets.includes("instagram")) {
      const it: CalItem = { key: `s:${s.id}:ig`, at: s.publish_at, channel: "instagram", kind: "reel", status: s.instagram_status === "published" ? "published" : s.instagram_status === "failed" ? "failed" : "scheduled", title: s.title, url: null, href: "/calm", thumb: null, origin: "ours" };
      if (s.instagram_media_id) known.set(`instagram:${s.instagram_media_id}`, it);
      items.push(it);
    }
    if (s.targets.includes("tiktok")) {
      items.push({ key: `s:${s.id}:tt`, at: s.publish_at, channel: "tiktok", kind: "video", status: s.tiktok_status === "published" ? "published" : s.tiktok_status === "failed" ? "failed" : s.tiktok_status === "sent_to_inbox" ? "review" : "scheduled", title: s.title, url: null, href: "/calm", thumb: null, origin: "ours" });
    }
  }
  for (const c of posts) {
    const ch = (CAL_CHANNELS as string[]).includes(c.channel) ? (c.channel as CalChannel) : null;
    if (!ch) continue;
    const it: CalItem = { key: `c:${c.id}`, at: c.at, channel: ch, kind: ch === "website" ? "article" : "post", status: st(c.status), title: c.title, url: null, href: `/studio/${c.id}`, thumb: null, origin: "ours" };
    if (c.external_id) known.set(`${ch}:${c.external_id}`, it);
    items.push(it);
  }
  for (const e of mirrored) {
    const mine = known.get(`${e.source}:${e.external_id}`);
    if (mine) {
      // Keep our item (it knows the approval state), borrow the platform's picture and link.
      mine.thumb ??= e.thumbnail_url;
      mine.url ??= e.url;
      continue;
    }
    items.push({ key: `e:${e.id}`, at: e.at, channel: e.source, kind: e.kind, status: st(e.status), title: e.title, url: e.url, href: null, thumb: e.thumbnail_url, origin: "platform" });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { items, counts };
}

export async function lastCalendarSync(tx: Tx, productId: string) {
  return (await tx.one<{ at: string | null }>("select max(synced_at)::text at from calendar_events where product_id = $1", [productId])).at;
}
