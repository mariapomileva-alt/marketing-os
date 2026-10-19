import { ZodError } from "zod";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export const ok = (message: string): ActionResult => ({ ok: true, message });
export const fail = (message: string): ActionResult => ({ ok: false, message });

/** Turns validation and database errors into a sentence that says what went wrong and how to fix it. */
export function toFailure(error: unknown, describe?: (e: unknown) => string): ActionResult {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return fail(`${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}`);
  }
  if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) throw error;
  return fail(describe ? describe(error) : error instanceof Error ? error.message : "Something went wrong.");
}

export function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function str(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}
