"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV } from "./nav";

function NavList({ productSlug, approvals, onNavigate }: { productSlug: string; approvals: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((g) => (
        <div key={g.group}>
          {g.group ? <p className="px-2 pb-1 text-[12px] text-night-muted/80">{g.group}</p> : null}
          <ul className="flex flex-col">
            {g.items.map((item) => {
              const href = `/p/${productSlug}/${item.slug}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const Icon = item.icon;
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    title={item.hint}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-[13.5px] text-night-ink/80 hover:bg-night-raise hover:text-night-ink",
                      active && "bg-night-raise font-medium text-mint hover:text-mint before:absolute before:-left-3 before:top-1.5 before:h-5 before:w-[2px] before:rounded-r before:bg-mint before:shadow-[0_0_10px_1px_rgba(159,220,184,.55)]",
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
                    <span className="truncate">{item.label}</span>
                    {item.slug === "approvals" && approvals > 0 ? (
                      <span className="num ml-auto rounded-full bg-mint px-1.5 text-[11.5px] font-semibold text-night" aria-label={`${approvals} waiting`}>
                        {approvals}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DesktopNav(props: { productSlug: string; approvals: number }) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-56px)] w-[232px] shrink-0 overflow-y-auto bg-night lg:block">
      <NavList {...props} />
    </aside>
  );
}

export function MobileNav(props: { productSlug: string; approvals: number }) {
  // The menu belongs to the page it was opened on: navigating anywhere closes it, with no effect needed.
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOn((typeof v === "function" ? v(open) : v) ? pathname : null);
  return (
    <>
      <button
        type="button"
        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-night-line text-night-ink lg:hidden"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>
      {open ? (
        <div className="fixed inset-0 top-14 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[272px] overflow-y-auto bg-night">
            <NavList {...props} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
