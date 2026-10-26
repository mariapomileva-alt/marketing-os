"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { setBriefLangAction } from "@/app/actions/brief";

/**
 * EN / RU switch for the brief's text or voice. The choice is a per-browser convenience kept in a cookie, so the page
 * renders in the chosen language straight away on the next visit.
 */
export function LangSwitch({ cookie, value, label }: { cookie: "mos_text_lang" | "mos_voice_lang"; value: "en" | "ru"; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (v: "en" | "ru") => {
    if (v === value) return;
    start(async () => {
      await setBriefLangAction(cookie, v);
      router.refresh();
    });
  };
  return (
    <div role="group" aria-label={label} className={cn("inline-flex items-center gap-2 text-[12px] text-night-muted", pending && "opacity-60")}>
      <span>{label}</span>
      <span className="inline-flex rounded-[5px] border border-night-line p-0.5">
        {(["en", "ru"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === value}
            onClick={() => set(v)}
            className={cn(
              "h-6 min-w-8 rounded-[3px] px-2 text-[11.5px] font-semibold tracking-[0.04em] transition-colors",
              v === value ? "bg-mint text-night" : "text-night-muted hover:text-night-ink",
            )}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </span>
    </div>
  );
}
