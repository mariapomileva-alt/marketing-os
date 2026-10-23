import { approveYtDraftAction, logYtReplyAction, postYtNowAction, rejectYtDraftAction } from "@/app/actions/youtube";
import { markReplyPostedAction } from "@/app/actions/conversations";
import { CopyButton } from "@/components/content/copy-button";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { DataFlag, Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

export type Msg = {
  id: string;
  direction: string;
  author_handle: string | null;
  text: string;
  status: string;
  variant: string | null;
  kind: string | null;
  occurred_at: string | null;
  like_count: number | null;
  reply_count: number | null;
  voice: { problems?: string[]; warnings?: string[]; guardrailBlocks?: string[] } | null;
};
export type Thread = {
  id: string;
  subject: string | null;
  thread_url: string | null;
  external_thread_id: string | null;
  risk: string;
  risk_reason: string | null;
  status: string;
  created_at: string;
  messages: Msg[];
};

const VARIANT: Record<string, string> = { helpful: "Helpful, no product", with_mention: "Mentions the product openly", reply: "Answer", safety: "Safety note (no product)" };
const KIND: Record<string, string> = { thanks: "says thanks", question_about_back: "asks about the app", criticism: "is sceptical", personal_story: "shares their story", question: "asks a question" };

/** Splits threads by what they need from the owner. A YouTube thread is one level deep: our comment, then replies. */
export function groupThreads(threads: Thread[]) {
  const live: Thread[] = [];
  const fresh: Thread[] = [];
  const posted: Thread[] = [];
  const quiet: Thread[] = [];
  for (const t of threads) {
    const hasReplies = t.messages.some((m) => m.direction === "inbound");
    const open = t.messages.some((m) => m.direction === "outbound" && (m.status === "draft" || m.status === "approved"));
    const isPosted = t.messages.some((m) => m.direction === "outbound" && m.status === "posted");
    if (hasReplies) live.push(t);
    else if (open) fresh.push(t);
    else if (isPosted) posted.push(t);
    else quiet.push(t);
  }
  return { live, fresh, posted, quiet };
}

function Initial({ name, ours }: { name: string; ours?: boolean }) {
  const letter = (name.replace(/^@/, "")[0] ?? "?").toUpperCase();
  return (
    <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${ours ? "bg-green text-white" : "bg-slate-tint text-slate"}`}>
      {letter}
    </span>
  );
}

function VoiceNotes({ m }: { m: Msg }) {
  if (!m.voice) return null;
  const blocks = [...(m.voice.guardrailBlocks ?? []), ...(m.voice.problems ?? [])];
  const warnings = m.status === "draft" ? (m.voice.warnings ?? []) : [];
  if (!blocks.length && !warnings.length) return null;
  return (
    <ul className="mt-1 text-[12px] text-muted">
      {blocks.map((p) => <li key={p} className="text-red">{p}</li>)}
      {warnings.map((p) => <li key={p}>{p}</li>)}
    </ul>
  );
}

function Draft({ slug, m, canPost }: { slug: string; m: Msg; canPost: boolean }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-green/50 bg-green-soft/40 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span>Draft · {VARIANT[m.variant ?? "reply"] ?? "Draft"}</span>
        {m.text.startsWith("[MOCK]") ? <DataFlag kind="mock" /> : null}
      </div>
      <ActionForm action={approveYtDraftAction.bind(null, slug, m.id)} submitLabel="Approve" pendingLabel="Checking…" submitVariant="primary" className="flex flex-col gap-2">
        <Textarea name="text" rows={3} defaultValue={m.text} aria-label="Draft text, edit before approving" />
      </ActionForm>
      <form action={rejectYtDraftAction.bind(null, slug, m.id)} className="mt-1"><Button size="sm" variant="ghost">Reject</Button></form>
      <VoiceNotes m={m} />
    </div>
  );
}

function Approved({ slug, m, t, canPost, queue }: { slug: string; m: Msg; t: Thread; canPost: boolean; queue: boolean }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Status tone="amber">{canPost && queue ? "approved, in the queue" : "approved, not posted yet"}</Status>
        {canPost && queue ? <span>Goes out on its own: one every 10 minutes, 8:00–23:00. Nothing to press.</span> : null}
      </div>
      <p className="whitespace-pre-wrap text-[13.5px]">{m.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canPost ? <ActionForm action={postYtNowAction.bind(null, slug, m.id)} submitLabel="Post now" pendingLabel="Posting…" submitVariant="primary" className="flex flex-col gap-1"><span /></ActionForm> : null}
        <CopyButton text={m.text} />
        {t.thread_url ? <a href={t.thread_url} target="_blank" rel="noreferrer noopener" className="inline-flex h-7 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-2.5 text-[13px]">Open the post</a> : null}
        <form action={markReplyPostedAction.bind(null, slug, m.id)}><Button size="sm" variant="ghost">I posted it myself</Button></form>
      </div>
    </div>
  );
}

function Bubble({ m, ours, brand }: { m: Msg; ours: boolean; brand: string }) {
  const name = ours ? brand : (m.author_handle ?? "Someone");
  return (
    <div className="flex gap-2.5">
      <Initial name={name} ours={ours} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="font-medium text-ink">{name}</span>
          {ours ? <span>your channel</span> : m.kind && KIND[m.kind] ? <span>{KIND[m.kind]}</span> : null}
          {m.occurred_at ? <span>{formatDateTime(m.occurred_at)}</span> : null}
          {m.text.startsWith("[MOCK]") ? <DataFlag kind="mock" /> : null}
        </div>
        <p className={`mt-0.5 inline-block max-w-[62ch] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed ${ours ? "rounded-tl-sm bg-green-soft" : "rounded-tl-sm bg-paper"}`}>{m.text}</p>
        {ours && m.like_count !== null ? (
          <p className="mt-1 text-[12px] text-muted">
            {m.like_count} like{m.like_count === 1 ? "" : "s"}{m.reply_count !== null ? `, ${m.reply_count} repl${m.reply_count === 1 ? "y" : "ies"}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadCard({ slug, t, canPost, brand, connected, queue = false }: { slug: string; t: Thread; canPost: boolean; brand: string; connected: boolean; queue?: boolean }) {
  const visible = t.messages.filter((m) => !(m.direction === "outbound" && m.status === "rejected"));
  const heldBack = t.messages.filter((m) => m.direction === "outbound" && m.status === "rejected");
  // The first thing we said (posted or not) is the top of the branch; everything after it is the reply line.
  const top = visible.filter((m) => m.direction === "outbound" && m.variant !== "reply" && m.variant !== "safety");
  const rest = visible.filter((m) => !top.includes(m));
  const render = (m: Msg) =>
    m.direction === "inbound" ? <Bubble key={m.id} m={m} ours={false} brand={brand} />
    : m.status === "draft" ? <Draft key={m.id} slug={slug} m={m} canPost={canPost} />
    : m.status === "approved" ? <Approved key={m.id} slug={slug} m={m} t={t} canPost={canPost} queue={queue} />
    : <Bubble key={m.id} m={m} ours brand={brand} />;
  return (
    <li className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${t.risk === "high" ? "border-red/50" : "border-line"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
        <span className="min-w-0">
          {t.thread_url ? <a href={t.thread_url} target="_blank" rel="noreferrer noopener" className="font-medium text-ink underline underline-offset-2">{t.subject ?? "Open"}</a> : <span className="font-medium text-ink">{t.subject}</span>}
          <span className="ml-2">{formatDateTime(t.created_at)}</span>
        </span>
        {t.risk === "high" ? <Status tone="red">High risk</Status> : t.risk === "medium" ? <Status tone="amber">Careful</Status> : null}
      </div>
      {t.risk === "high" ? (
        <p className="mb-3 rounded-[var(--radius-control)] bg-red-tint px-3 py-2 text-[12.5px] text-red">
          {t.risk_reason ?? "This person may need urgent help."} Answer as a person, briefly and kindly, or not at all. Never mention the product here.
        </p>
      ) : null}
      <div className="flex flex-col gap-3">{top.map(render)}</div>
      {rest.length ? <div className="ml-3.5 mt-3 flex flex-col gap-3 border-l-2 border-line pl-4">{rest.map(render)}</div> : null}
      {heldBack.length ? (
        <details className="mt-3 text-[12.5px] text-muted">
          <summary className="cursor-pointer">{heldBack.length} draft{heldBack.length === 1 ? "" : "s"} not used</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {heldBack.map((m) => <li key={m.id}><p className="whitespace-pre-wrap line-through decoration-faint">{m.text}</p><VoiceNotes m={m} /></li>)}
          </ul>
        </details>
      ) : null}
      {!connected || !t.external_thread_id ? (
        <details className="mt-3 text-[12.5px]">
          <summary className="cursor-pointer text-muted">Someone replied and it is not here? Paste it</summary>
          <ActionForm action={logYtReplyAction.bind(null, slug, t.id)} submitLabel="Draft an answer" pendingLabel="Reading the thread…" submitVariant="secondary" resetOnSuccess className="mt-2 grid gap-2 md:grid-cols-[180px_1fr]">
            <Input name="author" aria-label="Who wrote" placeholder="@name" />
            <Textarea name="text" rows={2} aria-label="Their reply" placeholder="What they wrote under our comment" />
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}
