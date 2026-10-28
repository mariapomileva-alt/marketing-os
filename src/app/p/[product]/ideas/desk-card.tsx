"use client";

import { useActionState, useState } from "react";
import { approveDeskAction, rejectDeskAction, rerenderReelAction } from "@/app/actions/content-desk";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/action-result";

const KIND: Record<string, string> = { post: "Instagram post", carousel: "Instagram carousel", article: "Article idea", reel: "Instagram Reel" };
const SHOTS: Record<string, string> = {
  home: "Home: the six tools", breathe: "Breathe: the circle", try_another: "“Breathing feels uncomfortable” → try another", ground: "Ground: feet on the floor",
  listen: "Listen: soft rain", move: "Move: curl your fingers", read: "Read: calm lines", distract: "Distract: simple games", call_person: "Call my person",
};
export type ReelData = { format?: string; music?: string; intro_style: "dark" | "light"; intro_lines: string[]; scenes: Array<{ shot: string; caption: string }>; text_lines?: string[] };
const MECH: Record<string, string> = {
  question: "question", statement: "statement", micro_step: "small step", story: "story", myth: "myth", number: "number",
  curiosity: "curiosity gap", contrarian: "contrarian", in_scene: "in the moment", identity: "callout", relatable: "relatable", save_tool: "save-worthy tool",
};
const FORMATS: Record<string, string> = { scenes: "App scenes", read_slowly: "Read this slowly (calm lines)", breathe_along: "Breathe along (circle)" };
const MUSIC: Record<string, string> = { warm: "Warm", night: "Night", airy: "Airy", piano: "Soft piano" };

export type DeskCardData = {
  id: string; kind: "post" | "carousel" | "article" | "reel"; topic: string; insight: string; why_now: string;
  sources: Array<{ title: string; url: string | null }>; hooks: Array<{ text: string; mechanism: string }>; chosen_hook: number;
  caption: string; slides: Array<{ title: string; text: string }>; brief: string; images: string[]; render_error: string | null; blocked: string | null;
  reel: ReelData | null; video: string | null; render_status: string | null;
  share_reason?: string; borrowed_mechanism?: string;
};

