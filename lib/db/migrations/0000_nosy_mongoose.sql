CREATE TABLE "portal_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"links" jsonb NOT NULL,
	"world_x" real NOT NULL,
	"world_z" real NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"subsystem_id" text
);
--> statement-breakpoint
CREATE TABLE "subsystem_summaries" (
	"subsystem_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"is_private" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busyness_index_history" (
	"date" date PRIMARY KEY NOT NULL,
	"score" smallint NOT NULL,
	"overdue_score" smallint,
	"load_score" smallint,
	"stagnation_score" smallint,
	"completion_score" smallint,
	"approximated_count" smallint DEFAULT 0 NOT NULL,
	"null_components" text[] DEFAULT '{}' NOT NULL,
	"config_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "happiness_index_history" (
	"date" date PRIMARY KEY NOT NULL,
	"final_score" smallint NOT NULL,
	"displayed_score" smallint NOT NULL,
	"base_score" real NOT NULL,
	"weakest_score" real NOT NULL,
	"weakest_component" text NOT NULL,
	"available_components" text[] NOT NULL,
	"config_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
