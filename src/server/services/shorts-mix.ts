import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";

/**
 * Mixing scheduled shorts. Shorts cut from one long calm video look alike (same footage), and so do the owner's own
 * videos; scheduled one after another they make a run of identical visuals. This keeps the publishing times exactly as
 * they are (same number a day, same hours) and only changes WHICH short goes at which time, so the same look is
 * spread out: never twice on one day where avoidable, rarely on two days in a row, at irregular gaps.
 */
export interface MixItem {
  key: string;           // "gom:<calm_short id>" or "yt:<youtube video id>"
  family: string;        // the look: "calm:<long video id>" or "own"
  at: Date;
  label: string;
}

const rigaDay = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Riga", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return Math.round(Date.parse(`${p}T00:00:00Z`) / 86_400_000);
};

/** Small seeded random generator, so a plan can be repeated in tests. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function cost(assign: string[], days: number[]) {
  let c = 0;
  for (let i = 0; i < assign.length; i++) {
    for (let j = i + 1; j < assign.length; j++) {
      if (assign[i] !== assign[j]) continue;
      const gap = Math.abs(days[j] - days[i]);
      c += gap === 0 ? 100 : gap === 1 ? 10 : gap === 2 ? 2 : 0;
    }
  }
  return c;
}

/**
 * Which family goes into which time: randomized greedy (scarcest look first), then random swaps that never make it
 * worse; the best of several tries wins. Within a family the original order is kept (part 1 before part 2).
 */
export function planMix(items: MixItem[], seed = Date.now()) {
  const slots = items.map((i) => i.at).sort((a, b) => a.getTime() - b.getTime());
  const days = slots.map(rigaDay);
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.family, (counts.get(i.family) ?? 0) + 1);
  const r = rng(seed);
  let best: string[] = [];
  let bestCost = Infinity;
  for (let attempt = 0; attempt < 24; attempt++) {
    const left = new Map(counts);
    const assign: string[] = [];
    for (let s = 0; s < slots.length; s++) {
      let pick = "";
      let pickScore = Infinity;
      for (const [fam, n] of left) {
        if (!n) continue;
        let inc = 0;
        for (let k = 0; k < s; k++) if (assign[k] === fam) { const g = days[s] - days[k]; inc += g === 0 ? 100 : g === 1 ? 10 : g === 2 ? 2 : 0; }
        const score = inc - n * 0.5 + r() * 3; // prefer looks with many left, with some randomness
        if (score < pickScore) { pickScore = score; pick = fam; }
      }
      assign.push(pick);
      left.set(pick, left.get(pick)! - 1);
    }
    let c = cost(assign, days);
    for (let it = 0; it < 400 && c > 0; it++) {
      const a = Math.floor(r() * assign.length);
      const b = Math.floor(r() * assign.length);
      if (assign[a] === assign[b]) continue;
      [assign[a], assign[b]] = [assign[b], assign[a]];
      const n = cost(assign, days);
      if (n <= c) c = n;
      else [assign[a], assign[b]] = [assign[b], assign[a]];
    }
    if (c < bestCost) { bestCost = c; best = [...assign]; }
  }
  const byFamily = new Map<string, MixItem[]>();
  for (const i of [...items].sort((a, b) => a.at.getTime() - b.at.getTime())) byFamily.set(i.family, [...(byFamily.get(i.family) ?? []), i]);
  const moves: Array<{ item: MixItem; to: Date }> = [];
  best.forEach((fam, s) => {
    const item = byFamily.get(fam)!.shift()!;
    moves.push({ item, to: slots[s] });
  });
  return { moves, cost: bestCost, before: cost(items.slice().sort((a, b) => a.at.getTime() - b.at.getTime()).map((i) => i.family), days) };
}

/** Scheduled shorts that can still be moved (at least two hours ahead, nothing sent anywhere yet). */
export async function movableShorts(tx: Tx, productId: string, includeOwn: boolean): Promise<Array<MixItem & { youtubeId: string | null }>> {
  const ours = await tx.query<{ id: string; video_id: string; title: string; publish_at: string; youtube_video_id: string | null }>(
    `select id, video_id, title, publish_at::text, youtube_video_id from calm_shorts
      where product_id = $1 and status = 'scheduled' and publish_at > now() + interval '2 hours'
        and coalesce(instagram_status, 'queued') = 'queued' and coalesce(tiktok_status, 'queued') = 'queued'`,
    [productId],
  );
  const items: Array<MixItem & { youtubeId: string | null }> = ours.map((s) => ({
    key: `gom:${s.id}`, family: `calm:${s.video_id}`, at: new Date(s.publish_at), label: s.title, youtubeId: s.youtube_video_id,
  }));
  if (includeOwn) {
    // Shorts scheduled on YouTube outside God of Marketing (the owner's own videos), as last read from the channel.
    const theirs = await tx.query<{ external_id: string; title: string; at: string }>(
      `select e.external_id, e.title, e.at::text from calendar_events e
        where e.product_id = $1 and e.source = 'youtube' and e.kind = 'short' and e.status = 'scheduled' and e.at > now() + interval '2 hours'
          and not exists (select 1 from calm_shorts s where s.product_id = e.product_id and s.youtube_video_id = e.external_id)
          and not exists (select 1 from calm_videos v where v.product_id = e.product_id and v.youtube_video_id = e.external_id)`,
      [productId],
    );
    items.push(...theirs.map((e) => ({ key: `yt:${e.external_id}`, family: "own", at: new Date(e.at), label: e.title, youtubeId: e.external_id })));
  }
  return items;
}

export interface MixDeps {
  /** Moves a scheduled YouTube video to a new publish time (changes nothing else). */
  move(youtubeId: string, at: Date): Promise<void>;
}

export async function mixShorts(tx: Tx, actor: Actor, productId: string, deps: MixDeps | null, opts: { includeOwn: boolean; seed?: number }) {
  const items = await movableShorts(tx, productId, opts.includeOwn && Boolean(deps));
  if (items.length < 3 || new Set(items.map((i) => i.family)).size < 2) return { moved: 0, failed: [] as string[], before: 0, after: 0 };
  const plan = planMix(items, opts.seed);
  let moved = 0;
  const failed: string[] = [];
  for (const { item, to } of plan.moves) {
    if (item.at.getTime() === to.getTime()) continue;
    const yt = (item as MixItem & { youtubeId: string | null }).youtubeId;
    try {
      if (yt) {
        if (!deps) throw new Error("YouTube is not connected");
        await deps.move(yt, to);
      }
      if (item.key.startsWith("gom:")) await tx.query("update calm_shorts set publish_at = $2 where id = $1", [item.key.slice(4), to.toISOString()]);
      // The calendar's copy of the YouTube video moves with it (until the next read from YouTube).
      if (yt) await tx.query("update calendar_events set at = $3 where product_id = $1 and source = 'youtube' and external_id = $2", [productId, yt, to.toISOString()]);
      await tx.query(
        `insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4)
         on conflict do nothing`,
        [actor.workspaceId, productId, `short-mix:${item.key}:${to.toISOString()}`, `Short moved from ${item.at.toISOString()} to ${to.toISOString()} to mix the looks: ${item.label}`.slice(0, 500)],
      );
      moved++;
    } catch (e) {
      failed.push(`${item.label}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return { moved, failed, before: plan.before, after: plan.cost };
}
