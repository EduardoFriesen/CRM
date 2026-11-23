import { pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const STAGES = ["consulta", "venta", "postventa"] as const;
export type Stage = (typeof STAGES)[number];
export const stage = pgEnum("stage", STAGES);
export const direction = pgEnum("direction", ["in", "out"]);

// No RLS: the tenant registry (crm_app may only SELECT/INSERT).
export const tenants = pgTable("tenants", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  adminPhone: text("admin_phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const whatsappInstances = pgTable("whatsapp_instances", {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: tenantId().unique(),
  name: text().notNull().unique(),
  status: text().notNull().default("close"),
  secretHash: text("secret_hash").notNull(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    jid: text().notNull(),
    phone: text(),
    name: text(),
    stage: stage().notNull().default("consulta"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tenantId, t.jid)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    direction: direction().notNull(),
    body: text().notNull(),
    waMessageId: text("wa_message_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique().on(t.tenantId, t.waMessageId)],
);
