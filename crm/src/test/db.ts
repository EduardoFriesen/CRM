import { randomUUID } from "node:crypto";
import postgres from "postgres";

// Owner connection: bypasses RLS (table owner, RLS not forced). Test seeding/cleanup only.
const url = process.env.CRM_TEST_OWNER_URL;
if (!url) throw new Error("CRM_TEST_OWNER_URL is required");
export const ownerSql = postgres(url, { max: 2, onnotice: () => {} });

const created: string[] = [];

export async function makeTenant(): Promise<{ id: string; slug: string }> {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const [row] = await ownerSql<{ id: string }[]>`
    insert into tenants (slug, name, admin_phone) values (${slug}, ${"Test " + slug}, ${"5491100000000"})
    returning id`;
  created.push(row.id);
  return { id: row.id, slug };
}

export async function makeContact(
  tenantId: string,
  fields: { jid?: string; phone?: string | null; name?: string } = {},
): Promise<{ id: string; jid: string }> {
  const jid = fields.jid ?? `549${Math.floor(Math.random() * 1e10)}@s.whatsapp.net`;
  const [row] = await ownerSql<{ id: string }[]>`
    insert into contacts (tenant_id, jid, phone, name)
    values (${tenantId}, ${jid}, ${fields.phone ?? null}, ${fields.name ?? null})
    returning id`;
  return { id: row.id, jid };
}

export async function makeInstance(tenantId: string, name: string, secretHash: string): Promise<void> {
  await ownerSql`insert into whatsapp_instances (tenant_id, name, secret_hash) values (${tenantId}, ${name}, ${secretHash})`;
}

export async function dropTenants(): Promise<void> {
  if (created.length) await ownerSql`delete from tenants where id = any(${created})`;
  created.length = 0;
}
