CREATE TABLE "hermes_timeline_entry" (
	"level" text NOT NULL,
	"period_key" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body_md" text NOT NULL,
	"generation" integer DEFAULT 3 NOT NULL,
	"range_inferred" boolean DEFAULT false NOT NULL,
	"period_note" text,
	"source_path" text,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hermes_timeline_entry_level_period_key_pk" PRIMARY KEY("level","period_key")
);
--> statement-breakpoint
CREATE INDEX "hermes_timeline_entry_level_start_idx" ON "hermes_timeline_entry" USING btree ("level","start_date");