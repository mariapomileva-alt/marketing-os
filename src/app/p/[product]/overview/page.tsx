import Link from "next/link";
import { cookies } from "next/headers";
import { db, getProduct } from "@/server/context";
import { dailySeries, gatherFacts, latestBrief } from "@/server/services/brief";
import { refreshBriefAction } from "@/app/actions/brief";
import { ActionForm } from "@/components/ui/action-form";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BriefOrb } from "./brief-orb";
import { LangSwitch } from "./lang-switch";

export const metadata = { title: "Today" };
// Rebuilding the brief searches the web and writes it with Claude: allow it time.
export const maxDuration = 300;

type Lang = "en" | "ru";

const T = {
  en: {
    locale: "en-GB", hello: "Good morning", listen: "Listen to the brief", text: "Text", voice: "Voice",
    empty: "The brief is put together every morning at 8:20: what we did, what worked, what to do today and what is happening around us. You can build it right now.",
    stale: (d: string) => `This is the brief for ${d}. Today's has not been built yet.`, rebuild: "Rebuild", build: "Build the brief", building: "Building, about a minute…",
    built: (t: string, web: boolean) => `Built ${t}${web ? " · with web search" : ""}`, noVoice: "Voice appears once an OpenAI key is connected.", mock: "Example only: connect Claude in Connections for a real brief.",
    noRu: "The Russian version is not ready; showing English.",
    tiles: { visits: "People on the site", ai: "Came from AI", aiHint: "ChatGPT, Perplexity, Gemini…", app: "Tapped App Store", replies: "People replied", repliesHint: "YouTube, Threads, Instagram", ours: "We wrote", oursHint: "comments and replies", sales: "Sales and installs", salesNote: "App Store Connect not connected" },
    yesterday: "yesterday", same: "same as last week", vsWeek: "vs last week", noData: "no data yet", legend: "Big number: last 7 days. Bars: the last 14 days.",
    todo: "To do today", todoEmpty: "Nothing urgent today.", worked: "What worked", workedEmpty: "Nothing to note yet.", done: "Done yesterday", doneEmpty: "Nothing went out yesterday.",
    outside: "Around us", take: "Take for us:", noOutside: (web: boolean) => web ? "Nothing important found today." : "Web search was not available when the brief was built.",
    addCompetitors: ["Add competitors in ", "Competitors", " and the brief will watch them."], missing: "What's missing", missingEmpty: "Everything needed is connected.",
    waiting: "Waiting for you", approve: "Needs approval", problem: "Connection problem",
    kind: { trend: "Trend", competitor: "Competitor", platform: "Platform" },
    place: { overview: "Today", analytics: "Analytics", conversations: "Conversations", approvals: "Approve", calm: "Calm Videos", knowledge: "Knowledge", studio: "Posts", ideas: "Ideas", competitors: "Competitors", connections: "Connections", calendar: "Calendar" } as Record<string, string>,
  },
  ru: {
    locale: "ru-RU", hello: "Доброе утро", listen: "Послушать сводку", text: "Текст", voice: "Голос",
    empty: "Сводка собирается каждое утро в 8:20: что мы сделали, что сработало, что сделать сегодня и что происходит вокруг. Её можно собрать прямо сейчас.",
    stale: (d: string) => `Это сводка за ${d}. Сегодняшняя ещё не собрана.`, rebuild: "Собрать заново", build: "Собрать сводку", building: "Собираю, это около минуты…",
    built: (t: string, web: boolean) => `Собрано ${t}${web ? " · с поиском в интернете" : ""}`, noVoice: "Голос появится, когда в Подключениях есть ключ OpenAI.", mock: "Пример: подключите Claude в Подключениях для настоящей сводки.",
    noRu: "Русская версия не готова, показываю английскую.",
    tiles: { visits: "Люди на сайте", ai: "Пришли из ИИ", aiHint: "ChatGPT, Perplexity, Gemini…", app: "Нажали App Store", replies: "Нам ответили", repliesHint: "YouTube, Threads, Instagram", ours: "Мы написали", oursHint: "комментарии и ответы", sales: "Продажи и установки", salesNote: "App Store Connect не подключён" },
    yesterday: "вчера", same: "как неделей раньше", vsWeek: "к прошлой неделе", noData: "пока нет данных", legend: "Большая цифра — последние 7 дней. Столбики — последние 14 дней.",
    todo: "Сделать сегодня", todoEmpty: "Сегодня ничего срочного.", worked: "Сработало", workedEmpty: "Пока нечего отметить.", done: "Сделали вчера", doneEmpty: "Вчера ничего не публиковали.",
    outside: "Что происходит вокруг", take: "Что взять себе:", noOutside: (web: boolean) => web ? "Сегодня ничего важного не нашлось." : "Поиск по интернету был недоступен, когда собиралась сводка.",
    addCompetitors: ["Добавьте конкурентов в разделе ", "Конкуренты", ", и сводка будет следить за ними."], missing: "Чего не хватает", missingEmpty: "Всё нужное подключено.",
    waiting: "Ждёт вас", approve: "Нужно одобрить", problem: "Проблема с подключением",
    kind: { trend: "Тренд", competitor: "Конкурент", platform: "Платформа" },
    place: { overview: "Сегодня", analytics: "Аналитика", conversations: "Разговоры", approvals: "Одобрение", calm: "Calm Videos", knowledge: "Знания", studio: "Посты", ideas: "Идеи", competitors: "Конкуренты", connections: "Подключения", calendar: "Календарь" } as Record<string, string>,
  },
} as const;

