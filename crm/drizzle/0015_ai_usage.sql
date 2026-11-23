CREATE TABLE "ai_usage" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "daily_request_limit" integer;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "daily_token_limit" integer;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;