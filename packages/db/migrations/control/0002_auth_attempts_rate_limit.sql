CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE INDEX "auth_attempts_subject_kind_idx" ON "auth_attempts" USING btree ("subject","kind","created_at");