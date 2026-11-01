import type { Tx } from "@/server/db/client";

/**
 * Explainer Reels (animated drawings with a voice) also go to YouTube Shorts. Once the owner approved the Reel and it
 * has its Instagram time, the same file is uploaded to YouTube as a PRIVATE video scheduled for that same time.
 * One upload per call (YouTube's daily upload quota is small); nothing unapproved is ever uploaded.
 */
export interface ExplainerYoutubeDeps {
  read(storagePath: string): Promise<Uint8Array>;
  upload(meta: { title: string; description: string; tags: string[] }, bytes: Uint8Array): Promise<string>;
  schedule(videoId: string, at: Date): Promise<void>;
}

export async function queueExplainersForYoutube(tx: Tx, productId: string) {
  const r = await tx.query(
    `update content_desk_items d set youtube_status = 'queued', youtube_error = null
       from content_items i where i.id = d.content_item_id and d.product_id = $1 and d.kind = 'reel' and d.reel->>'format' = 'explain'
        and i.status = 'scheduled' and i.scheduled_for > now() + interval '40 minutes' and d.youtube_status is null
        and d.render_status = 'ready' and d.video_asset_id is not null
     returning d.content_item_id`, [productId]);
  return r.length;
}

export async function uploadNextExplainer(tx: Tx, productId: string, deps: ExplainerYoutubeDeps, link = "") {
  const it = await tx.maybeOne<{ id: string; workspace_id: string; title: string; caption: string | null; scheduled_for: string; storage_path: string; intro: string | null }>(
    `select i.id, i.workspace_id, i.title, v.body->>'caption' caption, i.scheduled_for::text, a.storage_path,
            (select string_agg(x, ' ') from jsonb_array_elements_text(d.reel->'intro_lines') x) intro
       from content_desk_items d join content_items i on i.id = d.content_item_id join content_versions v on v.id = i.current_version_id
       join creative_assets a on a.id = d.video_asset_id
      where d.product_id = $1 and d.youtube_status = 'queued' and i.status = 'scheduled'
      order by i.scheduled_for limit 1 for update of d skip locked`, [productId]);
  if (!it) return null;
  const at = new Date(it.scheduled_for);
  if (at.getTime() < Date.now() + 20 * 60_000) {
    await tx.query("update content_desk_items set youtube_status = 'skipped', youtube_error = 'Its time came before it could be uploaded.' where content_item_id = $1", [it.id]);
    return { skipped: it.id };
  }
  try {
    const title = `${(it.intro || it.title).replace(/\s+/g, " ").trim()} #shorts`.slice(0, 100);
    const description = [
      `A small, practical explainer from the team behind Back${link ? `: ${link}` : "."}`,
      "",
      "Not medical advice. If you are in danger, contact your local emergency number now.",
      "Drawings, voice (AI) and music made for Back.",
    ].join("\n");
    const videoId = await deps.upload({ title, description, tags: ["panic attack", "anxiety", "calm", "shorts"] }, await deps.read(it.storage_path));
    await deps.schedule(videoId, at);
    await tx.query("update content_desk_items set youtube_status = 'uploaded', youtube_video_id = $2, youtube_error = null where content_item_id = $1", [it.id, videoId]);
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4) on conflict do nothing",
      [it.workspace_id, productId, `explainer-yt:${it.id}`, `Explainer Reel scheduled on YouTube Shorts for ${at.toISOString()} (approved on the content desk)`],
    );
    return { uploaded: videoId };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    // Out of YouTube's daily quota: try again on a later run (the quota resets daily).
    await tx.query("update content_desk_items set youtube_status = $2, youtube_error = $3 where content_item_id = $1",
      [it.id, /quota/i.test(msg) ? "queued" : "failed", msg]);
    return { error: msg };
  }
}
