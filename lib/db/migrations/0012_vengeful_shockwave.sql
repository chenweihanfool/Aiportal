CREATE TABLE "hermes_status_history" (
	"date" date PRIMARY KEY NOT NULL,
	"cpu_percent" real,
	"mem_percent" real,
	"worst_disk_percent" real,
	"containers_healthy" integer,
	"containers_total" integer,
	"tasks_failed" integer,
	"tasks_total" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hermes_pipeline_history" (
	"date" date PRIMARY KEY NOT NULL,
	"l1_health" text,
	"l2_health" text,
	"l3_health" text,
	"l4_health" text,
	"l5_health" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
