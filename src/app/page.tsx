import { redirect } from "next/navigation";
import { listProducts } from "@/server/context";

export default async function Home() {
  const products = await listProducts();
  redirect(products.length ? `/p/${products[0].slug}/overview` : "/start");
}
