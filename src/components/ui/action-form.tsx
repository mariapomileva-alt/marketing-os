"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { FormMessage } from "./form";
import type { ActionResult } from "@/lib/action-result";

/** Form bound to a server action that returns { ok, message }. Shows the result and a pending state. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  className,
  resetOnSuccess = false,
  submitVariant = "primary",
  hideSubmit = false,
}: {
  action: (prev: ActionResult | null, data: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitVariant?: "primary" | "secondary" | "danger" | "ghost";
  hideSubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className ?? "flex flex-col gap-3"}>
      {children}
      <FormMessage state={state} />
      {hideSubmit ? null : (
        <div>
          <Button type="submit" variant={submitVariant} disabled={pending}>
            {pending ? (pendingLabel ?? "Saving…") : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
