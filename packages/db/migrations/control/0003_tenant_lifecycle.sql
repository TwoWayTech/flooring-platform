ALTER TABLE "tenants" ADD COLUMN "maintenance_reason" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing companies start their life-cycle periods now, the most generous choice (owner decision, 2026-11-13).
-- Every status change stamps status_changed_at, whoever writes it, so the periods cannot be skipped.
CREATE FUNCTION tenants_stamp_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tenants_status_changed BEFORE UPDATE OF status ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION tenants_stamp_status_change();
