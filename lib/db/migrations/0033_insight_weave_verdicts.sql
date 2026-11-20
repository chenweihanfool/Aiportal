CREATE TABLE "insight_weave_verdicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