/** One piece on the desk: the research behind it, the hooks to choose from, the exact cards and caption, approve. */
export function DeskCard({ slug, d }: { slug: string; d: DeskCardData }) {
  const [approveState, approve, approving] = useActionState<ActionResult | null, FormData>(approveDeskAction.bind(null, slug, d.id), null);
  const [rejectState, reject, rejecting] = useActionState<ActionResult | null>(rejectDeskAction.bind(null, slug, d.id), null);
  const [hook, setHook] = useState(d.chosen_hook);
  const done = approveState?.ok || rejectState?.ok;
  const article = d.kind === "article";
  const reel = d.kind === "reel";
  const [rerenderState, rerender, rerendering] = useActionState<ActionResult | null, FormData>(rerenderReelAction.bind(null, slug, d.id), null);
  return (
    <article className={cn("flex flex-col overflow-hidden rounded-[10px] border bg-surface", d.blocked ? "border-red/40" : "border-line", done && "opacity-60")}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[12px]">
        <span className="rounded-[4px] bg-night px-1.5 py-0.5 font-medium text-mint">{KIND[d.kind]}</span>
        <span className="text-muted">{d.topic}</span>
        {reel && d.reel ? <span className="ml-auto text-faint">{FORMATS[d.reel.format ?? "scenes"]} · {MUSIC[d.reel.music ?? "warm"]} music</span> : null}
      </header>

      {reel ? (
        d.video ? (
          <div className="flex justify-center bg-paper p-3">
            <video src={d.video} controls playsInline preload="metadata" className="h-[420px] w-auto rounded-[8px] border border-line bg-ink" />
          </div>
        ) : (
          <p className="bg-paper px-4 py-6 text-[13px] text-muted">
            {d.render_status === "failed" ? <span className="text-red">The Reel could not be made{d.render_error ? `: ${d.render_error}` : ""}. Change the text below to try again.</span> : "The Reel is being made by the renderer (it runs every two hours). It appears here to watch before you approve."}
          </p>
        )
      ) : !article ? (
        d.images.length ? (
          <div className="flex snap-x gap-2 overflow-x-auto bg-paper p-3">
            {d.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- private, already-sized JPEG cards
              <img key={src} src={src} alt={`Card ${i + 1} of ${d.images.length}`} loading="lazy" className="h-[260px] w-auto shrink-0 snap-start rounded-[6px] border border-line" />
            ))}
          </div>
        ) : <p className="bg-paper px-4 py-6 text-[13px] text-red">The cards were not drawn{d.render_error ? `: ${d.render_error}` : ""}. Approve again to retry.</p>
      ) : null}

      <form action={approve} className="flex flex-1 flex-col gap-3 p-4 text-[13px]">
        <div className="rounded-[6px] bg-paper/70 px-3 py-2">
          <p><span className="font-medium">What we found: </span>{d.insight}</p>
          {d.why_now ? <p className="mt-1 text-muted"><span className="font-medium text-ink">Why now: </span>{d.why_now}</p> : null}
          {d.sources.length ? (
            <p className="mt-1 text-[12px] text-faint">
              {d.sources.map((s, i) => (
                <span key={i}>{i ? " · " : ""}{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-green">{s.title}</a> : s.title}</span>
              ))}
            </p>
          ) : null}
          {d.borrowed_mechanism ? <p className="mt-1 text-muted"><span className="font-medium text-ink">What it borrows: </span>{d.borrowed_mechanism}</p> : null}
          {d.share_reason ? <p className="mt-1 text-muted"><span className="font-medium text-ink">Who sends it: </span>{d.share_reason}</p> : null}
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[12px] text-muted">{article ? "Title" : reel ? "Hook (the opening card; another hook makes the Reel again)" : "Hook (the first card)"}</legend>
          {d.hooks.map((h, i) => (
            <label key={i} className={cn("flex cursor-pointer items-start gap-2 rounded-[6px] border px-2.5 py-2", hook === i ? "border-green/50 bg-green/5" : "border-line")}>
              <input type="radio" name="hook" value={i} checked={hook === i} onChange={() => setHook(i)} className="mt-[3px] accent-[var(--green)]" />
              <span className="flex-1">{h.text}</span>
              <span className="shrink-0 text-[11px] text-faint">{MECH[h.mechanism] ?? h.mechanism}</span>
            </label>
          ))}
        </fieldset>

        {article ? (
          <pre className="whitespace-pre-wrap rounded-[6px] bg-paper/70 px-3 py-2 font-sans text-[13px] leading-[1.5]">{d.brief}</pre>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Caption (exactly what Instagram gets)</span>
              <textarea name="caption" defaultValue={d.caption} rows={6} maxLength={2200} className="w-full resize-y rounded-[6px] border border-line bg-paper/60 px-3 py-2 text-[13px] leading-[1.5] outline-none focus:border-line-strong" />
            </label>
            {reel ? null : <details className="rounded-[6px] border border-line px-3 py-2">
              <summary className="cursor-pointer text-[12px] text-muted">Edit the text on the cards</summary>
              <div className="mt-2 flex flex-col gap-2">
                {d.slides.map((s, i) => (
                  <div key={i} className="grid gap-1">
                    <input key={i === 0 ? `h${hook}` : i} name={`slide_title_${i}`} defaultValue={i === 0 ? d.hooks[hook]?.text ?? s.title : s.title} aria-label={`Card ${i + 1} title`} className="rounded border border-line bg-paper px-2 py-1 text-[13px]" />
                    {i > 0 ? <input name={`slide_text_${i}`} defaultValue={s.text} aria-label={`Card ${i + 1} text`} className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-muted" /> : <input type="hidden" name={`slide_text_${i}`} value={s.text} />}
                  </div>
                ))}
                <p className="text-[11px] text-faint">Changed cards are redrawn and checked again when you approve.</p>
              </div>
            </details>}
          </>
        )}

        {reel && d.reel ? (
          <details className="rounded-[6px] border border-line px-3 py-2">
            <summary className="cursor-pointer text-[12px] text-muted">Change what is on screen and make it again</summary>
            <div className="mt-2 grid gap-2 text-[12px]">
              <label className="grid gap-1">Opening lines (one per line, short)
                <textarea form={`rr-${d.id}`} name="intro_lines" defaultValue={d.reel.intro_lines.join("\n")} rows={3} className="rounded border border-line bg-paper px-2 py-1" />
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2">Format
                  <select form={`rr-${d.id}`} name="format" defaultValue={d.reel.format ?? "scenes"} className="rounded border border-line bg-paper px-2 py-1">{Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </label>
                <label className="flex items-center gap-2">Music
                  <select form={`rr-${d.id}`} name="music" defaultValue={d.reel.music ?? "warm"} className="rounded border border-line bg-paper px-2 py-1">{Object.entries(MUSIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </label>
                <label className="flex items-center gap-2">Opening card
                  <select form={`rr-${d.id}`} name="intro_style" defaultValue={d.reel.intro_style} className="rounded border border-line bg-paper px-2 py-1"><option value="dark">Dark green</option><option value="light">Light</option></select>
                </label>
              </div>
              <label className="grid gap-1">Calm lines (read slowly: 3–8; breathe along: up to 3, one per breath)
                <textarea form={`rr-${d.id}`} name="text_lines" defaultValue={(d.reel.text_lines ?? []).join("\n")} rows={3} className="rounded border border-line bg-paper px-2 py-1" />
              </label>
              <p className="text-faint">App scenes (used by the App scenes format):</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-1 sm:grid-cols-[200px_1fr]">
                  <select form={`rr-${d.id}`} name={`shot_${i}`} defaultValue={d.reel!.scenes[i]?.shot ?? ""} className="rounded border border-line bg-paper px-2 py-1">
                    <option value="">{i < 2 ? "Choose a scene" : "No third scene"}</option>
                    {Object.entries(SHOTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input form={`rr-${d.id}`} name={`scene_caption_${i}`} defaultValue={d.reel!.scenes[i]?.caption ?? ""} maxLength={48} placeholder="Caption for this scene" className="rounded border border-line bg-paper px-2 py-1" />
                </div>
              ))}
              <Button type="submit" form={`rr-${d.id}`} variant="secondary" disabled={rerendering}>{rerendering ? "Saving…" : "Save and make again"}</Button>
              <FormMessage state={rerenderState} />
            </div>
          </details>
        ) : null}
        {d.blocked ? <p className="rounded-[6px] bg-red-tint px-3 py-2 text-red">Stopped by the safety rules: {d.blocked} Edit and approve again.</p> : null}
        <FormMessage state={approveState ?? rejectState} />
        {!done ? (
          <div className="mt-auto flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={approving}>{approving ? "Approving…" : article ? "Approve idea" : reel && !d.video ? "Approve when ready" : "Approve"}</Button>
            <Button type="submit" formAction={reject} variant="ghost" disabled={rejecting}>{rejecting ? "Removing…" : "Remove"}</Button>
            {article ? <CopyBrief text={`${d.hooks[hook]?.text ?? ""}\n\n${d.brief}`} /> : null}
          </div>
        ) : null}
      </form>
      {reel ? <form id={`rr-${d.id}`} action={rerender} className="hidden" /> : null}
    </article>
  );
}

function CopyBrief({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))} className="ml-auto text-[12px] underline underline-offset-2 hover:text-green">
      {copied ? "Copied" : "Copy brief"}
    </button>
  );
}
