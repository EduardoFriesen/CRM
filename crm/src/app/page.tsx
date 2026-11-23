import Link from "next/link";
import { listTenants } from "@/tenants/tenants";
import { TenantForm } from "./tenant-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tenants = await listTenants();
  return (
    <main className="page">
      <header>
        <h1>Negocios</h1>
        <p className="warning" role="note">
          Pantalla interna sin login: no expongas esta app fuera de esta máquina.
        </p>
      </header>
      <section aria-labelledby="list-title">
        <h2 id="list-title">Dados de alta ({tenants.length})</h2>
        {tenants.length === 0 ? (
          <p>Todavía no hay negocios. Creá el primero con el formulario.</p>
        ) : (
          <ul className="tenant-list">
            {tenants.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.slug}`}>{t.name}</Link> <code>{t.slug}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="new-title">
        <h2 id="new-title">Nuevo negocio</h2>
        <TenantForm />
      </section>
    </main>
  );
}
