ALTER TABLE "hermes_status_snapshot" ADD COLUMN "storage" jsonb;--> statement-breakpoint
ALTER TABLE "hermes_status_history" ADD COLUMN "disk_used_gb" real;--> statement-breakpoint
ALTER TABLE "hermes_status_history" ADD COLUMN "disk_free_gb" real;--> statement-breakpoint
ALTER TABLE "hermes_status_history" ADD COLUMN "disk_total_gb" real;--> statement-breakpoint
ALTER TABLE "hermes_status_history" ADD COLUMN "storage" jsonb;