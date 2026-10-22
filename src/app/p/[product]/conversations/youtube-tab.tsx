import Link from "next/link";
import type { Tx } from "@/server/db/client";
import { getYtSettings } from "@/server/services/youtube";
import { logYtReplyAction, runYtDiscoveryAction, saveYtSettingsAction } from "@/app/actions/youtube";
import { markReplyPostedAction } from "@/app/actions/conversations";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState, KeyValue, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { DataFlag } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

type Msg = { id: string; direction: string; author_handle: string | null; text: string; status: string; variant: string | null; kind: string | null; voice: { problems?: string[]; warnings?: string[]; guardrailBlocks?: string[] } | null };

export async function loadYoutube(tx: Tx, workspaceId: string, productId: string) {
  return {
    settings: await getYtSettings(tx, workspaceId, productId),
    videos: await tx.query<{ id: string; title: string; url: string; channel_title: string; relevance: number; status: string; reason: string; found_at: string; is_demo: boolean }>(
      "select id, title, url, channel_title, relevance, status, reason, found_at::text, is_demo from yt_videos where product_id = $1 order by found_at desc, relevance desc limit 60",
      [productId],
    ),
    threads: await tx.query<{ id: string; subject: string | null; thread_url: string | null; risk: string; risk_reason: string | null; status: string; created_at: string; messages: Msg[] }>(
      `select c.id, c.subject, c.thread_url, c.risk, c.risk_reason, c.status, c.created_at::text,
              coalesce((select json_agg(json_build_object('id', m.id, 'direction', m.direction, 'author_handle', m.author_handle, 'text', m.text, 'status', m.status,
                                                          'variant', m.variant, 'kind', m.kind, 'voice', m.voice) order by m.occurred_at, m.created_at)
                          from conversation_messages m where m.conversation_id = c.id), '[]') messages
         from conversations c where c.product_id = $1 and c.channel = 'youtube'
        order by (c.risk = 'high') desc, c.created_at desc limit 40`,
      [productId],
    ),
  };
}

const VARIANT: Record<string, string> = { helpful: "Helpful, no product", with_mention: "Mentions the product openly", reply: "Reply", safety: "Safety note (no product)" };

