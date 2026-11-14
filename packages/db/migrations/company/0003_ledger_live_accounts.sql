-- ADR 0040 (PR #19 security review): a journal line may only name a live account. A bank account
-- retired in Settings → Accounting is soft-deleted; a posting that read the settings before the
-- removal committed must roll back instead of landing on it. The API also takes a shared settings
-- lock while posting, so this is the database's second check. FOR SHARE waits for a retire still in
-- flight and re-reads the committed row (READ COMMITTED), so a path that skips the API lock can't
-- slip a line in between; a retire that starts after this lock waits behind the posting instead.
CREATE FUNCTION "journal_lines_live_account"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "ledger_accounts" WHERE "id" = NEW."account_id" AND "deleted_at" IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % is retired; nothing can post to it', NEW."account_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_live_account" BEFORE INSERT ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "journal_lines_live_account"();
