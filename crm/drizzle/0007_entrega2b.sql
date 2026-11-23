CREATE TYPE "public"."escalation_status" AS ENUM('pending', 'answered');--> statement-breakpoint
CREATE TABLE "business_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"escalation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"question" text NOT NULL,
	"is_price" boolean NOT NULL,
	"admin_message_id" text NOT NULL,
	"status" "escalation_status" DEFAULT 'pending' NOT NULL,
	"answer" text,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "escalations_tenant_id_admin_message_id_unique" UNIQUE("tenant_id","admin_message_id")
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "pause_hours" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "admin_hint_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bot_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_pause_hours_check" CHECK ("agent_configs"."pause_hours" between 1 and 168);