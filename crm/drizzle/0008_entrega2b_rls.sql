-- Entrega 2b: RLS + grants for escalations and learned facts; admin phone editable.
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "escalations"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "business_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "business_facts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "escalations" TO crm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "business_facts" TO crm_app;--> statement-breakpoint
GRANT UPDATE ("admin_phone") ON "tenants" TO crm_app;
