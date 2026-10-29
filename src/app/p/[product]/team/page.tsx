import { db, getAppContext, getProduct } from "@/server/context";
import { createSpaceAction, inviteAction, revokeInviteAction, switchSpaceAction } from "@/app/actions/team";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Spaces and people" };

const ROLE: Record<string, string> = { owner: "Owner: everything, including keys and account connections", editor: "Editor: makes, edits and approves content; no keys or connections" };

export default async function TeamPage({ params }: PageProps<"/p/[product]/team">) {
  const { product: slug } = await params;
  await getProduct(slug);
  const ctx = await getAppContext();
  const owner = ctx.role === "owner";
  const d = await db(async (tx) => ({
    members: await tx.query<{ email: string; role: string; created_at: string }>(
      "select u.email, m.role, m.created_at::text from workspace_members m join users u on u.id = m.user_id where m.workspace_id = $1 order by m.created_at", [ctx.workspaceId]),
    invites: await tx.query<{ id: string; email: string; role: string; accepted_at: string | null; created_at: string }>(
      "select id, email, role, accepted_at::text, created_at::text from workspace_invites where workspace_id = $1 and revoked_at is null order by created_at desc", [ctx.workspaceId]),
    products: await tx.query<{ workspace_id: string; name: string }>("select workspace_id, name from products where workspace_id = any($1) and status <> 'archived'", [ctx.spaces.map((s) => s.workspace_id)]),
  }));
  const current = ctx.spaces.find((s) => s.workspace_id === ctx.workspaceId)!;
  return (
    <>
      <PageHeader title="Spaces and people" description="A space holds one or more projects with their knowledge, content, connections and results. People you invite see only the space they are invited to." />

      <Section title="Your spaces">
        <ul className="flex flex-col gap-2">
          {ctx.spaces.map((s) => (
            <li key={s.workspace_id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-[13.5px]">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted">{d.products.filter((p) => p.workspace_id === s.workspace_id).map((p) => p.name).join(", ") || "no projects yet"}</span>
              <span className="text-faint">{s.role}</span>
              {s.workspace_id === ctx.workspaceId ? <Status tone="green">You are here</Status> : <form action={switchSpaceAction.bind(null, s.workspace_id)} className="ml-auto"><Button size="sm" variant="secondary">Open</Button></form>}
            </li>
          ))}
        </ul>
        {owner ? (
          <ActionForm action={createSpaceAction} submitLabel="Create a space" pendingLabel="Creating…" submitVariant="secondary" className="mt-4 flex flex-wrap items-end gap-3 [&_p]:basis-full [&_p]:text-[12.5px]">
            <Field label="New space" htmlFor="sp-name" hint="e.g. Momentro. Then add its project and invite people."><Input id="sp-name" name="name" placeholder="Momentro" className="w-64" /></Field>
          </ActionForm>
        ) : null}
      </Section>

      <Section title={`People in “${current.name}”`} description="Owners keep the keys: only they connect or disconnect accounts (Instagram, YouTube, Threads, TikTok, App Store) and AI keys.">
        <Table>
          <thead><tr><th>Person</th><th>Can</th><th>Since</th></tr></thead>
          <tbody>
            {d.members.map((m) => <tr key={m.email}><td>{m.email}</td><td className="text-muted">{ROLE[m.role] ?? m.role}</td><td className="text-muted">{formatDateTime(m.created_at)}</td></tr>)}
          </tbody>
        </Table>
        {d.invites.length ? (
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
            {d.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3">
                <span>{i.email}</span><span className="text-muted">{i.role}</span>
                <span className="text-faint">{i.accepted_at ? `joined ${formatDateTime(i.accepted_at)}` : `invited ${formatDateTime(i.created_at)}, not signed in yet`}</span>
                {owner ? <form action={revokeInviteAction.bind(null, slug, i.id)}><Button size="sm" variant="ghost">{i.accepted_at ? "Remove from space" : "Take back"}</Button></form> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {owner ? (
          <ActionForm action={inviteAction.bind(null, slug)} submitLabel="Invite as editor" pendingLabel="Inviting…" resetOnSuccess className="mt-4 flex flex-wrap items-end gap-3 [&_p]:basis-full [&_p]:text-[12.5px]">
            <Field label="Email" htmlFor="inv-email"><Input id="inv-email" name="email" type="email" autoComplete="off" placeholder="colleague@company.com" className="w-72" /></Field>
          </ActionForm>
        ) : <p className="mt-3 text-[13px] text-muted">Only an owner invites people.</p>}
      </Section>
    </>
  );
}
