import type { ContentBody } from "@/domain/ai/schemas";
import { Field, Input, Textarea } from "@/components/ui/form";

/** Format-aware editor fields (server-rendered; submitted with the edit action). */
export function ContentFields({ format, body, visualConcept }: { format: string; body: ContentBody; visualConcept: string }) {
  return (
    <>
      {format === "carousel" ? (
        <>
          {[...(body.slides ?? []), { title: "", text: "" }].map((s, i) => (
            <div key={i} className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-[1fr_2fr]">
              <Field label={`Slide ${i + 1} title`} htmlFor={`st-${i}`}><Input id={`st-${i}`} name="slide_title" defaultValue={s.title} /></Field>
              <Field label="Text" htmlFor={`sx-${i}`}><Textarea id={`sx-${i}`} name="slide_text" rows={2} defaultValue={s.text} /></Field>
            </div>
          ))}
          <Field label="Caption" htmlFor="caption"><Textarea id="caption" name="caption" rows={4} defaultValue={body.caption ?? ""} /></Field>
        </>
      ) : format === "reels_script" ? (
        <>
          <Field label="Hook" htmlFor="hook"><Input id="hook" name="hook" defaultValue={body.hook ?? ""} /></Field>
          {[...(body.script ?? []), { timecode: "", line: "", visual: "" }].map((l, i) => (
            <div key={i} className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-[110px_1fr_1fr]">
              <Field label="Time" htmlFor={`tc-${i}`}><Input id={`tc-${i}`} name="line_timecode" defaultValue={l.timecode} placeholder="00:00–00:03" /></Field>
              <Field label="Line" htmlFor={`ln-${i}`}><Textarea id={`ln-${i}`} name="line_text" rows={2} defaultValue={l.line} /></Field>
              <Field label="Visual" htmlFor={`vi-${i}`}><Textarea id={`vi-${i}`} name="line_visual" rows={2} defaultValue={l.visual} /></Field>
            </div>
          ))}
          <Field label="Caption" htmlFor="caption"><Textarea id="caption" name="caption" rows={3} defaultValue={body.caption ?? ""} /></Field>
        </>
      ) : format === "helpful_comment" ? (
        <Field label="Comment" htmlFor="comment" hint="Helpful first. Mention the product only if it is genuinely relevant."><Textarea id="comment" name="comment" rows={4} defaultValue={body.comment ?? ""} /></Field>
      ) : format === "caption" ? (
        <Field label="Caption" htmlFor="caption"><Textarea id="caption" name="caption" rows={7} defaultValue={body.caption ?? ""} /></Field>
      ) : (
        <>
          <Field label="Hook" htmlFor="hook"><Input id="hook" name="hook" defaultValue={body.hook ?? ""} /></Field>
          <Field label="Body" htmlFor="body"><Textarea id="body" name="body" rows={6} defaultValue={body.body ?? ""} /></Field>
          <Field label="Call to action" htmlFor="cta"><Input id="cta" name="cta" defaultValue={body.cta ?? ""} /></Field>
        </>
      )}
      <Field label="Visual concept" htmlFor="visual_concept"><Textarea id="visual_concept" name="visual_concept" rows={2} defaultValue={visualConcept} /></Field>
      <Field label="What did you change and why" htmlFor="edit_note"><Input id="edit_note" name="edit_note" /></Field>
    </>
  );
}
