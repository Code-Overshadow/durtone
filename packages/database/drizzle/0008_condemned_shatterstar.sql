CREATE TABLE "worker_heartbeats" (
	"service" varchar(32) PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_accounts" ADD COLUMN "status" varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_accounts" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cloud_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "status" varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "last_error" text;