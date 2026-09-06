CREATE TABLE "hermes_graph_snapshot" (
	"id" text PRIMARY KEY DEFAULT 'latest' NOT NULL,
	"events" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
