CREATE TABLE "hermes_usage_daily" (
	"date" date PRIMARY KEY NOT NULL,
	"models" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ollama_balance_entry" (
	"id" serial PRIMARY KEY NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"balance_usd" double precision NOT NULL,
	"cap_usd" double precision DEFAULT 60 NOT NULL,
	"refill_at" date,
	"month_used_usd" double precision,
	"note" text
);
