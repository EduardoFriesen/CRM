CREATE TYPE "public"."bot_path" AS ENUM('silence', 'prefilter', 'faq', 'complex', 'handoff', 'relay');--> statement-breakpoint
CREATE TABLE "bot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"path" "bot_path" NOT NULL,
	"fn" text,
	"model" text,
	"router_model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"router_input_tokens" integer DEFAULT 0 NOT NULL,
	"router_output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_events_tenant_created_idx" ON "bot_events" USING btree ("tenant_id","created_at");