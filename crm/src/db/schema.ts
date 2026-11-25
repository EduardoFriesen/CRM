import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, numeric, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const STAGES = ["consulta", "venta", "postventa"] as const;
export type Stage = (typeof STAGES)[number];
export const stage = pgEnum("stage", STAGES);
export const direction = pgEnum("direction", ["in", "out"]);
export const AUTHORS = ["customer", "bot", "admin"] as const;
export type Author = (typeof AUTHORS)[number];
export const author = pgEnum("author", AUTHORS);
export const PROVIDERS = ["anthropic", "google", "openai", "openai-compatible", "ollama"] as const;
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
  // Consultas without activity for longer than this leave the board.
  consultaIdleDays: smallint("consulta_idle_days").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("tenants_consulta_idle_days_range", sql`${t.consultaIdleDays} between 1 and 30`)]);

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
    botPausedUntil: timestamp("bot_paused_until", { withTimezone: true }),
    // Off until someone turns it back on (no expiry, unlike the admin's pause).
    botOff: boolean("bot_off").notNull().default(false),
    // Set when the bot handed the chat to a person without a sale: the card shows it in red.
    attentionReason: text("attention_reason"),
    attentionAt: timestamp("attention_at", { withTimezone: true }),
    // Off the board (null = on it); a customer message reopens it as a new conversation.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // The bot's conversation starts here after a reopen.
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reachedVentaAt: timestamp("reached_venta_at", { withTimezone: true }),
    // Last time the contact (re)entered Consulta: the hourly reply cap counts from here.
    consultaSince: timestamp("consulta_since", { withTimezone: true }),
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
    // A bot reply sent in the same turn as handoff_to_admin: replayed to the model as a tool call.
    handoff: boolean().notNull().default(false),
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

export const agentConfigs = pgTable(
  "agent_configs",
  {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  tone: text().notNull().default(""),
  // Cheaper model for the FAQ router; null = use the main model.
  routerModel: text("router_model"),
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
  pauseHours: integer("pause_hours").notNull().default(12),
  adminHintAt: timestamp("admin_hint_at", { withTimezone: true }),
  // Copied by the tenant from their AI plan; null = no limit known.
  dailyRequestLimit: integer("daily_request_limit"),
  dailyTokenLimit: integer("daily_token_limit"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("agent_configs_pause_hours_check", sql`${t.pauseHours} between 1 and 168`)],
);
export type AgentConfigRow = typeof agentConfigs.$inferSelect;

export const escalationStatus = pgEnum("escalation_status", ["pending", "answered", "dismissed"]);

export const escalations = pgTable(
  "escalations",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    question: text().notNull(),
    isPrice: boolean("is_price").notNull(),
    // false when the answer only applies to this customer (their order, their booking).
    isGeneral: boolean("is_general").notNull().default(true),
    adminMessageId: text("admin_message_id").notNull(),
    status: escalationStatus().notNull().default("pending"),
    answer: text(),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    // The admin may answer by quoting the reminder instead of the original question.
    reminderMessageId: text("reminder_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.tenantId, t.adminMessageId)],
);
export type Escalation = typeof escalations.$inferSelect;

export const businessFacts = pgTable("business_facts", {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: tenantId(),
  question: text().notNull(),
  answer: text().notNull(),
  escalationId: uuid("escalation_id").references(() => escalations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type BusinessFact = typeof businessFacts.$inferSelect;

export const ORDER_STATUSES = ["pending", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatus = pgEnum("order_status", ORDER_STATUSES);

export const orders = pgTable("orders", {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: tenantId(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  status: orderStatus().notNull().default("pending"),
  deliveryDate: date("delivery_date").notNull(),
  address: text().notNull(),
  locality: text().notNull().default(""),
  notes: text().notNull().default(""),
  total: numeric({ precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});
export type Order = typeof orders.$inferSelect;

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // Kept (as null) when the product is deleted; name and price are copies.
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    quantity: integer().notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
    // true when creating the order decremented the product's stock; cancel returns only these.
    stockTaken: boolean("stock_taken").notNull().default(false),
  },
  (t) => [check("order_items_quantity_check", sql`${t.quantity} > 0`)],
);
export type OrderItem = typeof orderItems.$inferSelect;

// Structured facts about the business the bot may quote; one row per tenant.
export const businessProfiles = pgTable("business_profiles", {
  tenantId: tenantId().primaryKey(),
  hours: text().notNull().default(""),
  address: text().notNull().default(""),
  paymentMethods: text("payment_methods").notNull().default(""),
  shipping: text().notNull().default(""),
  other: text().notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Daily AI consumption per tenant (Buenos Aires calendar day), for the usage bar.
export const aiUsage = pgTable(
  "ai_usage",
  {
    tenantId: tenantId(),
    day: date().notNull(),
    requests: integer().notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    replies: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] })],
);

// Which path answered each customer turn. Metrics only: never the message text.
export const BOT_PATHS = ["silence", "prefilter", "faq", "complex", "handoff", "relay", "example"] as const;
export const botPath = pgEnum("bot_path", BOT_PATHS);

export const botEvents = pgTable(
  "bot_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    path: botPath().notNull(),
    fn: text(),
    model: text(),
    routerModel: text("router_model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    routerInputTokens: integer("router_input_tokens").notNull().default(0),
    routerOutputTokens: integer("router_output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    outcome: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bot_events_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// Shortcuts the main model marked as answerable by a cheap function: an identical message is
// answered without a model, and recent ones guide the router. Never linked to a contact.
export const routerExamples = pgTable(
  "router_examples",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    key: text().notNull(),
    text: text().notNull(),
    fn: text().notNull(),
    factId: uuid("fact_id").references(() => businessFacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("router_examples_tenant_key_unique").on(t.tenantId, t.key)],
);
export type RouterExampleRow = typeof routerExamples.$inferSelect;
