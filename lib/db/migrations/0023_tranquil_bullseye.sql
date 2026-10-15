CREATE TABLE "hermes_trips_snapshot" (
	"id" text PRIMARY KEY DEFAULT 'latest' NOT NULL,
	"trips" jsonb NOT NULL,
	"generated_at" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
