CREATE TABLE "hermes_ideas_snapshot" (
	"id" text PRIMARY KEY DEFAULT 'latest' NOT NULL,
	"ideas" jsonb NOT NULL,
	"weeks" jsonb NOT NULL,
	"generated_at" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
