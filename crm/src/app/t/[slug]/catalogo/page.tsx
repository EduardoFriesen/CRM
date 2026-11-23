import { listProducts } from "@/catalog/catalog";
import { getCurrentTenant } from "@/tenants/tenants";
import { CatalogManager } from "./catalog-manager";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const products = await listProducts(tenant.id);
  return (
    <main className="page">
      <div className="page-head">
        <h1>Catálogo</h1>
        <p className="meta">Lo que el bot puede ofrecer. Los productos pausados no se mencionan.</p>
      </div>
      <CatalogManager slug={tenant.slug} products={products} />
    </main>
  );
}
