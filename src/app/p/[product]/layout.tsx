import Link from "next/link";
import { db, getAppContext, getProduct, listProducts } from "@/server/context";
import { DesktopNav, MobileNav } from "@/components/shell/sidebar";
import { ProductSelector } from "@/components/shell/product-selector";
import { signOutAction } from "@/app/actions/auth";
import { Status } from "@/components/ui/status";

export default async function ProductLayout({ children, params }: LayoutProps<"/p/[product]">) {
  const { product: slug } = await params;
  const ctx = await getAppContext();
  const [product, products] = await Promise.all([getProduct(slug), listProducts()]);
  const { approvals, problems } = await db(async (tx) => {
    const a = await tx.one<{ n: number }>("select count(*)::int n from approval_items where product_id = $1 and state = 'pending'", [product.id]);
    const c = await tx.one<{ n: number }>(
      `select (select count(*) from channel_connections where product_id = $1 and status in ('paused','error'))
            + (select count(*) from ai_provider_connections where workspace_id = $2 and status = 'error') as n`,
      [product.id, ctx.workspaceId],
    );
    return { approvals: a.n, problems: Number(c.n) };
  });

  return (
    <div className="min-h-screen">
      {ctx.user.mode === "dev" ? (
        <div className="bg-amber-tint px-4 py-1 text-center text-[12px] text-amber">Development sign-in: local owner without password. Not for production.</div>
      ) : null}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-paper/95 px-3 backdrop-blur sm:px-4">
        <MobileNav productSlug={product.slug} approvals={approvals} />
        <Link href={`/p/${product.slug}/overview`} className="hidden text-[13px] font-semibold text-green lg:block lg:w-[208px]">
          Marketing OS
        </Link>
        <ProductSelector current={{ slug: product.slug, name: product.name, isDemo: product.is_demo }} products={products.map((p) => ({ slug: p.slug, name: p.name, isDemo: p.is_demo }))} />
        <div className="ml-auto flex items-center gap-3">
          <Link href={`/p/${product.slug}/connections`} className="hidden sm:block" aria-label={problems ? `${problems} integration problems` : "Integrations healthy"}>
            {problems ? <Status tone="red">{problems} integration {problems === 1 ? "problem" : "problems"}</Status> : <Status tone="green">Integrations OK</Status>}
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="text-[13px] text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="flex">
        <DesktopNav productSlug={product.slug} approvals={approvals} />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
