-- Least privilege for crm_app: messages are append-only; instances only change
-- their connection status and (on re-creation) their webhook secret hash.
REVOKE UPDATE ON "messages" FROM crm_app;--> statement-breakpoint
REVOKE UPDATE ON "whatsapp_instances" FROM crm_app;--> statement-breakpoint
GRANT UPDATE ("status", "secret_hash") ON "whatsapp_instances" TO crm_app;
