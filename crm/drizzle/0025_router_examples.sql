CREATE TABLE "router_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"fn" text NOT NULL,
	"fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_examples_tenant_key_unique" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "router_examples" ADD CONSTRAINT "router_examples_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "router_examples" ADD CONSTRAINT "router_examples_fact_id_business_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."business_facts"("id") ON DELETE cascade ON UPDATE no action;