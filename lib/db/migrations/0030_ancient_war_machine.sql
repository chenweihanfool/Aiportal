CREATE TABLE "push_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_key" text NOT NULL,
	"card_kind" text NOT NULL,
	"action" text NOT NULL,
	"for_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "push_feedback_card_key_for_date_idx" ON "push_feedback" USING btree ("card_key","for_date");