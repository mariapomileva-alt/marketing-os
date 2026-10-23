import { approveAllShortsAction, approveShortAction, rejectShortAction, selectShortsAction } from "@/app/actions/calm";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

export type ShortRow = {
  id: string; video_id: string; idx: number; title: string; line_from: number; line_to: number; targets: string[]; status: string; error: string | null;
  youtube_video_id: string | null; instagram_status: string | null; preview_asset_id: string | null; publish_at: string | null;
};

const LABEL: Record<string, string> = {
  planned: "not made yet", ready_to_render: "waiting for the renderer", rendering: "rendering", review: "ready to watch", scheduled: "scheduled", published: "published", rejected: "rejected", failed: "failed",
};

/** Shorts and Reels cut from one calm video: tick where each should go, then watch and approve each one. */
export function ShortsBlock({ slug, videoId, lines, shorts, youtube, instagram }: { slug: string; videoId: string; lines: Array<{ text: string }>; shorts: ShortRow[]; youtube: boolean; instagram: boolean }) {
  if (!shorts.length) return null;
  const planned = shorts.filter((s) => ["planned", "failed", "rejected"].includes(s.status));
  const made = shorts.filter((s) => !["planned", "failed", "rejected"].includes(s.status));
  return (
    <details className="mt-3 rounded-[var(--radius-panel)] border border-line p-3 text-[13px]" open={made.some((s) => s.status === "review")}>
      <summary className="cursor-pointer font-medium">Shorts and Reels from this video ({shorts.length}) {made.length ? <span className="font-normal text-muted">· {made.length} made</span> : null}</summary>
      <p className="mt-2 text-muted">Each is 30–60 seconds, vertical, with the same voice and nature. Tick where it should go; TikTok: download the file once it is made and post it there.</p>

      {made.filter((s) => s.status === "review").length > 1 ? (
        <ActionForm action={approveAllShortsAction.bind(null, slug, videoId)} submitLabel={`Approve all ${made.filter((s) => s.status === "review").length} ready shorts`} pendingLabel="Scheduling…" className="mt-3 flex flex-col gap-1"><span /></ActionForm>
      ) : null}
      {made.length ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {made.map((s) => (
            <li key={s.id} className="rounded-[var(--radius-panel)] border border-line bg-paper p-2">
              {s.preview_asset_id ? <video src={`/p/${slug}/creatives/${s.preview_asset_id}`} controls preload="metadata" playsInline className="aspect-[9/16] w-full rounded bg-ink object-cover" /> : <div className="grid aspect-[9/16] w-full place-items-center rounded bg-sage-tint text-muted">{LABEL[s.status]}</div>}
              <p className="mt-2 line-clamp-2 font-medium">{s.idx}. {s.title}</p>
              <p className="text-[12px] text-muted">{s.targets.map((t) => (t === "youtube" ? "YouTube Shorts" : "Instagram Reels")).join(" + ")}</p>
              <div className="mt-1"><Status tone={s.status === "failed" ? "red" : ["scheduled", "published"].includes(s.status) ? "green" : "amber"}>{s.status === "scheduled" && s.publish_at ? `scheduled ${formatDateTime(s.publish_at)}` : LABEL[s.status]}</Status>{s.instagram_status === "failed" ? <Status tone="red">Instagram failed</Status> : null}</div>
              {s.error ? <p className="mt-1 text-[12px] text-red">{s.error}</p> : null}
              {s.status === "review" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ActionForm action={approveShortAction.bind(null, slug, s.id)} submitLabel="Approve" pendingLabel="Scheduling…" className="flex flex-col gap-1"><span /></ActionForm>
                  <form action={rejectShortAction.bind(null, slug, s.id)}><Button size="sm" variant="ghost">Reject</Button></form>
                </div>
              ) : null}
              {s.preview_asset_id ? <a href={`/p/${slug}/creatives/${s.preview_asset_id}`} download className="mt-1 inline-block text-[12px] underline">Download for TikTok</a> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {planned.length ? (
        <ActionForm action={selectShortsAction.bind(null, slug, videoId)} submitLabel="Make the ticked shorts" pendingLabel="Queuing…" className="mt-3 flex flex-col gap-2">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Starts with</th><th className="py-1 pr-2">YouTube</th><th className="py-1">Instagram</th></tr></thead>
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
                  <td className="py-1.5"><input type="checkbox" name={`ig_${s.id}`} aria-label={`Short ${s.idx} on Instagram`} disabled={!instagram} defaultChecked={s.targets.includes("instagram")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!instagram ? <p className="text-[12px] text-muted">Instagram Reels: connect Instagram in Connections (with the publishing permission) to tick them.</p> : null}
        </ActionForm>
      ) : null}
    </details>
  );
}
