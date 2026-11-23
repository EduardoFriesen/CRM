-- The bot claims its own message over the webhook echo and places it right after the
-- last message its reply covered (see bot/reply.ts): it needs to update sent_at too.
GRANT UPDATE ("sent_at") ON "messages" TO crm_app;
