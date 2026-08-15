CREATE TABLE "hermes_status_snapshot" (
	"id" text PRIMARY KEY DEFAULT 'latest' NOT NULL,
	"cpu_percent" real,
	"mem_percent" real,
	"disks" jsonb,
	"containers" jsonb,
	"scheduled_tasks" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hermes_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
