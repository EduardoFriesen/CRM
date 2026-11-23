CREATE TYPE "public"."author" AS ENUM('customer', 'bot', 'admin');--> statement-breakpoint
CREATE TYPE "public"."key_status" AS ENUM('unverified', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('anthropic', 'google', 'openai', 'openai-compatible');--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"business_info" text DEFAULT '' NOT NULL,
	"provider" "provider" NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"api_key_enc" text NOT NULL,
	"api_key_last4" text NOT NULL,
	"key_status" "key_status" DEFAULT 'unverified' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"disclose_ai" boolean DEFAULT true NOT NULL,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"stock" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_check" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_stock_check" CHECK ("products"."stock" >= 0)
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author" "author";--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;