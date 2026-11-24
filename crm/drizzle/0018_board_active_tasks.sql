ALTER TABLE "contacts" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "reached_venta_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "handoff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "consulta_idle_days" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_consulta_idle_days_range" CHECK ("tenants"."consulta_idle_days" between 1 and 30);