"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Users } from "lucide-react";

export interface SelectorProduct {
  slug: string;
  name: string;
  isDemo: boolean;
  /** The space it belongs to, shown when you belong to several. */
  space?: string;
  /** Set when the product is in another of your spaces (its page opens in that space). */
  switchTo?: string | null;
}

/** Always-visible product switcher. Switching keeps the current section. */
export function ProductSelector({ current, products }: { current: SelectorProduct; products: SelectorProduct[] }) {
  const pathname = usePathname();
  const section = pathname.split("/")[3] ?? "overview";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex h-9 min-w-0 max-w-[60vw] items-center gap-2 rounded-[var(--radius-control)] border border-night-line bg-night-raise pl-2 pr-2.5 text-left text-night-ink hover:border-night-muted/50 sm:max-w-[320px]"
        aria-label={`Selected product: ${current.name}. Switch product`}
      >
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-mint text-[12px] font-semibold text-night">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-[14px] font-semibold">{current.name}</span>
        <ChevronsUpDown aria-hidden className="ml-auto size-3.5 shrink-0 text-night-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-[260px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(30,38,34,0.12)]">
          {products.map((p) => (
            <DropdownMenu.Item key={p.slug} asChild>
              <Link href={`/p/${p.slug}/${section}`} prefetch={false} className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-2 text-[13.5px] outline-none data-[highlighted]:bg-sage-tint">
                <span aria-hidden className="grid size-5 place-items-center rounded-[4px] bg-green-soft text-[11px] font-semibold text-green">{p.name.slice(0, 1).toUpperCase()}</span>
                <span className="truncate">{p.name}</span>
                {p.space ? <span className="truncate text-[11.5px] text-faint">{p.space}</span> : null}
                {p.isDemo ? <span className="text-[11.5px] text-amber">demo</span> : null}
                {p.slug === current.slug ? <Check aria-label="Selected" className="ml-auto size-4 text-green" /> : null}
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link href="/start" className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-2 text-[13.5px] text-green outline-none data-[highlighted]:bg-sage-tint">
              <Plus aria-hidden className="size-4" /> Add product
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href={`/p/${current.slug}/team`} className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-2 text-[13.5px] outline-none data-[highlighted]:bg-sage-tint">
              <Users aria-hidden className="size-4" /> Spaces and people
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
