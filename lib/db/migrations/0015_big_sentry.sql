CREATE TABLE "hermes_doc" (
	"kind" text NOT NULL,
	"doc_key" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_path" text,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hermes_doc_kind_doc_key_pk" PRIMARY KEY("kind","doc_key")
);
--> statement-breakpoint
CREATE INDEX "hermes_doc_kind_idx" ON "hermes_doc" USING btree ("kind");