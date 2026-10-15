CREATE TABLE "hermes_places_snapshot" (
	"id" text PRIMARY KEY DEFAULT 'latest' NOT NULL,
	"places" jsonb NOT NULL,
	"generated_at" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
