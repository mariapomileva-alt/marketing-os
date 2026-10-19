import Link from "next/link";
import { cn } from "@/lib/cn";

/** URL-driven tabs: each view has its own link, so it can be bookmarked and works without JavaScript. */
export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: ReadonlyArray<{ id: string; label: string; count?: number }> }) {
  return (
    <nav aria-label="Views" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={`${base}?tab=${t.id}`}
          aria-current={current === t.id ? "page" : undefined}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] text-muted hover:text-ink", current === t.id ? "border-green font-medium text-ink" : "border-transparent")}
        >
          {t.label}
          {t.count !== undefined ? <span className="num ml-1.5 text-faint">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function tabParam(sp: Record<string, string | string[] | undefined>, allowed: readonly string[], fallback: string): string {
  const t = typeof sp.tab === "string" ? sp.tab : fallback;
  return allowed.includes(t) ? t : fallback;
}
