import Link from "next/link";
import { getAppContext, listProducts } from "@/server/context";
import { createBackAppAction, createDemoProductAction, createProductAction } from "@/app/actions/products";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";

export const metadata = { title: "Add a product" };

export default async function StartPage() {
  await getAppContext();
  const products = await listProducts();
  const hasBackApp = products.some((p) => p.slug === "back-app");
  const hasDemo = products.some((p) => p.slug === "demo-calm");
  return (
    <main className="mx-auto max-w-[720px] px-4 py-12">
      <p className="text-[13px] font-medium text-green">God of Marketing</p>
      <h1 className="mt-1">{products.length ? "Add a product" : "Set up your first product"}</h1>
      <p className="prose-measure mt-2 text-muted">
        Each product keeps its own knowledge, audiences, content, experiments and results. Nothing is shared between products except the course
        methodology in the knowledge base.
      </p>

      {!hasBackApp ? (
        <section className="mt-8 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="text-[16px]">Back App, with its safety rules</h2>
          <p className="prose-measure mt-1 text-[13px] text-muted">
            Creates Back App with the rules from your brief: not medical treatment, no cure promises, no diagnosis, no false urgency or fear, never a
            replacement for a doctor, therapist or emergency service, calm and warm tone. You can review every rule afterwards.
          </p>
          <form action={createBackAppAction} className="mt-4">
            <Button variant="primary" type="submit">
              Create Back App
            </Button>
          </form>
        </section>
      ) : null}

      <section className="mt-6 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="text-[16px]">Another product</h2>
        <ActionForm action={createProductAction} submitLabel="Create product" pendingLabel="Creating…" className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required maxLength={80} placeholder="MyTeam Space" />
          </Field>
          <Field label="Short address" htmlFor="slug" hint="Used in links. Leave empty to make it from the name.">
            <Input id="slug" name="slug" pattern="[a-z0-9][a-z0-9-]{1,47}" placeholder="myteam-space" />
          </Field>
          <Field label="Category" htmlFor="category">
            <Input id="category" name="category" maxLength={120} />
          </Field>
          <Field label="Website" htmlFor="website_url">
            <Input id="website_url" name="website_url" type="url" placeholder="https://" />
          </Field>
          <Field label="Short description" htmlFor="short_description" className="sm:col-span-2">
            <Textarea id="short_description" name="short_description" maxLength={400} />
          </Field>
        </ActionForm>
      </section>
      {!hasDemo ? (
        <section className="mt-6 rounded-[var(--radius-panel)] border border-dashed border-line-strong p-5">
          <h2 className="text-[16px]">A demo product to try Analytics</h2>
          <p className="prose-measure mt-1 text-[13px] text-muted">
            Adds “Demo: Calm app” with 17 invented publications, metrics and registrations, all marked as demo. It stays separate from your real
            products, and you can archive it later.
          </p>
          <form action={createDemoProductAction} className="mt-4">
            <Button type="submit">Add demo product</Button>
          </form>
        </section>
      ) : null}

      {products.length ? (
        <p className="mt-6 text-[13px]">
          <Link className="text-green underline underline-offset-2" href={`/p/${products[0].slug}/overview`}>
            Back to {products[0].name}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
