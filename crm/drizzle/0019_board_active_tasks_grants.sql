-- crm_app writes only the new columns it needs (contacts already has table-wide UPDATE).
GRANT UPDATE ("handoff") ON "messages" TO crm_app;--> statement-breakpoint
GRANT UPDATE ("consulta_idle_days") ON "tenants" TO crm_app;
