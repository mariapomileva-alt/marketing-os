import Link from "next/link";
import { nowMs } from "@/lib/time";
import { db, getProduct } from "@/server/context";
import { getStudioSettings, studioPosts, type StudioPost } from "@/server/services/threads-studio";
import { publishingEnabled } from "@/server/services/youtube-publish";
import { approveAllThreadsAction, generateThreadsPostsAction, refreshThreadsStatsAction, saveStudioSettingsAction } from "@/app/actions/threads-studio";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { FORMAT_LABEL, reactionRate, reactionScore } from "@/domain/threads-studio";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DraftCard } from "./draft-card";

export const metadata = { title: "Threads" };
// Writing a batch searches the web and runs the reviews: allow it time.
export const maxDuration = 300;

const TZ = "Europe/Riga";
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));

export default async function ThreadsStudioPage({ params }: PageProps<"/p/[product]/threads">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => ({
    since: nowMs() - 30 * 86_400_000,
    settings: await getStudioSettings(tx, ctx.workspaceId, product.id),
    posts: await studioPosts(tx, product.id),
    conn: await tx.maybeOne<{ status: string; account_label: string | null; paused_reason: string | null }>(
      "select status, account_label, paused_reason from channel_connections where product_id = $1 and channel = 'threads' and status <> 'revoked' order by created_at desc limit 1",
      [product.id],
    ),
  }));
  const base = `/p/${slug}`;
  const waiting = d.posts.filter((p) => p.status === "needs_human_review" || p.status === "draft" || p.status === "ai_review");
  const scheduled = d.posts.filter((p) => p.status === "scheduled" || p.status === "approved").sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
  const published = d.posts.filter((p) => p.status === "published");
  const measured = published.filter((p) => p.stats_checked_at);
  const last30 = measured.filter((p) => p.published_at && Date.parse(p.published_at) > d.since);
  const sum = (k: keyof Pick<StudioPost, "views" | "likes" | "replies" | "reposts" | "quotes">, list = last30) => list.reduce((n, p) => n + (p[k] ?? 0), 0);
  const views = sum("views");
  const reactions = sum("likes") + sum("replies") + sum("reposts") + sum("quotes");
  const best = [...measured].sort((a, b) => reactionScore(b) - reactionScore(a));
  const bestIds = new Set(best.slice(0, 3).filter((p) => reactionScore(p) > 0).map((p) => p.id));

  // What works: average results per format (measured posts only).
  const byFormat = new Map<string, { n: number; views: number; score: number; replies: number }>();
  for (const p of measured) {
    const f = byFormat.get(p.format) ?? { n: 0, views: 0, score: 0, replies: 0 };
    f.n++;
    f.views += p.views ?? 0;
    f.score += reactionScore(p);
    f.replies += p.replies ?? 0;
    byFormat.set(p.format, f);
  }
  const formats = [...byFormat.entries()].map(([format, f]) => ({ format, n: f.n, avgViews: f.views / f.n, avgScore: f.score / f.n, avgReplies: f.replies / f.n })).sort((a, b) => b.avgScore - a.avgScore);
  const maxScore = Math.max(1, ...formats.map((f) => f.avgScore));
  const live = publishingEnabled("threads");

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Threads</h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-muted">
            Our own posts, written every morning from our articles, what we know about the topic and about {product.name}. You approve each one; it goes out at the next posting time ({d.settings.slots.join(" and ")}, Riga). Reactions are read every hour.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={generateThreadsPostsAction.bind(null, slug)} submitLabel={`Write ${d.settings.posts_per_day} more`} pendingLabel="Writing and checking, about a minute…" submitVariant="secondary" className="flex items-center gap-2 [&_p]:max-w-[320px] [&_p]:text-[12px]">
            <span className="sr-only">Write new posts now</span>
          </ActionForm>
          <ActionForm action={refreshThreadsStatsAction.bind(null, slug)} submitLabel="Update reactions" pendingLabel="Reading…" submitVariant="ghost" className="flex items-center gap-2 [&_p]:max-w-[260px] [&_p]:text-[12px]">
            <span className="sr-only">Read reactions now</span>
          </ActionForm>
        </div>
      </header>

      {!d.conn ? (
        <p className="rounded-[8px] bg-amber-tint px-4 py-3 text-[13.5px] text-amber">Threads is not connected. Connect it in <Link href={`${base}/connections`} className="underline">Connections</Link>; until then approved posts wait and nothing is posted.</p>
      ) : d.conn.status !== "connected" ? (
        <p className="rounded-[8px] bg-amber-tint px-4 py-3 text-[13.5px] text-amber">Threads is paused: {d.conn.paused_reason ?? d.conn.status}. Posting resumes automatically.</p>
      ) : !live ? (
        <p className="rounded-[8px] bg-amber-tint px-4 py-3 text-[13.5px] text-amber">Automatic posting is switched off on the server (THREADS_PUBLISHING_ENABLED). Approved posts wait until it is on.</p>
      ) : null}

      {/* Instruments */}
      <section aria-label="Last 30 days" className="overflow-hidden rounded-[12px] border border-night-line bg-night text-night-ink">
        <dl className="grid grid-cols-2 gap-px bg-night-line md:grid-cols-3 xl:grid-cols-6">
          <Meter label="Posts, 30 days" value={formatNumber(last30.length)} note={`${published.length} in total`} />
          <Meter label="Views" value={formatNumber(views)} note={last30.length ? `${formatNumber(Math.round(views / last30.length))} per post` : "no posts yet"} />
          <Meter label="Reactions" value={formatNumber(reactions)} note="likes, replies, reposts, quotes" />
          <Meter label="Reaction rate" value={views ? formatPercent(reactions / views) : "—"} note="reactions per view" />
          <Meter label="Replies" value={formatNumber(sum("replies"))} note="people who answered" />
          <Meter label="Next post" value={scheduled[0]?.scheduled_for ? when(scheduled[0].scheduled_for).replace(/^\w+ /, "") : "—"} note={scheduled.length ? `${scheduled.length} scheduled` : "approve one below"} small />
        </dl>
      </section>

      {/* Waiting */}
      <section>
        <Heading
          title="Waiting for you"
          count={waiting.length}
          action={waiting.filter((p) => !p.blocked_reason).length > 1 ? (
            <ActionForm action={approveAllThreadsAction.bind(null, slug, waiting.filter((p) => !p.blocked_reason).map((p) => p.id))} submitLabel="Approve all as they are" pendingLabel="Approving…" submitVariant="secondary" className="flex items-center gap-2 [&_p]:text-[12px]">
              <span className="sr-only">Approve every waiting post without edits</span>
            </ActionForm>
          ) : null}
        />
        {waiting.length ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {waiting.map((p) => (
              <DraftCard key={p.id} slug={slug} id={p.id} text={p.text} format={p.format} topic={p.topic} why={p.why}
                source={{ title: p.source_title, url: p.source_url, kind: p.source_kind }} blocked={p.status === "draft" ? p.blocked_reason : null} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-[13.5px] text-muted">Nothing to approve. New posts arrive every morning at 7:50{d.settings.enabled ? "" : " when Threads Studio is on (settings below)"}.</p>
        )}
      </section>

      {/* Scheduled */}
      {scheduled.length ? (
        <section>
          <Heading title="Going out" count={scheduled.length} />
          <ol className="mt-4 flex flex-col divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface">
            {scheduled.map((p) => (
              <li key={p.id} className="flex gap-4 px-4 py-3">
                <span className="num w-[132px] shrink-0 text-[13px] font-medium text-green">{p.scheduled_for ? when(p.scheduled_for) : "next free time"}</span>
                <p className="line-clamp-2 min-w-0 flex-1 text-[13.5px] text-ink/90">{p.text}</p>
                <span className="shrink-0 text-[12px] text-faint">{FORMAT_LABEL[p.format] ?? p.format}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* What works */}
      <section>
        <Heading title="What works" />
        {formats.length ? (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-muted">
                    <th className="py-2 pr-4 font-normal">Kind of post</th>
                    <th className="w-[38%] py-2 pr-4 font-normal">Reactions per post</th>
                    <th className="py-2 pr-4 text-right font-normal">Views per post</th>
                    <th className="py-2 pr-4 text-right font-normal">Replies per post</th>
                    <th className="py-2 text-right font-normal">Posts</th>
                  </tr>
                </thead>
                <tbody>
                  {formats.map((f, i) => (
                    <tr key={f.format} className="border-b border-line/70">
                      <td className="py-2.5 pr-4">{FORMAT_LABEL[f.format] ?? f.format}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className={cn("h-2 rounded-full", i === 0 ? "bg-mint-deep" : "bg-sage")} style={{ width: `${Math.max(3, (f.avgScore / maxScore) * 100)}%` }} />
                          <span className="num text-[12.5px] text-muted">{f.avgScore.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="num py-2.5 pr-4 text-right">{formatNumber(Math.round(f.avgViews))}</td>
                      <td className="num py-2.5 pr-4 text-right">{f.avgReplies.toFixed(1)}</td>
                      <td className="num py-2.5 text-right text-muted">{f.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-faint">
              Reactions count a reply twice and a repost or quote three times: those spread a post furthest. {measured.length < 10 ? `Only ${measured.length} measured post(s) so far: an early signal, not a rule.` : ""} The next batch leans towards the kinds at the top and keeps one experiment.
            </p>
          </>
        ) : (
          <p className="mt-4 text-[13.5px] text-muted">Results appear here an hour after the first approved post goes out.</p>
        )}
      </section>

      {/* Published */}
      {published.length ? (
        <section>
          <Heading title="Published" count={published.length} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="py-2 pr-4 font-normal">Posted</th>
                  <th className="py-2 pr-4 font-normal">Post</th>
                  <th className="py-2 pr-3 text-right font-normal">Views</th>
                  <th className="py-2 pr-3 text-right font-normal">Likes</th>
                  <th className="py-2 pr-3 text-right font-normal">Replies</th>
                  <th className="py-2 pr-3 text-right font-normal">Reposts</th>
                  <th className="py-2 text-right font-normal">Rate</th>
                </tr>
              </thead>
              <tbody>
                {published.map((p) => {
                  const rate = reactionRate(p);
                  return (
                    <tr key={p.id} className="border-b border-line/70 align-top">
                      <td className="num whitespace-nowrap py-3 pr-4 text-[12.5px] text-muted">{p.published_at ? when(p.published_at) : "—"}</td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-2">
                          {bestIds.has(p.id) ? <span title="Among the best" aria-label="Among the best" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-mint-deep shadow-[0_0_8px_1px_rgba(79,174,127,.5)]" /> : null}
                          <div className="min-w-0">
                            <p className="line-clamp-2 max-w-[60ch]">{p.text}</p>
                            <p className="mt-0.5 text-[12px] text-faint">
                              {FORMAT_LABEL[p.format] ?? p.format} · {p.topic}
                              {p.external_url ? <> · <a href={p.external_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-green">open on Threads</a></> : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="num py-3 pr-3 text-right">{p.views === null ? "…" : formatNumber(p.views)}</td>
                      <td className="num py-3 pr-3 text-right">{p.likes ?? "…"}</td>
                      <td className="num py-3 pr-3 text-right">{p.replies ?? "…"}</td>
                      <td className="num py-3 pr-3 text-right">{p.reposts === null ? "…" : (p.reposts ?? 0) + (p.quotes ?? 0)}</td>
                      <td className="num py-3 text-right text-muted">{rate === null ? "—" : formatPercent(rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-faint">Replies from people land in Conversations → Threads, with drafted answers for your approval.</p>
        </section>
      ) : null}

      {/* Settings */}
      <details className="rounded-[10px] border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium">Settings</summary>
        <ActionForm action={saveStudioSettingsAction.bind(null, slug)} submitLabel="Save" className="grid gap-4 border-t border-line p-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" name="enabled" defaultChecked={d.settings.enabled} className="size-4 accent-[var(--green)]" />
            Write new posts every morning
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" name="web_trends" defaultChecked={d.settings.web_trends} className="size-4 accent-[var(--green)]" />
            Look at what is current on the web (one trend post when there is something real)
          </label>
          <Field label="Posts a day" htmlFor="ppd">
            <Select id="ppd" name="posts_per_day" defaultValue={String(d.settings.posts_per_day)}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Posting times (Riga)" htmlFor="slots" hint="One post per time, e.g. 09:30, 19:30">
            <Input id="slots" name="slots" defaultValue={d.settings.slots.join(", ")} />
          </Field>
          <Field label="Language of the posts" htmlFor="lang">
            <Select id="lang" name="language" defaultValue={d.settings.language}>
              <option value="en">English</option>
              <option value="ru">Russian</option>
            </Select>
          </Field>
        </ActionForm>
      </details>
    </div>
  );
}

function Heading({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span aria-hidden className="size-1.5 rounded-full bg-mint-deep shadow-[0_0_8px_1px_rgba(79,174,127,.5)]" />
      <h2 className="text-[19px] tracking-[-0.01em]">{title}</h2>
      {count !== undefined ? <span className="num text-[13px] text-faint">{count}</span> : null}
      <span aria-hidden className="h-px min-w-8 flex-1 bg-gradient-to-r from-line-strong to-transparent" />
      {action}
    </div>
  );
}

function Meter({ label, value, note, small = false }: { label: string; value: string; note: string; small?: boolean }) {
  return (
    <div className="bg-night px-5 py-4">
      <dt className="text-[12px] text-night-muted">{label}</dt>
      <dd className={cn("num mt-1.5 font-semibold leading-none tracking-[-0.02em] text-night-ink", small ? "text-[18px]" : "text-[26px]")}>{value}</dd>
      <dd className="mt-2 text-[11.5px] text-night-muted">{note}</dd>
    </div>
  );
}
