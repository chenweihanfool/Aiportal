CREATE TABLE "search_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"q" text NOT NULL,
	"kind" text,
	"total" integer NOT NULL,
	"clicked_kind" text,
	"clicked_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
