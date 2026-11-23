-- Entrega 2a: RLS + grants for products/agent_configs, backfill messages.author.
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "products"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "agent_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "agent_configs"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "products" TO crm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "agent_configs" TO crm_app;--> statement-breakpoint
-- The bot upserts its own message over the webhook's fromMe echo (author admin -> bot).
GRANT UPDATE ("author") ON "messages" TO crm_app;--> statement-breakpoint
-- History before 2a: inbound = customer; outbound was Flowise or a human, recorded as admin.
UPDATE "messages" SET "author" = CASE WHEN "direction" = 'in' THEN 'customer'::author ELSE 'admin'::author END WHERE "author" IS NULL;
