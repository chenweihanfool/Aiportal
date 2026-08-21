CREATE TABLE "social_index_history" (
	"date" date PRIMARY KEY NOT NULL,
	"observed_day_count" smallint NOT NULL,
	"distinct_person_count" smallint,
	"weighted_interaction_points" real,
	"days_with_interaction" smallint,
	"breadth_score" real,
	"intensity_score" real,
	"connection_rate_score" real,
	"social_score" smallint,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mind_index_history" ADD COLUMN "diary_entry_count_3day" integer;