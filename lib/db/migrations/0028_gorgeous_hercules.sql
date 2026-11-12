CREATE TABLE "knowledge_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"claim_id" text,
	"kind" text NOT NULL,
	"section" text,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
