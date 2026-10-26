"use client";

import { useActionState, useState } from "react";
import { approveThreadsPostAction, rejectThreadsPostAction } from "@/app/actions/threads-studio";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { FORMAT_LABEL } from "@/domain/threads-studio";
import type { ActionResult } from "@/lib/action-result";

/** One draft: the exact text that will be posted, editable, with a live length count and one-click approve. */
export function DraftCard({ slug, id, text, format, topic, source, why, blocked }: {
  slug: string;
  id: string;
  text: string;
  format: string;
  topic: string;
  source: { title: string | null; url: string | null; kind: string };
  why: string;
  blocked: string | null;
}) {
  const [value, setValue] = useState(text);
  const [approveState, approve, approving] = useActionState<ActionResult | null, FormData>(approveThreadsPostAction.bind(null, slug, id), null);
  const [rejectState, reject, rejecting] = useActionState<ActionResult | null>(rejectThreadsPostAction.bind(null, slug, id), null);
  const len = value.trim().length;
  const done = approveState?.ok || rejectState?.ok;
  return (
    <article className={cn("flex flex-col rounded-[10px] border bg-surface transition-colors", blocked ? "border-red/40" : "border-line hover:border-green/35", done && "opacity-60")}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[12px]">
        <span className="rounded-[4px] bg-night px-1.5 py-0.5 font-medium text-mint">{FORMAT_LABEL[format] ?? format}</span>
        <span className="text-muted">{topic}</span>
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer noopener" className="ml-auto max-w-[50%] truncate text-faint underline underline-offset-2 hover:text-green" title={source.title ?? source.url}>
            {source.kind === "article" ? "From our article" : "Source"}: {source.title ?? hostOf(source.url)}
          </a>
        ) : null}
      </header>
      <form action={approve} className="flex flex-1 flex-col gap-3 p-4">
        <label className="sr-only" htmlFor={`t-${id}`}>Post text</label>
        <textarea
          id={`t-${id}`}
          name="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={Math.min(12, Math.max(5, value.split("\n").length + 2))}
          className="w-full resize-y rounded-[6px] border border-transparent bg-paper/60 px-3 py-2.5 text-[15px] leading-[1.55] text-ink outline-none focus:border-line-strong focus:bg-surface"
        />
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <span className="text-muted">{why}</span>
          <span className={cn("num shrink-0", len > 500 ? "font-semibold text-red" : len > 450 ? "text-amber" : "text-faint")}>{len} / 500</span>
        </div>
        {blocked ? <p className="rounded-[6px] bg-red-tint px-3 py-2 text-[13px] text-red">Stopped by the safety rules: {blocked} Edit the text and approve again.</p> : null}
        <FormMessage state={approveState ?? rejectState} />
        {!done ? (
          <div className="mt-auto flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={approving || len === 0 || len > 500}>
              {approving ? "Approving…" : value.trim() !== text.trim() ? "Save and approve" : "Approve"}
            </Button>
            <Button type="submit" formAction={reject} variant="ghost" disabled={rejecting}>
              {rejecting ? "Removing…" : "Remove"}
            </Button>
          </div>
        ) : null}
      </form>
    </article>
  );
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
