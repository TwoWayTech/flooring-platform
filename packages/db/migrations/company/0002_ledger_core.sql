CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"date" date NOT NULL,
	"event" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_number" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"reverses_id" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(14, 2) NOT NULL,
	"credit" numeric(14, 2) NOT NULL,
	"location_id" uuid,
	"customer_id" uuid,
	CONSTRAINT "journal_lines_one_sided" CHECK ("journal_lines"."debit" >= 0 and "journal_lines"."credit" >= 0 and (("journal_lines"."debit" > 0) <> ("journal_lines"."credit" > 0)))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"key" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_closes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"closed_through" date NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_id_journal_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_source_event_uidx" ON "journal_entries" USING btree ("source_type","source_id","event");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "journal_entries_reverses_idx" ON "journal_entries" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_location_idx" ON "journal_lines" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "journal_lines_customer_idx" ON "journal_lines" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_key_uidx" ON "ledger_accounts" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_code_uidx" ON "ledger_accounts" USING btree ("code") WHERE "ledger_accounts"."deleted_at" is null;
--> statement-breakpoint
-- The ledger's own guarantees, in plain PostgreSQL (blueprint page 48; CLAUDE.md rules 9 to 11; ADR 0039).
-- Like audit_log (0001), they stop application bugs, not someone who owns the database.
CREATE FUNCTION "ledger_refuse_change"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_append_only" BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "journal_entries_no_truncate" BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "journal_lines_append_only" BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "journal_lines_no_truncate" BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "period_closes_append_only" BEFORE UPDATE OR DELETE ON "period_closes"
  FOR EACH ROW EXECUTE FUNCTION "ledger_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "period_closes_no_truncate" BEFORE TRUNCATE ON "period_closes"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_refuse_change"();
--> statement-breakpoint
-- Nothing posts on or before the last closed day; the newest close decides.
CREATE FUNCTION "journal_entries_open_period"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  closed date;
BEGIN
  SELECT "closed_through" INTO closed FROM "period_closes" ORDER BY "id" DESC LIMIT 1;
  IF closed IS NOT NULL AND NEW."date" <= closed THEN
    RAISE EXCEPTION 'The books are closed through %; nothing can post on %', closed, NEW."date"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_open_period" BEFORE INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "journal_entries_open_period"();
--> statement-breakpoint
-- At commit every entry has at least two lines and its debits equal its credits.
CREATE FUNCTION "journal_entry_balanced"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  entry uuid;
  line_count integer;
  difference numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry := NEW."id";
  ELSE
    entry := NEW."entry_id";
  END IF;
  SELECT count(*), coalesce(sum("debit" - "credit"), 0) INTO line_count, difference
    FROM "journal_lines" WHERE "entry_id" = entry;
  IF line_count < 2 OR difference <> 0 THEN
    RAISE EXCEPTION 'Journal entry % does not balance (% lines, difference %)', entry, line_count, difference
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_entries_balanced" AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_entry_balanced"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_entry_balanced"();
--> statement-breakpoint
-- Lines join only an entry made in the same transaction, so nothing can be added to a posted entry
-- later, even in balance (CLAUDE.md rule 9). created_at is the transaction's start time, now().
CREATE FUNCTION "journal_lines_same_transaction"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  made timestamptz;
BEGIN
  SELECT "created_at" INTO made FROM "journal_entries" WHERE "id" = NEW."entry_id";
  IF made IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'Journal entry % is already posted; lines cannot be added to it', NEW."entry_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_same_transaction" BEFORE INSERT ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "journal_lines_same_transaction"();
