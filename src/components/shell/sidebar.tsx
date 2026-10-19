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
          <p className="px-2 pb-1 text-[12px] text-faint">{g.group}</p>
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
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-[13.5px] text-ink/85 hover:bg-sage-tint hover:text-ink",
                      active && "bg-green-soft font-medium text-green hover:bg-green-soft hover:text-green",
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
                    <span className="truncate">{item.label}</span>
                    {item.slug === "approvals" && approvals > 0 ? (
                      <span className="num ml-auto rounded-full bg-amber-tint px-1.5 text-[11.5px] font-medium text-amber" aria-label={`${approvals} waiting`}>
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
    <aside className="sticky top-14 hidden h-[calc(100vh-56px)] w-[232px] shrink-0 overflow-y-auto border-r border-line bg-paper lg:block">
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
        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface lg:hidden"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>
      {open ? (
        <div className="fixed inset-0 top-14 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[272px] overflow-y-auto border-r border-line bg-paper">
            <NavList {...props} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
