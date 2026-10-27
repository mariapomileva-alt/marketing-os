import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { calendarItems, lastCalendarSync, CAL_CHANNELS, type CalChannel, type CalCount, type CalItem } from "@/server/services/calendar";
import { syncCalendarAction } from "@/app/actions/calendar";
import { ActionForm } from "@/components/ui/action-form";
import { cn } from "@/lib/cn";

export const metadata = { title: "Calendar" };

const TZ = "Europe/Riga";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const utcDay = (k: string) => new Date(`${k}T12:00:00Z`);
const addDays = (k: string, n: number) => dayKey(new Date(utcDay(k).getTime() + n * 86_400_000));

const CH: Record<CalChannel, { label: string; short: string; color: string }> = {
  instagram: { label: "Instagram", short: "IG", color: "#c2255c" },
  facebook: { label: "Facebook", short: "FB", color: "#3b5bdb" },
  threads: { label: "Threads", short: "TH", color: "#1e2622" },
  youtube: { label: "YouTube", short: "YT", color: "#e03131" },
  tiktok: { label: "TikTok", short: "TT", color: "#0b7285" },
  website: { label: "Website", short: "WEB", color: "#bb8a52" },
};
const STATUS: Record<CalItem["status"], string> = { published: "Published", scheduled: "Scheduled", review: "In review", private: "Private", failed: "Failed" };
const KIND: Record<string, string> = { reel: "Reel", short: "Short", video: "Video", story: "Story", carousel: "Carousel", image: "Post", text: "Post", post: "Post", article: "Article" };

