CREATE TABLE "employee_manager_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"employee_id" uuid NOT NULL,
	"manager_id" uuid,
	"effective_from" date
);
--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_manager_history" ADD CONSTRAINT "employee_manager_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_manager_history" ADD CONSTRAINT "employee_manager_history_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_manager_history_employee_idx" ON "employee_manager_history" USING btree ("employee_id","effective_from");--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill (owner decision 2026-11-15; ADR 0048): every live employee gets one since-records-began
-- row (effective_from null) with today's manager, which is the manager overrides were worked out with
-- before this table, so no amount already worked out changes. created_by is the employee row's own,
-- as no person recorded these rows. Ids are UUID v7 like the app's (blueprint table rules; PostgreSQL
-- 16 has no uuidv7()): a random UUID whose first 48 bits become the Unix time in milliseconds and
-- whose version bits become 0111. Plain PostgreSQL (CLAUDE.md rule 11).
INSERT INTO "employee_manager_history" ("id", "created_by", "employee_id", "manager_id", "effective_from")
SELECT
  encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid,
  "e"."created_by",
  "e"."id",
  "e"."manager_id",
  NULL
FROM "employees" "e"
WHERE "e"."deleted_at" IS NULL;
--> statement-breakpoint
-- Backfill (owner decision 2026-11-15; ADR 0048 "Sign-in re-link"): each approved or paid statement
-- stores the employee its rep's sign-in is linked to today (live profile, live employee), which is
-- the employee pay runs paid before this column, so nothing already worked out moves. A rep with no
-- live link stays null; a draft gets its employee when it is approved.
UPDATE "commission_statements" AS "s"
SET "employee_id" = "p"."employee_id"
FROM "user_profiles" AS "p"
JOIN "employees" AS "e" ON "e"."id" = "p"."employee_id" AND "e"."deleted_at" IS NULL
WHERE "p"."user_id" = "s"."user_id"
  AND "p"."deleted_at" IS NULL
  AND "s"."employee_id" IS NULL
  AND "s"."status" <> 'draft';
