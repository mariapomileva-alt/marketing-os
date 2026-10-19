import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { PageHeader, Section } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { STUDIO_CHANNELS } from "@/domain/content";

export const metadata = { title: "Calendar" };

const TZ = "Europe/Riga";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);

export default async function CalendarPage({ params, searchParams }: PageProps<"/p/[product]/calendar">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const now = new Date();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : dayKey(now).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday first
  const gridStart = new Date(Date.UTC(y, m - 1, 1 - startOffset));
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * 86_400_000));
  const product = await getProduct(slug);
  const rows = await db((tx) =>
    tx.query<{ id: string; title: string; status: string; channel: string; at: string }>(
      `select id, title, status, channel, coalesce(published_at, scheduled_for)::text at from content_items
        where product_id = $1 and status in ('scheduled','published') and coalesce(published_at, scheduled_for) between $2 and $3 order by 5`,
      [product.id, days[0].toISOString(), new Date(days[41].getTime() + 86_400_000).toISOString()],
    ),
  );
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = dayKey(new Date(r.at));
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const today = dayKey(now);
  return (
    <>
      <PageHeader title="Calendar" description="Approved content placed on dates, and what was published. Times in Riga time. Scheduling never posts automatically in v0.1: you post from the export." />
      <Section
        title={label}
        actions={<div className="flex gap-3 text-[13px]"><Link className="text-green hover:underline" href={`/p/${slug}/calendar?month=${prev}`}>Previous month</Link><Link className="text-green hover:underline" href={`/p/${slug}/calendar?month=${next}`}>Next month</Link></div>}
      >
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b border-line bg-paper/60 px-2 py-1.5 text-[12px] text-muted">{d}</div>)}
            {days.map((d) => {
              const k = dayKey(d);
              const inMonth = k.slice(0, 7) === month;
              const items = byDay.get(k) ?? [];
              return (
                <div key={k} className={cn("min-h-[104px] border-b border-r border-line p-1.5", !inMonth && "bg-paper/50")}>
                  <div className={cn("num mb-1 text-[12px]", inMonth ? "text-ink" : "text-faint", k === today && "font-semibold text-green")}>{Number(k.slice(8))}</div>
                  <ul className="flex flex-col gap-1">
                    {items.map((it) => (
                      <li key={it.id}>
                        <Link href={`/p/${slug}/studio/${it.id}`} className={cn("block truncate rounded-[4px] px-1.5 py-0.5 text-[12px]", it.status === "published" ? "bg-green-soft text-green" : "border border-dashed border-green/50 text-ink")}>
                          <span className="num">{time(new Date(it.at))}</span> {STUDIO_CHANNELS[it.channel] ?? it.channel}: {it.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-muted">Dashed: scheduled. Filled: published.</p>
      </Section>
    </>
  );
}
