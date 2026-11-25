ALTER TABLE "contacts" ADD COLUMN "bot_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "attention_reason" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "attention_at" timestamp with time zone;