import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-2.5 text-[14px] text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 aria-[invalid=true]:border-red";

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-8", className)} {...p} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-20 py-1.5 leading-relaxed", className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-8 pr-7", className)} {...p}>
      {children}
    </select>
  );
}

export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function FormMessage({ state }: { state?: { ok?: boolean; message?: string } | null }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("rounded-[var(--radius-control)] px-3 py-2 text-[13px]", state.ok ? "bg-green-soft text-green" : "bg-red-tint text-red")}>
      {state.message}
    </p>
  );
}