const langOf = (v: string | undefined, fallback: Lang): Lang => (v === "en" || v === "ru" ? v : fallback);

export default async function TodayPage({ params }: PageProps<"/p/[product]/overview">) {
  const { product: slug } = await params;
  const jar = await cookies();
  const lang = langOf(jar.get("mos_text_lang")?.value, "en");
  const voiceLang = langOf(jar.get("mos_voice_lang")?.value, "ru");
  const t = T[lang];
  const product = await getProduct(slug);
  const d = await db(async (tx) => {
    const facts = await gatherFacts(tx, product.id);
    const brief = await latestBrief(tx, product.id);
    const series = await dailySeries(tx, product.id);
    const attention = await tx.query<{ label: string; href: string; tone: string }>(
      `select subject_summary label, '/approvals' href, 'amber' tone from approval_items where product_id = $1 and state = 'pending'
       union all
       select c.channel || ': ' || coalesce(c.paused_reason, c.last_error, c.status), '/connections', 'red' from channel_connections c
        where c.product_id = $1 and c.status in ('paused','error')
       limit 6`,
      [product.id],
    );
    return { facts, brief, series, attention };
  });
  const base = `/p/${slug}`;
  const f = d.facts;
  // Briefs built before the English version existed only have the Russian text (in "brief").
  const en = d.brief?.brief_en ?? null;
  const ru = d.brief?.brief ?? null;
  const b = lang === "ru" ? (ru ?? en) : (en ?? ru);
  const fallbackNote = lang === "ru" && !ru && en ? t.noRu : null;
  const audioReady = { en: Boolean(d.brief?.audio_path_en), ru: Boolean(d.brief?.audio_path) };
  const playLang: Lang = audioReady[voiceLang] ? voiceLang : audioReady.en ? "en" : "ru";
  const audioSrc = d.brief && audioReady[playLang] ? `${base}/overview/audio/${d.brief.id}${playLang === "en" ? "?lang=en" : ""}` : null;
  const fresh = d.brief?.day === f.day;
  const today = new Intl.DateTimeFormat(t.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Riga" }).format(new Date());
  const builtAt = d.brief ? new Intl.DateTimeFormat(t.locale, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Europe/Riga" }).format(new Date(d.brief.created_at)) : null;
  const sum = (w: { yesterday: number; last7: number; prev7: number }[]) =>
    w.reduce((a, x) => ({ yesterday: a.yesterday + x.yesterday, last7: a.last7 + x.last7, prev7: a.prev7 + x.prev7 }), { yesterday: 0, last7: 0, prev7: 0 });
  const replies = sum([f.community.youtube.replies_from_people, f.community.threads.messages_from_people, f.community.instagram.comments_from_people]);
  const ours = sum([f.community.youtube.our_comments_posted, f.community.threads.our_posts_and_replies, f.community.instagram.our_replies]);

  const go = (section: string | null) =>
    section && t.place[section] ? (
      <Link href={`${base}/${section}`} className="whitespace-nowrap text-[12.5px] font-medium text-green underline-offset-2 hover:underline">{t.place[section]}</Link>
    ) : null;

  return (
    <div className="flex flex-col gap-10">
      {/* The console: brief + instruments */}
      <section className="relative -mx-4 overflow-hidden bg-night max-sm:-mt-6 text-night-ink sm:mx-0 sm:rounded-[12px] sm:border sm:border-night-line" aria-label={t.listen}>
        <div aria-hidden className="grid-field pointer-events-none absolute inset-0" />
        <Corners />
        <div className="relative grid items-center gap-8 px-5 pb-8 pt-7 sm:px-10 sm:pt-9 lg:grid-cols-[auto_1fr] lg:gap-14">
          <div className="flex flex-col items-center gap-3">
            <BriefOrb key={audioSrc ?? "none"} src={audioSrc} label={t.listen} />
            {audioReady.en || audioReady.ru ? <LangSwitch cookie="mos_voice_lang" value={playLang} label={t.voice} /> : null}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-night-muted first-letter:uppercase">{today}</p>
              <LangSwitch cookie="mos_text_lang" value={lang} label={t.text} />
            </div>
            <h1 className="mt-2 text-[30px] font-semibold leading-[1.12] tracking-[-0.025em] text-night-ink sm:text-[38px]">{b ? b.greeting : t.hello}</h1>
            <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-night-ink/85">{b ? b.summary : t.empty}</p>
            {fallbackNote ? <p className="mt-2 text-[13px] text-mint">{fallbackNote}</p> : null}
            {!fresh && b ? <p className="mt-2 text-[13px] text-mint">{t.stale(d.brief?.day ?? "")}</p> : null}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-night-muted">
              <ActionForm
                action={refreshBriefAction.bind(null, slug, lang)}
                submitLabel={b ? t.rebuild : t.build}
                pendingLabel={t.building}
                submitVariant="ghost"
                className="flex items-center gap-3 [&_button]:border [&_button]:border-night-line [&_button]:text-night-ink [&_button:hover]:border-mint/50 [&_button:hover]:bg-night-raise [&_p]:text-night-muted"
              >
                <span className="sr-only">{t.rebuild}</span>
              </ActionForm>
              {builtAt ? <span>{t.built(builtAt, Boolean(d.brief?.web_search))}</span> : null}
              {d.brief && !audioReady.en && !audioReady.ru && !d.brief.is_mock ? <span>{t.noVoice}</span> : null}
              {d.brief?.is_mock ? <span className="text-mint">{t.mock}</span> : null}
            </div>
          </div>
        </div>

        {/* Instruments */}
        <dl className="relative grid grid-cols-2 gap-px border-t border-night-line bg-night-line md:grid-cols-3 xl:grid-cols-6">
          <Gauge t={t} label={t.tiles.visits} w={f.website.visits} bars={d.series.visits} href={`${base}/analytics`} />
          <Gauge t={t} label={t.tiles.ai} hint={t.tiles.aiHint} w={f.website.from_ai_assistants} bars={d.series.ai} href={`${base}/analytics`} />
          <Gauge t={t} label={t.tiles.app} w={f.website.app_store_clicks} bars={d.series.app_store} href={`${base}/analytics`} />
          <Gauge t={t} label={t.tiles.replies} hint={t.tiles.repliesHint} w={replies} bars={d.series.replies} href={`${base}/conversations`} />
          <Gauge t={t} label={t.tiles.ours} hint={t.tiles.oursHint} w={ours} bars={d.series.ours} href={`${base}/conversations`} />
          <div className="bg-night px-5 py-4">
            <dt className="text-[12px] text-night-muted">{t.tiles.sales}</dt>
            <dd className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em] text-night-muted/60">—</dd>
            <dd className="mt-3 text-[11.5px] leading-snug text-night-muted">{t.tiles.salesNote}</dd>
          </div>
        </dl>
      </section>
      <p className="-mt-8 text-[12px] text-faint">{t.legend}</p>

      {b ? (
        <>
          <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
            <section>
              <Heading>{t.todo}</Heading>
              {b.todo.length ? (
                <ol className="mt-4 flex flex-col gap-2">
                  {b.todo.map((x, i) => (
                    <li key={i} className="group flex gap-4 rounded-[8px] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-green/35">
                      <span className="num mt-px inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[5px] border border-green/25 px-1 text-[12px] font-semibold text-green">{String(i + 1).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] font-medium leading-snug">{x.text}</p>
                        {x.why ? <p className="mt-1 text-[13px] leading-snug text-muted">{x.why}</p> : null}
                        <div className="mt-1.5 sm:hidden">{go(x.section)}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 max-sm:hidden">{go(x.section)}</div>
                    </li>
                  ))}
                </ol>
              ) : <p className="mt-4 text-[13.5px] text-muted">{t.todoEmpty}</p>}
            </section>
            <div className="flex flex-col gap-10">
              <List title={t.worked} items={b.worked} go={go} empty={t.workedEmpty} accent />
              <List title={t.done} items={b.done} go={go} empty={t.doneEmpty} />
            </div>
          </div>

          <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
            <section>
              <Heading>{t.outside}</Heading>
              {b.outside.length ? (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {b.outside.map((o, i) => (
                    <li key={i} className="relative flex flex-col gap-2 overflow-hidden rounded-[8px] border border-line bg-surface p-4 transition-colors hover:border-green/35">
                      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-mint-deep/70 via-mint-deep/10 to-transparent" />
                      <span className="text-[12px] font-medium text-slate">{t.kind[o.kind]}</span>
                      <p className="text-[14px] leading-snug">{o.text}</p>
                      {o.idea ? <p className="text-[13px] leading-snug text-muted"><span className="font-medium text-ink">{t.take}</span> {o.idea}</p> : null}
                      {o.source_url ? <a href={o.source_url} target="_blank" rel="noreferrer noopener" className="mt-auto truncate pt-1 text-[12px] text-faint underline underline-offset-2 hover:text-green">{hostOf(o.source_url)}</a> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-[13.5px] text-muted">
                  {t.noOutside(Boolean(d.brief?.web_search))}{" "}
                  {f.competitors.length ? null : <>{t.addCompetitors[0]}<Link href={`${base}/competitors`} className="text-green underline underline-offset-2">{t.addCompetitors[1]}</Link>{t.addCompetitors[2]}</>}
                </p>
              )}
            </section>
            <List title={t.missing} items={b.missing} go={go} empty={t.missingEmpty} />
          </div>
        </>
      ) : null}

      {d.attention.length ? (
        <section>
          <Heading>{t.waiting}</Heading>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface">
            {d.attention.map((a, i) => (
              <li key={i}>
                <Link href={`${base}${a.href}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-sage-tint">
                  <span className="min-w-0 truncate">{a.label}</span>
                  <span className={cn("shrink-0 text-[12.5px]", a.tone === "red" ? "text-red" : "text-amber")}>{a.tone === "red" ? t.problem : t.approve}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Thin corner marks on the console: a quiet, technical frame. */
function Corners() {
  const c = "pointer-events-none absolute size-3 border-mint/45";
  return (
    <>
      <span aria-hidden className={cn(c, "left-3 top-3 border-l border-t")} />
      <span aria-hidden className={cn(c, "right-3 top-3 border-r border-t")} />
      <span aria-hidden className={cn(c, "bottom-3 left-3 border-b border-l max-sm:hidden")} />
      <span aria-hidden className={cn(c, "bottom-3 right-3 border-b border-r max-sm:hidden")} />
    </>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="size-1.5 rounded-full bg-mint-deep shadow-[0_0_8px_1px_rgba(79,174,127,.5)]" />
      <h2 className="text-[19px] tracking-[-0.01em]">{children}</h2>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-line-strong to-transparent" />
    </div>
  );
}

type Dict = (typeof T)[Lang];

function Gauge({ t, label, hint, w, bars, href }: { t: Dict; label: string; hint?: string; w: { yesterday: number; last7: number; prev7: number }; bars: number[]; href: string }) {
  const diff = w.last7 - w.prev7;
  const small = w.last7 + w.prev7 < 20; // too few to call a change
  const max = Math.max(1, ...bars);
  return (
    <Link href={href} className="group block bg-night px-5 py-4 transition-colors hover:bg-night-raise">
      <dt className="text-[12px] text-night-muted" title={hint}>{label}</dt>
      <dd className="num mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-night-ink">{formatNumber(w.last7)}</span>
        {w.last7 || w.prev7 ? (
          <span className={cn("text-[11.5px] font-medium", small || diff === 0 ? "text-night-muted" : diff > 0 ? "text-mint" : "text-[#e7c27a]")}>
            {diff === 0 ? "=" : `${diff > 0 ? "↑" : "↓"} ${formatNumber(Math.abs(diff))}`}
          </span>
        ) : null}
      </dd>
      <dd aria-hidden className="mt-3 flex h-7 items-end gap-[3px]">
        {bars.map((v, i) => (
          <span
            key={i}
            className={cn("flex-1 rounded-[1px]", i === bars.length - 1 ? "bg-mint" : i >= bars.length - 7 ? "bg-mint/55" : "bg-mint/20")}
            style={{ height: `${v ? Math.max(12, (v / max) * 100) : 6}%` }}
          />
        ))}
      </dd>
      <dd className="num mt-2 text-[11.5px] text-night-muted">
        {t.yesterday} {formatNumber(w.yesterday)} · {w.prev7 === 0 && w.last7 === 0 ? t.noData : diff === 0 ? t.same : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))} ${t.vsWeek}`}
      </dd>
    </Link>
  );
}

function List({ title, items, go, empty, accent = false }: { title: string; items: Array<{ text: string; section: string | null }>; go: (s: string | null) => React.ReactNode; empty: string; accent?: boolean }) {
  return (
    <section>
      <Heading>{title}</Heading>
      {items.length ? (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((x, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-snug">
              <span aria-hidden className={cn("mt-[6px] h-2.5 w-px shrink-0", accent ? "bg-mint-deep" : "bg-line-strong")} />
              <span className="min-w-0 flex-1">{x.text} {go(x.section)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-[13.5px] text-muted">{empty}</p>}
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
