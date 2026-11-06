CREATE TABLE "companion_person_actions" (
	"name" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"until" text,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
