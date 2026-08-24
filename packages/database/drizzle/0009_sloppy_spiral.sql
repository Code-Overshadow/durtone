ALTER TABLE "tenants" ADD COLUMN "country" varchar(2) DEFAULT 'BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "document_type" varchar(4);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "document_number" varchar(32);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_version" varchar(16);