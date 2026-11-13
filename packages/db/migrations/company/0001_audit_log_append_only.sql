-- audit_log is append-only (blueprint "Security": audit log; CLAUDE.md rule 10; ADR 0031).
-- The company's own login owns this database, so a GRANT cannot stop it; this trigger refuses every
-- UPDATE, DELETE and TRUNCATE instead, whoever runs it. Plain PostgreSQL, no extensions (rule 11).
CREATE FUNCTION "audit_log_refuse_change"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_refuse_change"();
