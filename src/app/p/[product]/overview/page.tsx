import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { gatherFacts, latestBrief } from "@/server/services/brief";
import { refreshBriefAction } from "@/app/actions/brief";
import { ActionForm } from "@/components/ui/action-form";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BriefOrb } from "./brief-orb";

export const metadata = { title: "Today" };
// Rebuilding the brief searches the web and writes it with Claude: allow it time.
export const maxDuration = 300;

/** Short names of the places a brief item can send you to. */
const PLACE: Record<string, string> = {
  overview: "Сегодня", analytics: "Аналитика", conversations: "Разговоры", approvals: "Одобрение", calm: "Calm Videos", knowledge: "Знания",
  studio: "Студия", ideas: "Идеи", competitors: "Конкуренты", connections: "Подключения", calendar: "Календарь",
};
const OUTSIDE_KIND: Record<string, string> = { trend: "Тренд", competitor: "Конкурент", platform: "Платформа" };

export default async function TodayPage({ params }: PageProps<"/p/[product]/overview">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx) => {
    const facts = await gatherFacts(tx, product.id);
    const brief = await latestBrief(tx, product.id);
    const attention = await tx.query<{ label: string; href: string; tone: string }>(
      `select subject_summary label, '/approvals' href, 'amber' tone from approval_items where product_id = $1 and state = 'pending'
       union all
       select c.channel || ': ' || coalesce(c.paused_reason, c.last_error, c.status), '/connections', 'red' from channel_connections c
        where c.product_id = $1 and c.status in ('paused','error')
       limit 6`,
      [product.id],
    );
    return { facts, brief, attention };
  });
  const base = `/p/${slug}`;
  const f = d.facts;
  const b = d.brief?.brief ?? null;
  const fresh = d.brief?.day === f.day;
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Riga" }).format(new Date());
  const builtAt = d.brief ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Europe/Riga" }).format(new Date(d.brief.created_at)) : null;
  const people = (w: { yesterday: number; last7: number; prev7: number }[]) =>
    w.reduce((a, x) => ({ yesterday: a.yesterday + x.yesterday, last7: a.last7 + x.last7, prev7: a.prev7 + x.prev7 }), { yesterday: 0, last7: 0, prev7: 0 });
  const replies = people([f.community.youtube.replies_from_people, f.community.threads.messages_from_people, f.community.instagram.comments_from_people]);
  const ours = people([f.community.youtube.our_comments_posted, f.community.threads.our_posts_and_replies, f.community.instagram.our_replies]);

  const go = (section: string | null) =>
    section && PLACE[section] ? <Link href={`${base}/${section}`} className="text-[12.5px] font-medium text-green underline-offset-2 hover:underline">{PLACE[section]}</Link> : null;

  return (
    <div className="flex flex-col gap-8">
      {/* The brief */}
      <section className="-mx-4 overflow-hidden bg-night px-5 py-8 text-night-ink sm:mx-0 sm:rounded-[14px] sm:px-10 sm:py-10" aria-label="Утренняя сводка">
        <div className="grid items-center gap-8 lg:grid-cols-[auto_1fr] lg:gap-14">
          <BriefOrb src={d.brief?.audio_path ? `${base}/overview/audio/${d.brief.id}` : null} label="Послушать сводку" />
          <div className="min-w-0">
            <p className="text-[13px] text-night-muted first-letter:uppercase">{today}</p>
            <h1 className="mt-1 text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-night-ink sm:text-[36px]">
              {b ? b.greeting : "Доброе утро"}
            </h1>
            <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.6] text-night-ink/85">
              {b ? b.summary : "Сводка собирается каждое утро в 8:20: что мы сделали, что сработало, что сделать сегодня и что происходит у конкурентов. Её можно собрать прямо сейчас."}
            </p>
            {!fresh && b ? <p className="mt-2 text-[13px] text-mint">Это сводка за {d.brief?.day}. Сегодняшняя ещё не собрана.</p> : null}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-night-muted">
              <ActionForm action={refreshBriefAction.bind(null, slug)} submitLabel={b ? "Собрать заново" : "Собрать сводку"} pendingLabel="Собираю, это около минуты…" submitVariant="ghost" className="flex items-center gap-3 [&_button]:border [&_button]:border-night-line [&_button]:text-night-ink [&_button:hover]:bg-night-raise [&_p]:text-night-muted">
                <span className="sr-only">Собрать сводку заново</span>
              </ActionForm>
              {builtAt ? <span>Собрано {builtAt}{d.brief?.web_search ? ", с поиском в интернете" : ""}</span> : null}
              {d.brief && !d.brief.audio_path && !d.brief.is_mock ? <span>Голос появится, когда в Подключениях есть ключ OpenAI.</span> : null}
              {d.brief?.is_mock ? <span className="text-mint">Пример: подключите Claude в Подключениях для настоящей сводки.</span> : null}
            </div>
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section aria-label="Цифры за неделю">
        <h2 className="sr-only">Цифры</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Люди на сайте" w={f.website.visits} href={`${base}/analytics`} />
          <Tile label="Пришли из ИИ" hint="ChatGPT, Perplexity, Gemini…" w={f.website.from_ai_assistants} href={`${base}/analytics`} />
          <Tile label="Нажали App Store" w={f.website.app_store_clicks} href={`${base}/analytics`} />
          <Tile label="Нам ответили" hint="YouTube, Threads, Instagram" w={replies} href={`${base}/conversations`} />
          <Tile label="Мы написали" hint="комментарии и ответы" w={ours} href={`${base}/conversations`} />
          <div className="bg-surface px-4 py-3.5">
            <dt className="text-[12.5px] text-muted">Продажи и установки</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-tight text-faint">—</dd>
            <dd className="text-[12px] text-faint">App Store Connect не подключён</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] text-faint">Большая цифра — последние 7 дней. Сравнение — с неделей раньше.</p>
      </section>

      {b ? (
        <>
          <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
            <section>
              <h2 className="text-[20px]">Сделать сегодня</h2>
              {b.todo.length ? (
                <ol className="mt-3 flex flex-col divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
                  {b.todo.map((t, i) => (
                    <li key={i} className="flex gap-4 px-4 py-3.5">
                      <span className="num mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-green-soft text-[12.5px] font-semibold text-green">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] font-medium leading-snug">{t.text}</p>
                        {t.why ? <p className="mt-0.5 text-[13px] text-muted">{t.why}</p> : null}
                        <div className="mt-1.5 sm:hidden">{go(t.section)}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 max-sm:hidden">{go(t.section)}</div>
                    </li>
                  ))}
                </ol>
              ) : <p className="mt-3 text-[13.5px] text-muted">Сегодня ничего срочного.</p>}
            </section>
            <div className="flex flex-col gap-8">
              <List title="Сработало" items={b.worked} go={go} empty="Пока нечего отметить." accent />
              <List title="Сделали вчера" items={b.done} go={go} empty="Вчера ничего не публиковали." />
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
            <section>
              <h2 className="text-[20px]">Что происходит вокруг</h2>
              {b.outside.length ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {b.outside.map((o, i) => (
                    <li key={i} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                      <span className="text-[12px] font-medium text-slate">{OUTSIDE_KIND[o.kind]}</span>
                      <p className="text-[14px] leading-snug">{o.text}</p>
                      {o.idea ? <p className="text-[13px] text-muted"><span className="font-medium text-ink">Что взять себе:</span> {o.idea}</p> : null}
                      {o.source_url ? <a href={o.source_url} target="_blank" rel="noreferrer noopener" className="mt-auto truncate text-[12px] text-faint underline underline-offset-2">{hostOf(o.source_url)}</a> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13.5px] text-muted">
                  {d.brief?.web_search ? "Сегодня ничего важного не нашлось." : "Поиск по интернету был недоступен, когда собиралась сводка."}
                  {f.competitors.length ? null : <> Добавьте конкурентов в разделе <Link href={`${base}/competitors`} className="text-green underline underline-offset-2">Конкуренты</Link>, и я буду следить за ними.</>}
                </p>
              )}
            </section>
            <List title="Чего не хватает" items={b.missing} go={go} empty="Всё нужное подключено." />
          </div>
        </>
      ) : null}

      {d.attention.length ? (
        <section>
          <h2 className="text-[20px]">Ждёт вас</h2>
          <ul className="mt-3 divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
            {d.attention.map((a, i) => (
              <li key={i}>
                <Link href={`${base}${a.href}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-sage-tint">
                  <span className="min-w-0 truncate">{a.label}</span>
                  <span className={cn("shrink-0 text-[12.5px]", a.tone === "red" ? "text-red" : "text-amber")}>{a.tone === "red" ? "Проблема с подключением" : "Нужно одобрить"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Tile({ label, hint, w, href }: { label: string; hint?: string; w: { yesterday: number; last7: number; prev7: number }; href: string }) {
  const diff = w.last7 - w.prev7;
  const small = w.last7 + w.prev7 < 20; // too few to call a change
  return (
    <Link href={href} className="bg-surface px-4 py-3.5 hover:bg-sage-tint">
      <dt className="text-[12.5px] text-muted" title={hint}>{label}</dt>
      <dd className="num mt-1 text-[24px] font-semibold tracking-tight">{formatNumber(w.last7)}</dd>
      <dd className="num text-[12px] text-faint">
        вчера {formatNumber(w.yesterday)} ·{" "}
        {w.prev7 === 0 && w.last7 === 0 ? "пока нет данных" : (
          <span className={cn(!small && diff > 0 && "text-green", !small && diff < 0 && "text-amber")}>
            {diff === 0 ? "как неделей раньше" : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))} к прошлой неделе`}
          </span>
        )}
      </dd>
    </Link>
  );
}

function List({ title, items, go, empty, accent = false }: { title: string; items: Array<{ text: string; section: string | null }>; go: (s: string | null) => React.ReactNode; empty: string; accent?: boolean }) {
  return (
    <section>
      <h2 className="text-[20px]">{title}</h2>
      {items.length ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {items.map((x, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-snug">
              <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", accent ? "bg-mint-deep" : "bg-line-strong")} />
              <span className="min-w-0 flex-1">{x.text} {go(x.section)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-[13.5px] text-muted">{empty}</p>}
    </section>
  );
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
