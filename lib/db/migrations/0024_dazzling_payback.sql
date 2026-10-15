CREATE TABLE "feed_snapshot" (
	"name" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
