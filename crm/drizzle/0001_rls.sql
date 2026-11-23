-- Tenant isolation. RLS is ENABLEd but not FORCEd: the owner role (crm) runs migrations
-- and resolve_instance(); the app connects as crm_app, which is always subject to it.
ALTER TABLE "whatsapp_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "whatsapp_instances"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contacts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "messages"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "tenants" TO crm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "whatsapp_instances", "contacts", "messages" TO crm_app;--> statement-breakpoint
-- The webhook must find an instance's tenant before it has a tenant context.
CREATE FUNCTION resolve_instance(p_name text)
  RETURNS TABLE (tenant_id uuid, secret_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT w.tenant_id, w.secret_hash FROM whatsapp_instances w WHERE w.name = p_name $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_instance(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_instance(text) TO crm_app;
