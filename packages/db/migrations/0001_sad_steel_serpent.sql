ALTER TABLE "campaign_steps" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD COLUMN "body_blocks" jsonb;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;