export function YoutubeTab({ slug, data }: { slug: string; data: Awaited<ReturnType<typeof loadYoutube>> }) {
  const s = data.settings;
  const apiKey = Boolean(process.env.YOUTUBE_API_KEY);
  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const publishing = process.env.YOUTUBE_PUBLISHING_ENABLED === "true";
  return (
    <>
      <Section
        title="How it works"
        description="Once a day the agent looks for fresh YouTube videos about panic in the moment, skips the ones where a comment from the team would be wrong, and drafts a warm, specific comment for the best few. Every comment and every reply waits for your approval. The team always says who it is and never pretends to be a viewer."
      >
        <KeyValue
          items={[
            ["Daily search", s.enabled ? <Status tone="green">On</Status> : <Status>Off</Status>],
            ["YouTube access", apiKey ? <Status tone="green">API key set (read-only)</Status> : <Status tone="amber">Not set: add YOUTUBE_API_KEY</Status>],
            ["Telegram alerts", telegram ? <Status tone="green">On</Status> : <Status tone="amber">Not set: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID</Status>],
            ["Publishing", publishing ? <Status tone="amber">On, after approval only</Status> : <Status>Off (dry run): you post approved comments from the channel yourself</Status>],
            ["Last search", s.last_run_at ? formatDateTime(s.last_run_at) : "Never"],
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionForm action={runYtDiscoveryAction.bind(null, slug, "api")} submitLabel="Find videos now" pendingLabel="Searching…" className="flex flex-col gap-2"><span /></ActionForm>
          <ActionForm action={runYtDiscoveryAction.bind(null, slug, "demo")} submitLabel="Try with demo videos" submitVariant="secondary" pendingLabel="Drafting…" className="flex flex-col gap-2"><span /></ActionForm>
        </div>
      </Section>

      <Section title="Conversations on YouTube" description="Our drafted comments, replies from people and our drafted answers. Red threads need a person first.">
        {data.threads.length ? (
          <ul className="flex flex-col gap-3">
            {data.threads.map((t) => (
              <li key={t.id} className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${t.risk === "high" ? "border-red/50" : "border-line"}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
                  <span className="min-w-0">
                    {t.thread_url ? <a href={t.thread_url} target="_blank" rel="noreferrer noopener" className="text-ink underline underline-offset-2">{t.subject ?? "Video"}</a> : t.subject}
                    {" · "}{formatDateTime(t.created_at)}
                  </span>
                  <span className="flex items-center gap-3">
                    {t.risk === "high" ? <Status tone="red">High risk</Status> : t.risk === "medium" ? <Status tone="amber">Careful</Status> : null}
                    <Status tone={t.status === "replied" ? "green" : "amber"}>{t.status.replace("_", " ")}</Status>
                  </span>
                </div>
                {t.risk === "high" ? (
                  <p className="mb-2 rounded-[var(--radius-control)] bg-red-tint px-3 py-2 text-[12.5px] text-red">
                    {t.risk_reason ?? "This person may need urgent help."} Answer as a person, briefly and kindly, or not at all. Never mention the product here.
                  </p>
                ) : null}
                <ul className="flex flex-col gap-2 text-[13.5px]">
                  {t.messages.map((m) => (
                    <li key={m.id} className={m.direction === "outbound" ? "ml-4 border-l-2 border-line pl-3" : ""}>
                      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                        <span>{m.direction === "inbound" ? (m.author_handle ?? "Someone") : `Team draft · ${VARIANT[m.variant ?? "reply"] ?? "Draft"}`}</span>
                        {m.kind && m.direction === "inbound" ? <span>· {m.kind.replaceAll("_", " ")}</span> : null}
                        {m.direction === "outbound" ? (
                          <Status tone={m.status === "posted" || m.status === "approved" ? "green" : m.status === "rejected" ? "red" : "amber"}>
                            {m.status === "draft" ? "waiting for approval" : m.status === "rejected" ? "held back" : m.status}
                          </Status>
                        ) : null}
                        {m.text.startsWith("[MOCK]") ? <DataFlag kind="mock" /> : null}
                      </div>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.voice && (m.voice.problems?.length || m.voice.guardrailBlocks?.length || m.voice.warnings?.length) ? (
                        <ul className="mt-1 text-[12px] text-muted">
                          {[...(m.voice.guardrailBlocks ?? []), ...(m.voice.problems ?? [])].map((p) => <li key={p} className="text-red">{p}</li>)}
                          {(m.voice.warnings ?? []).map((p) => <li key={p}>{p}</li>)}
                        </ul>
                      ) : null}
                      {m.direction === "outbound" && m.status === "approved" ? (
                        <form action={markReplyPostedAction.bind(null, slug, m.id)} className="mt-1"><Button size="sm" variant="ghost">I posted it from the channel</Button></form>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-[12.5px]"><Link href={`/p/${slug}/approvals`} className="text-green underline underline-offset-2">Approve drafts in the Approval Queue</Link></div>
                <ActionForm action={logYtReplyAction.bind(null, slug, t.id)} submitLabel="Draft an answer" pendingLabel="Reading the thread…" submitVariant="secondary" resetOnSuccess className="mt-3 grid gap-2 md:grid-cols-[180px_1fr]">
                  <Input name="author" aria-label="Who wrote" placeholder="@name" />
                  <Textarea name="text" rows={2} aria-label="Their reply" placeholder="Paste a reply someone wrote under our comment" />
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No YouTube conversations yet">Run a search, or try it with demo videos.</EmptyState>
        )}
      </Section>

      <Section title="Videos found" description="Every video the search returned, with the reason it was or was not picked.">
        {data.videos.length ? (
          <Table>
            <thead><tr><th>Video</th><th>Relevance</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>
              {data.videos.map((v) => (
                <tr key={v.id}>
                  <td className="min-w-[220px]">
                    <a href={v.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{v.title}</a>
                    <div className="text-[12px] text-muted">{v.channel_title}{v.is_demo ? " · demo" : ""}</div>
                  </td>
                  <td className="num">{v.relevance}</td>
                  <td><Status tone={v.status === "skipped" || v.status === "rejected" ? "neutral" : v.status === "published" ? "green" : "amber"}>{v.status}</Status></td>
                  <td className="min-w-[240px] text-muted">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No videos yet" />
        )}
      </Section>

      <Section title="Settings">
        <ActionForm action={saveYtSettingsAction.bind(null, slug)} submitLabel="Save settings" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-[13.5px] md:col-span-3">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Search once a day and prepare drafts
          </label>
          <Field label="Product name in comments" htmlFor="yt-brand" hint="How the team names it, e.g. Back"><Input id="yt-brand" name="brand_name" defaultValue={s.brand_name ?? ""} /></Field>
          <Field label="Languages" htmlFor="yt-lang" hint="Two-letter codes"><Input id="yt-lang" name="languages" defaultValue={s.languages.join(", ")} /></Field>
          <Field label="Videos from the last, days" htmlFor="yt-days"><Input id="yt-days" name="published_within_days" type="number" min={1} max={90} defaultValue={s.published_within_days} /></Field>
          <Field label="Search phrases, one per line" htmlFor="yt-q" className="md:col-span-3"><Textarea id="yt-q" name="queries" rows={6} defaultValue={s.queries.join("\n")} /></Field>
          <Field label="Skip videos shorter than, seconds" htmlFor="yt-min"><Input id="yt-min" name="min_duration_seconds" type="number" min={0} defaultValue={s.min_duration_seconds} /></Field>
          <Field label="One comment per channel every, days" htmlFor="yt-cd"><Input id="yt-cd" name="channel_cooldown_days" type="number" min={1} defaultValue={s.channel_cooldown_days} /></Field>
          <Field label="Drafts per search" htmlFor="yt-dr"><Input id="yt-dr" name="drafts_per_run" type="number" min={0} max={10} defaultValue={s.drafts_per_run} /></Field>
          <Field label="Comments per day, at most" htmlFor="yt-pl" hint="Applies when publishing is switched on"><Input id="yt-pl" name="daily_publish_limit" type="number" min={0} max={10} defaultValue={s.daily_publish_limit} /></Field>
        </ActionForm>
      </Section>
    </>
  );
}
