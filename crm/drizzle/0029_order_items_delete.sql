-- Editing a pending order replaces its lines. Orders themselves are still never deleted.
GRANT DELETE ON "order_items" TO crm_app;
