CREATE TABLE "hermes_pipeline_snapshot" (
	"id" text PRIMARY KEY DEFAULT 'latest' NOT NULL,
	"l1" jsonb,
	"l2" jsonb,
	"l3" jsonb,
	"l4" jsonb,
	"l5" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
