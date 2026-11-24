CREATE TABLE "business_profiles" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"hours" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"payment_methods" text DEFAULT '' NOT NULL,
	"shipping" text DEFAULT '' NOT NULL,
	"other" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "router_model" text;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "business_profiles" ("tenant_id","other") SELECT "tenant_id","business_info" FROM "agent_configs" WHERE "business_info" <> '' ON CONFLICT DO NOTHING;