import { approveAllShortsAction, approveShortAction, rejectShortAction, selectShortsAction } from "@/app/actions/calm";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";
import { Textarea } from "@/components/ui/form";
import { defaultTikTokCaption } from "@/server/services/tiktok";
import type { CreatorInfo } from "@/server/tiktok/api";

export type TikTokPanel = { connected: boolean; account: string | null; direct: boolean; info: CreatorInfo | null };

const PRIVACY: Record<string, string> = { PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers", SELF_ONLY: "Only me" };
const TT_STATUS: Record<string, string> = {
  queued: "TikTok: waiting for its time", processing: "TikTok: uploading", sent_to_inbox: "TikTok: in your TikTok inbox, finish the post in the app",
  published: "TikTok: published", failed: "TikTok: failed",
};
const TARGET: Record<string, string> = { youtube: "YouTube Shorts", instagram: "Instagram Reels", tiktok: "TikTok" };

export type ShortRow = {
  id: string; video_id: string; idx: number; title: string; line_from: number; line_to: number; targets: string[]; status: string; error: string | null;
  youtube_video_id: string | null; instagram_status: string | null; preview_asset_id: string | null; publish_at: string | null;
  tiktok_status: string | null; tiktok_error: string | null; tiktok_post_id: string | null;
};

const LABEL: Record<string, string> = {
  planned: "not made yet", ready_to_render: "waiting for the renderer", rendering: "rendering", review: "ready to watch", scheduled: "scheduled", published: "published", rejected: "rejected", failed: "failed",
};

/** Shorts and Reels cut from one calm video: tick where each should go, then watch and approve each one. */
export function ShortsBlock({ slug, videoId, lines, shorts, youtube, instagram, tiktok }: { slug: string; videoId: string; lines: Array<{ text: string }>; shorts: ShortRow[]; youtube: boolean; instagram: boolean; tiktok: TikTokPanel }) {
  if (!shorts.length) return null;
  const planned = shorts.filter((s) => ["planned", "failed", "rejected"].includes(s.status));
  const made = shorts.filter((s) => !["planned", "failed", "rejected"].includes(s.status));
  return (
    <details className="mt-3 rounded-[var(--radius-panel)] border border-line p-3 text-[13px]" open={made.some((s) => s.status === "review")}>
      <summary className="cursor-pointer font-medium">Shorts and Reels from this video ({shorts.length}) {made.length ? <span className="font-normal text-muted">· {made.length} made</span> : null}</summary>
      <p className="mt-2 text-muted">Each is 30–60 seconds, vertical, with the same voice and nature. Tick where it should go, then watch and approve each one.</p>

      {made.filter((s) => s.status === "review").length > 1 ? (
        <ActionForm action={approveAllShortsAction.bind(null, slug, videoId)} submitLabel={`Approve all ${made.filter((s) => s.status === "review").length} ready shorts`} pendingLabel="Scheduling…" className="mt-3 flex flex-col gap-1"><span /></ActionForm>
      ) : null}
      {made.length ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {made.map((s) => (
            <li key={s.id} className="rounded-[var(--radius-panel)] border border-line bg-paper p-2">
              {s.preview_asset_id ? <video src={`/p/${slug}/creatives/${s.preview_asset_id}`} controls preload="metadata" playsInline className="aspect-[9/16] w-full rounded bg-ink object-cover" /> : <div className="grid aspect-[9/16] w-full place-items-center rounded bg-sage-tint text-muted">{LABEL[s.status]}</div>}
              <p className="mt-2 line-clamp-2 font-medium">{s.idx}. {s.title}</p>
              <p className="text-[12px] text-muted">{s.targets.map((t) => TARGET[t] ?? t).join(" + ")}</p>
              <div className="mt-1"><Status tone={s.status === "failed" ? "red" : ["scheduled", "published"].includes(s.status) ? "green" : "amber"}>{s.status === "scheduled" && s.publish_at ? `scheduled ${formatDateTime(s.publish_at)}` : LABEL[s.status]}</Status>{s.instagram_status === "failed" ? <Status tone="red">Instagram failed</Status> : null}</div>
              {s.tiktok_status ? <p className={`mt-1 text-[12px] ${s.tiktok_status === "failed" ? "text-red" : "text-muted"}`}>{TT_STATUS[s.tiktok_status]}{s.tiktok_error ? `: ${s.tiktok_error}` : ""}</p> : null}
              {s.error ? <p className="mt-1 text-[12px] text-red">{s.error}</p> : null}
              {s.status === "review" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ActionForm action={approveShortAction.bind(null, slug, s.id)} submitLabel="Approve" pendingLabel="Scheduling…" className="flex w-full flex-col gap-2">
                    {s.targets.includes("tiktok") ? <TikTokFields short={s} tiktok={tiktok} /> : <span />}
                  </ActionForm>
                  <form action={rejectShortAction.bind(null, slug, s.id)}><Button size="sm" variant="ghost">Reject</Button></form>
                </div>
              ) : null}
              {s.preview_asset_id ? <a href={`/p/${slug}/creatives/${s.preview_asset_id}`} download className="mt-1 inline-block text-[12px] underline">Download the video</a> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {planned.length ? (
        <ActionForm action={selectShortsAction.bind(null, slug, videoId)} submitLabel="Make the ticked shorts" pendingLabel="Queuing…" className="mt-3 flex flex-col gap-2">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Starts with</th><th className="py-1 pr-2">YouTube</th><th className="py-1 pr-2">Instagram</th><th className="py-1">TikTok</th></tr></thead>
            <tbody>
              {planned.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="py-1.5 pr-2 align-top text-faint">{s.idx}</td>
                  <td className="py-1.5 pr-2">
                    <span>{lines[s.line_from]?.text.replace(/^\[MOCK\]\s*/, "")}</span>
                    <span className="text-faint"> … {s.line_to - s.line_from + 1} lines</span>
                    {s.status !== "planned" ? <span className="ml-2 text-[12px] text-red">{LABEL[s.status]}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2"><input type="checkbox" name={`yt_${s.id}`} aria-label={`Short ${s.idx} on YouTube`} disabled={!youtube} defaultChecked={s.targets.includes("youtube")} /></td>
                  <td className="py-1.5 pr-2"><input type="checkbox" name={`ig_${s.id}`} aria-label={`Short ${s.idx} on Instagram`} disabled={!instagram} defaultChecked={s.targets.includes("instagram")} /></td>
                  <td className="py-1.5"><input type="checkbox" name={`tt_${s.id}`} aria-label={`Short ${s.idx} on TikTok`} disabled={!tiktok.connected} defaultChecked={s.targets.includes("tiktok")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!instagram ? <p className="text-[12px] text-muted">Instagram Reels: connect Instagram in Connections (with the publishing permission) to tick them.</p> : null}
          {!tiktok.connected ? <p className="text-[12px] text-muted">TikTok: connect TikTok in Connections to tick it.</p> : null}
        </ActionForm>
      ) : null}
    </details>
  );
}

/**
 * What goes to TikTok, shown before approval: the caption, and for direct posting the account, who can see it and
 * interactions. Nothing is preselected, as TikTok asks; until TikTok has audited the app the video goes to the
 * account's TikTok inbox and the owner chooses these in the TikTok app.
 */
function TikTokFields({ short, tiktok }: { short: ShortRow; tiktok: TikTokPanel }) {
  const info = tiktok.info;
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-line bg-surface p-2 text-[12px]">
      <legend className="px-1 font-medium">TikTok</legend>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Caption (exactly what TikTok gets)</span>
        <Textarea name="tt_caption" rows={5} maxLength={2200} defaultValue={defaultTikTokCaption(short.title)} className="text-[12px]" />
      </label>
      {tiktok.direct && info ? (
        <>
          <input type="hidden" name="tt_mode" value="direct" />
          <p>Posting to <strong>{info.creator_nickname ?? tiktok.account ?? "your TikTok account"}</strong></p>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Who can see this video</span>
            <select name="tt_privacy" required defaultValue="" className="h-8 rounded border border-line bg-paper px-2">
              <option value="" disabled>Choose…</option>
              {info.privacy_level_options.map((o) => <option key={o} value={o}>{PRIVACY[o] ?? o}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" name="tt_comment" disabled={info.comment_disabled} /> Allow comments</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="tt_duet" disabled={info.duet_disabled} /> Duet</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="tt_stitch" disabled={info.stitch_disabled} /> Stitch</label>
          </div>
          <label className="flex items-center gap-1"><input type="checkbox" name="tt_brand" /> Promotes our own brand (Back)</label>
          <p className="text-muted">Marked as AI-generated (the voice is synthesized). By posting, you agree to TikTok&apos;s Music Usage Confirmation.</p>
        </>
      ) : (
        <>
          <input type="hidden" name="tt_mode" value="inbox" />
          <p className="text-muted">
            At its time the video goes to {tiktok.account ?? "your TikTok account"}&apos;s TikTok inbox as a draft. Open TikTok, tap the notification, paste the caption, choose who can see it and post.
          </p>
        </>
      )}
    </fieldset>
  );
}
