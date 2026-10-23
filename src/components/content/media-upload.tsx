"use client";

import { useRef, useState } from "react";
import { finishMediaUploadAction, startMediaUploadAction } from "@/app/actions/creatives";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

/** Uploads a video, music file or large image straight to private storage, then records it in the library. */
export function MediaUpload({ slug }: { slug: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<{ busy: boolean; message: string | null; ok: boolean }>({ busy: false, message: null, ok: false });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return setState({ busy: false, ok: false, message: "Choose a file." });
    setState({ busy: true, ok: false, message: "Uploading…" });
    const meta = { name: file.name, type: file.type, size: file.size };
    const start = await startMediaUploadAction(slug, meta);
    if (!start.url || !start.key) return setState({ busy: false, ok: false, message: start.error ?? "Upload could not start." });
    const res = await fetch(start.url, { method: "PUT", body: file, headers: { "content-type": file.type, "x-upsert": "false" } });
    if (!res.ok) return setState({ busy: false, ok: false, message: `Upload failed (${res.status}). Try again.` });
    const done = await finishMediaUploadAction(slug, start.key, { ...meta, title: String(data.get("title") ?? ""), tags: String(data.get("tags") ?? ""), rights_note: String(data.get("rights_note") ?? "") });
    setState({ busy: false, ok: done.ok, message: done.message });
    if (done.ok) form.current?.reset();
  }
  return (
    <form ref={form} onSubmit={submit} className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
      <Field label="File" htmlFor="mu-file" hint="Video MP4/MOV/WebM up to 50 MB, music MP3/M4A/WAV up to 30 MB.">
        <Input id="mu-file" name="file" type="file" accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,image/png,image/jpeg,image/webp" required className="h-auto py-1.5" />
      </Field>
      <Field label="Title" htmlFor="mu-title"><Input id="mu-title" name="title" /></Field>
      <Field label="Tags" htmlFor="mu-tags" hint="For calm videos: calm, plus the nature: river, forest, clouds, rain, ocean, snow, lake, meadow"><Input id="mu-tags" name="tags" placeholder="calm, river" /></Field>
      <Field label="Source and rights" htmlFor="mu-rights" className="md:col-span-2" hint="e.g. filmed by us; Pexels licence; music from YouTube Audio Library (no attribution)"><Input id="mu-rights" name="rights_note" required /></Field>
      <div className="flex flex-col justify-end gap-2">
        <Button type="submit" variant="primary" disabled={state.busy}>{state.busy ? "Uploading…" : "Upload"}</Button>
      </div>
      {state.message ? <p className={`text-[13px] md:col-span-3 ${state.ok ? "text-green" : state.busy ? "text-muted" : "text-red"}`} role="status">{state.message}</p> : null}
    </form>
  );
}
