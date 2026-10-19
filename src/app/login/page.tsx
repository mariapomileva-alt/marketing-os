import { redirect } from "next/navigation";
import { authMode, getSessionUser } from "@/server/auth/session";
import { devSignInAction, magicLinkAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  const mode = authMode();
  return (
    <main className="mx-auto flex min-h-screen max-w-[400px] flex-col justify-center gap-6 px-4">
      <div>
        <p className="text-[13px] font-medium text-green">Marketing OS</p>
        <h1 className="mt-1">Sign in</h1>
      </div>
      {mode === "dev" ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-amber/40 bg-amber-tint p-4">
          <p className="text-[13px] text-amber">
            Development sign-in is on. It signs you in as the local owner without a password and is refused in production builds.
          </p>
          <form action={devSignInAction}>
            <Button variant="primary" size="lg" type="submit" className="w-full">
              Continue as local owner
            </Button>
          </form>
        </div>
      ) : (
        <ActionForm action={magicLinkAction} submitLabel="Send sign-in link" pendingLabel="Sending…">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
        </ActionForm>
      )}
    </main>
  );
}
