ALTER TABLE "tenants" ADD COLUMN "maintenance_reason" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing companies start their life-cycle periods now, the most generous choice (owner decision, 2026-11-13).
-- Every status change stamps status_changed_at, whoever writes it, and no other update can move it,
-- so the life-cycle periods can be neither skipped nor extended by a write. A new company starts
-- its clock when it is created, whatever the insert says (PR #10 reviews).
CREATE FUNCTION tenants_stamp_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  ELSE
    NEW.status_changed_at := OLD.status_changed_at;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tenants_status_changed BEFORE INSERT OR UPDATE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION tenants_stamp_status_change();
