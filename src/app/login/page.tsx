import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authMode, getSessionUser } from "@/server/auth/session";
import { missingHostedSettings } from "@/server/env";
import { devSignInAction, magicLinkAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await connection();
  const missing = missingHostedSettings();
  if (missing.length) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center gap-4 px-4">
        <p className="text-[13px] font-medium text-green">Marketing OS</p>
        <h1>Setup is not finished</h1>
        <p className="text-muted">This deployment cannot reach its database or sign-in yet. These settings are missing in the hosting environment:</p>
        <ul className="list-disc pl-5 font-mono text-[13px]">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">Connect the Supabase project to this Vercel project (Supabase → Project Settings → Integrations → Vercel), then redeploy.</p>
      </main>
    );
  }
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
