CREATE TABLE "mind_index_history" (
	"date" date PRIMARY KEY NOT NULL,
	"score" real NOT NULL,
	"conversion" real,
	"link_health" real,
	"vitality" real,
	"rhythm" real,
	"rhythm_trend_pct" real,
	"partial" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
