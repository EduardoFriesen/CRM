import { sql } from "drizzle-orm";
import { boolean, check, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const STAGES = ["consulta", "venta", "postventa"] as const;
export type Stage = (typeof STAGES)[number];
export const stage = pgEnum("stage", STAGES);
export const direction = pgEnum("direction", ["in", "out"]);
export const AUTHORS = ["customer", "bot", "admin"] as const;
export type Author = (typeof AUTHORS)[number];
export const author = pgEnum("author", AUTHORS);
export const PROVIDERS = ["anthropic", "google", "openai", "openai-compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const provider = pgEnum("provider", PROVIDERS);
export const KEY_STATUSES = ["unverified", "valid", "invalid"] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];
export const keyStatus = pgEnum("key_status", KEY_STATUSES);

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
    // Added nullable in 0003, backfilled in 0004, NOT NULL from 0005.
    author: author().notNull(),
    body: text().notNull(),
    waMessageId: text("wa_message_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique().on(t.tenantId, t.waMessageId)],
);

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text().notNull(),
    description: text().notNull().default(""),
    price: numeric({ precision: 12, scale: 2 }).notNull(),
    stock: integer(),
    active: boolean().notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("products_price_check", sql`${t.price} >= 0`), check("products_stock_check", sql`${t.stock} >= 0`)],
);
export type Product = typeof products.$inferSelect;

export const agentConfigs = pgTable("agent_configs", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  tone: text().notNull().default(""),
  businessInfo: text("business_info").notNull().default(""),
  provider: provider().notNull(),
  model: text().notNull(),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc").notNull(),
  apiKeyLast4: text("api_key_last4").notNull(),
  keyStatus: keyStatus("key_status").notNull().default("unverified"),
  enabled: boolean().notNull().default(false),
  discloseAi: boolean("disclose_ai").notNull().default(true),
  lastErrorCode: text("last_error_code"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AgentConfigRow = typeof agentConfigs.$inferSelect;