export default async function CalendarPage({ params, searchParams }: PageProps<"/p/[product]/calendar">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "week";
  const today = dayKey(new Date());
  const anchor = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const chosen = typeof sp.ch === "string" && sp.ch ? (sp.ch.split(",").filter((c) => (CAL_CHANNELS as string[]).includes(c)) as CalChannel[]) : [];
  const shown = (c: CalChannel) => !chosen.length || chosen.includes(c);

  // Week: Monday to Sunday around the anchor. Month: the 6-week grid that holds the anchor's month.
  const dow = (utcDay(anchor).getUTCDay() + 6) % 7;
  const weekStart = addDays(anchor, -dow);
  const monthFirst = `${anchor.slice(0, 7)}-01`;
  const gridStart = view === "week" ? weekStart : addDays(monthFirst, -((utcDay(monthFirst).getUTCDay() + 6) % 7));
  const days = Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => addDays(gridStart, i));
  const prevAnchor = view === "week" ? addDays(anchor, -7) : dayKey(new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 2, 1, 12)));
  const nextAnchor = view === "week" ? addDays(anchor, 7) : dayKey(new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 1, 12)));

  const product = await getProduct(slug);
  const from = new Date(utcDay(days[0]).getTime() - 14 * 3_600_000);
  const to = new Date(utcDay(days[days.length - 1]).getTime() + 14 * 3_600_000);
  const d = await db(async (tx) => ({
    ...(await calendarItems(tx, product.id, from, to)),
    synced: await lastCalendarSync(tx, product.id),
    connected: (await tx.query<{ channel: string }>("select channel from channel_connections where product_id = $1 and status in ('connected', 'paused')", [product.id])).map((r) => r.channel),
  }));
  const items = d.items.filter((i) => shown(i.channel));
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) {
    const k = dayKey(new Date(it.at));
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const countsByDay = new Map<string, CalCount[]>();
  for (const c of d.counts.filter((c) => shown(c.channel))) countsByDay.set(c.day, [...(countsByDay.get(c.day) ?? []), c]);

  const base = `/p/${slug}/calendar`;
  const q = (o: { view?: string; date?: string; ch?: CalChannel[] }) => {
    const u = new URLSearchParams();
    const v = o.view ?? view;
    if (v !== "week") u.set("view", v);
    const dt = o.date ?? anchor;
    if (dt !== today) u.set("date", dt);
    const ch = o.ch ?? chosen;
    if (ch.length) u.set("ch", ch.join(","));
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  const toggle = (c: CalChannel) => (chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c]);
  const fmtRange = view === "week"
    ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(utcDay(days[0]))} – ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(utcDay(days[6]))}`
    : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(utcDay(monthFirst));
  const synced = d.synced ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d.synced)) : null;
  const isConnected = (c: CalChannel) => d.connected.includes(c);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Calendar</h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] text-muted">
            Everything that went out or is planned, in one place: what God of Marketing scheduled, and what is on the platforms themselves. Riga time.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12.5px] text-faint">
          {synced ? <span>Platforms read {synced}</span> : <span>Platforms not read yet</span>}
          <ActionForm action={syncCalendarAction.bind(null, slug)} submitLabel="Sync now" pendingLabel="Reading platforms…" submitVariant="secondary" className="flex items-center gap-2 [&_p]:max-w-[260px] [&_p]:text-[12px]">
            <span className="sr-only">Read posts from the connected platforms</span>
          </ActionForm>
        </div>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-[6px] border border-line bg-surface p-0.5" role="group" aria-label="View">
            {(["week", "month"] as const).map((v) => (
              <Link key={v} href={q({ view: v })} aria-current={v === view ? "page" : undefined}
                className={cn("h-7 rounded-[4px] px-3 text-[13px] leading-7", v === view ? "bg-night font-medium text-mint" : "text-muted hover:text-ink")}>
                {v === "week" ? "Week" : "Month"}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Link href={q({ date: prevAnchor })} aria-label="Previous" className="inline-flex size-7 items-center justify-center rounded-[5px] text-muted hover:bg-sage-tint hover:text-ink">‹</Link>
            <Link href={q({ date: today })} className="h-7 rounded-[5px] px-2.5 text-[13px] leading-7 text-ink hover:bg-sage-tint">Today</Link>
            <Link href={q({ date: nextAnchor })} aria-label="Next" className="inline-flex size-7 items-center justify-center rounded-[5px] text-muted hover:bg-sage-tint hover:text-ink">›</Link>
          </div>
          <p className="num text-[16px] font-semibold tracking-[-0.01em]">{fmtRange}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Channels">
          {CAL_CHANNELS.map((c) => {
            const on = chosen.includes(c);
            const live = isConnected(c);
            return (
              <Link key={c} href={q({ ch: toggle(c) })} aria-pressed={on} title={live ? undefined : `${CH[c].label} is not connected yet`}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors",
                  on ? "border-night bg-night text-night-ink" : "border-line bg-surface text-ink hover:border-line-strong", !live && !on && "text-faint")}>
                <Badge c={c} size="sm" />
                {CH[c].label}
                {!live ? <span className="text-[11px] opacity-70">· off</span> : null}
              </Link>
            );
          })}
          {chosen.length ? <Link href={q({ ch: [] })} className="ml-1 text-[12.5px] text-green hover:underline">All</Link> : null}
        </div>
      </div>

      {view === "week" ? (
        <>
          {/* Week grid (tablet and up) */}
          <div className="hidden gap-2 md:grid md:grid-cols-7">
            {days.map((k) => (
              <DayColumn key={k} k={k} today={today} items={byDay.get(k) ?? []} counts={countsByDay.get(k) ?? []} slug={slug} />
            ))}
          </div>
          {/* Agenda (phone) */}
          <div className="flex flex-col gap-5 md:hidden">
            {days.map((k) => (
              <div key={k}>
                <DayHead k={k} today={today} />
                <div className="mt-2 flex flex-col gap-2">
                  {(byDay.get(k) ?? []).map((it) => <Card key={it.key} it={it} slug={slug} wide />)}
                  <Counts counts={countsByDay.get(k) ?? []} />
                  {!(byDay.get(k) ?? []).length && !(countsByDay.get(k) ?? []).length ? <p className="text-[12.5px] text-faint">Nothing</p> : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 gap-px overflow-hidden rounded-[8px] border border-line bg-line">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => <div key={x} className="bg-paper px-2 py-1.5 text-[12px] text-muted">{x}</div>)}
            {days.map((k) => {
              const inMonth = k.slice(0, 7) === anchor.slice(0, 7);
              const list = byDay.get(k) ?? [];
              const cs = countsByDay.get(k) ?? [];
              return (
                <Link key={k} href={q({ view: "week", date: k })} className={cn("flex min-h-[112px] flex-col gap-1 p-1.5 hover:bg-sage-tint", inMonth ? "bg-surface" : "bg-paper/70")}>
                  <span className={cn("num inline-flex size-6 items-center justify-center rounded-full text-[12px]", k === today ? "bg-night font-semibold text-mint" : inMonth ? "text-ink" : "text-faint")}>{Number(k.slice(8))}</span>
                  {list.slice(0, 4).map((it) => (
                    <span key={it.key} className={cn("flex items-center gap-1 truncate rounded-[4px] px-1 py-0.5 text-[11.5px]", it.status === "published" ? "bg-green-soft/70" : "border border-dashed border-line-strong")}>
                      <Badge c={it.channel} size="xs" />
                      <span className="num text-muted">{time(it.at)}</span>
                      <span className="truncate">{it.title || KIND[it.kind]}</span>
                    </span>
                  ))}
                  {list.length > 4 ? <span className="px-1 text-[11.5px] text-muted">+{list.length - 4} more</span> : null}
                  {cs.length ? <span className="mt-auto px-1 text-[11px] text-faint">{cs.reduce((a, c) => a + c.ours, 0)} comments · {cs.reduce((a, c) => a + c.people, 0)} replies</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-[3px] border border-line bg-surface" /> Published</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-[3px] border border-dashed border-green/60" /> Scheduled</span>
        <span>“From the platform”: posted outside God of Marketing, read from the account.</span>
      </div>
      <details className="text-[13px] text-muted">
        <summary className="cursor-pointer">What the calendar can and cannot see</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>Instagram, Threads and YouTube: every post on our accounts, read every morning and when you press Sync now. YouTube also shows videos scheduled there.</li>
          <li>Posts scheduled inside Meta Business Suite appear once they are published: Meta does not share Business Suite’s planned posts through its API.</li>
          <li>Facebook Page: needs the Facebook Page connected (Connections). TikTok: needs TikTok’s approval of the app first.</li>
          <li>Comments and replies are counted per day, not shown one by one; open Conversations for them.</li>
        </ul>
      </details>
    </div>
  );
}

function DayHead({ k, today }: { k: string; today: string }) {
  const d = utcDay(k);
  const name = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d);
  const isToday = k === today;
  return (
    <div className={cn("flex items-baseline justify-center gap-1.5 rounded-[6px] py-1.5 text-[13px] md:justify-center max-md:justify-start max-md:px-0",
      isToday ? "bg-night text-mint shadow-[0_0_0_1px_var(--night-line),0_0_18px_-4px_rgba(79,174,127,.6)] max-md:px-2.5" : "text-muted")}>
      <span>{name}</span>
      <span className={cn("num font-semibold", isToday ? "text-night-ink" : "text-ink")}>{Number(k.slice(8))}</span>
      {isToday ? <span className="text-[11.5px] text-mint">today</span> : null}
    </div>
  );
}

function DayColumn({ k, today, items, counts, slug }: { k: string; today: string; items: CalItem[]; counts: CalCount[]; slug: string }) {
  const past = k < today;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <DayHead k={k} today={today} />
      <div className={cn("flex min-h-[420px] flex-col gap-2 rounded-[8px] p-1.5", k === today ? "bg-green-soft/40 ring-1 ring-green/15" : past ? "bg-paper" : "bg-surface/60 ring-1 ring-line")}>
        {items.map((it) => <Card key={it.key} it={it} slug={slug} />)}
        {!items.length && !counts.length ? <p className="pt-2 text-center text-[12px] text-faint">—</p> : null}
        <div className="mt-auto"><Counts counts={counts} /></div>
      </div>
    </div>
  );
}

function Card({ it, slug, wide = false }: { it: CalItem; slug: string; wide?: boolean }) {
  const href = it.href ? `/p/${slug}${it.href}` : it.url;
  const scheduled = it.status !== "published";
  const body = (
    <>
      <div className="flex items-center gap-1.5 px-2 pt-1.5">
        <Badge c={it.channel} size="sm" />
        <span className="num text-[12.5px] font-semibold">{time(it.at)}</span>
        <span className={cn("ml-auto truncate text-[11px]", it.status === "failed" ? "text-red" : scheduled ? "text-green" : "text-faint")}>{STATUS[it.status]}</span>
      </div>
      {it.thumb ? (
        // Platform thumbnails (signed CDN links that change daily), so a plain img.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.thumb} alt="" loading="lazy" className={cn("mx-2 mt-1.5 rounded-[5px] bg-paper object-cover", wide ? "aspect-video" : "aspect-[4/5]")} />
      ) : (
        <div className={cn("relative mx-2 mt-1.5 overflow-hidden rounded-[5px] bg-night p-2.5", wide ? "min-h-[64px]" : "aspect-[4/3]")}>
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-mint/50 to-transparent" />
          <p className="line-clamp-4 text-[12px] leading-snug text-night-ink/90">{it.title || KIND[it.kind]}</p>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[11px] text-muted">
        <span>{KIND[it.kind] ?? "Post"}</span>
        {it.origin === "platform" ? <span className="truncate text-faint">· from the platform</span> : null}
      </div>
    </>
  );
  const cls = cn("block overflow-hidden rounded-[7px] border bg-surface transition-colors hover:border-green/40", scheduled ? "border-dashed border-green/45" : "border-line");
  if (!href) return <div className={cls} title={it.title}>{body}</div>;
  return it.href ? <Link href={href} className={cls} title={it.title}>{body}</Link> : <a href={href} target="_blank" rel="noreferrer noopener" className={cls} title={it.title}>{body}</a>;
}

function Counts({ counts }: { counts: CalCount[] }) {
  if (!counts.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {counts.map((c) => (
        <li key={c.channel} className="flex items-center gap-1.5 rounded-[5px] border border-line bg-surface px-1.5 py-1 text-[11px] text-muted" title="Comments and replies that day">
          <Badge c={c.channel} size="xs" />
          {c.ours ? <span><span className="num font-semibold text-ink">{c.ours}</span> ours</span> : null}
          {c.people ? <span><span className="num font-semibold text-ink">{c.people}</span> from people</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Badge({ c, size }: { c: CalChannel; size: "xs" | "sm" }) {
  return (
    <span aria-label={CH[c].label} className={cn("inline-flex shrink-0 items-center justify-center rounded-[4px] font-bold text-white", size === "xs" ? "h-3.5 min-w-3.5 px-0.5 text-[8px]" : "h-4 min-w-4 px-0.5 text-[9px]")} style={{ background: CH[c].color }}>
      {CH[c].short}
    </span>
  );
}
