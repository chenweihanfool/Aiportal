CREATE TABLE "push_pin" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"title" text NOT NULL,
	"href" text NOT NULL,
	"due_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "push_pin_due_date_idx" ON "push_pin" USING btree ("due_date") WHERE "push_pin"."done_at" is null;