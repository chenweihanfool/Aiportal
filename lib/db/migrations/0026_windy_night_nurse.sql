CREATE TABLE "hermes_chat_state" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hermes_restart_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
