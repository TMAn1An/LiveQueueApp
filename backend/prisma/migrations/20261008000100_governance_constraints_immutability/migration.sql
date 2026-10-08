-- ADR-071: governance invariants enforced by the database, and append-only
-- governance history. Every statement is safe on a non-empty database:
-- nothing is dropped, no business row is deleted, no historical actor is
-- rewritten. The only data change is the approved normalization of the
-- retired queue-level multiple-service toggle (ADR-071 D1).

-- ---------------------------------------------------------------------------
-- 1. Retired toggle: every queue accepts one or more services. The column is
--    kept (released clients and cached portal bundles still read it) and is
--    always true from now on.
-- ---------------------------------------------------------------------------
UPDATE "queues" SET "allow_multiple_services" = true WHERE "allow_multiple_services" = false;

-- ---------------------------------------------------------------------------
-- 2. One Organization Head per organization.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "staff_one_head_per_organization"
  ON "staff" ("organization_id") WHERE "role" = 'OWNER';

-- ---------------------------------------------------------------------------
-- 3. Head succession and tenure invariants.
-- ---------------------------------------------------------------------------
-- At most one handover in progress per organization.
CREATE UNIQUE INDEX "head_successions_one_open_per_organization"
  ON "head_successions" ("organization_id")
  WHERE "status" IN ('AWAITING_VERIFICATION', 'AWAITING_ACCEPTANCE');

-- Exactly one current tenure (application guarantees at least one; the index
-- guarantees at most one).
CREATE UNIQUE INDEX "organization_head_tenures_one_current_per_organization"
  ON "organization_head_tenures" ("organization_id") WHERE "ended_at" IS NULL;

ALTER TABLE "organization_head_tenures"
  ADD CONSTRAINT "organization_head_tenures_end_after_start"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

-- A finished tenure records why it ended; an open one has no end details.
ALTER TABLE "organization_head_tenures"
  ADD CONSTRAINT "organization_head_tenures_end_fields_consistent"
  CHECK (("ended_at" IS NULL AND "end_reason" IS NULL AND "end_note" IS NULL) OR ("ended_at" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 4. A live queue always has an Admin.
--
--    A trigger rather than a CHECK constraint, deliberately:
--     - it refuses every *new* transition into "live queue without an Admin"
--       (insert, clearing admin_id, restoring an archived queue, or the
--       ON DELETE SET NULL that removing an Admin's Staff row would cause),
--       while an existing legacy row (from before ADR-069 workspaces) keeps
--       operating instead of failing every update;
--     - during organization deletion the cascade may null admin_id before it
--       removes the queue itself; once the organization row is gone that
--       intermediate step is allowed, since the queue goes with it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "livequeue_live_queue_requires_admin"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."deleted_at" IS NULL AND NEW."admin_id" IS NULL THEN
    IF TG_OP = 'INSERT' OR OLD."admin_id" IS NOT NULL OR OLD."deleted_at" IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = NEW."organization_id") THEN
        RAISE EXCEPTION 'A live queue must have an Admin (queue %)', NEW."id"
          USING ERRCODE = 'check_violation', CONSTRAINT = 'queues_live_requires_admin';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "queues_live_requires_admin"
  BEFORE INSERT OR UPDATE OF "admin_id", "deleted_at" ON "queues"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_live_queue_requires_admin"();

-- ---------------------------------------------------------------------------
-- 5. Append-only governance history.
--
--    No session flag or bypass switch exists: history rows can be removed
--    only once their organization row no longer exists — i.e. inside the
--    organization's own permanent deletion (the FK cascade, or the explicit
--    audit purge that follows it in the same transaction). Nothing else can
--    edit or delete them.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "livequeue_history_delete_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = OLD."organization_id") THEN
    RAISE EXCEPTION '% rows are append-only and are removed only with their organization', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION "livequeue_history_update_forbidden"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and cannot be changed', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- audit_logs
CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_history_update_forbidden"();
CREATE TRIGGER "audit_logs_delete_only_with_organization"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_history_delete_guard"();

-- admin_workspace_transfers
CREATE TRIGGER "admin_workspace_transfers_no_update"
  BEFORE UPDATE ON "admin_workspace_transfers"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_history_update_forbidden"();
CREATE TRIGGER "admin_workspace_transfers_delete_only_with_organization"
  BEFORE DELETE ON "admin_workspace_transfers"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_history_delete_guard"();

-- organization_head_tenures: the one permitted change is closing an open
-- tenure (ended_at, end_reason, end_note set once). Identity and start are
-- never rewritten.
CREATE FUNCTION "livequeue_tenure_update_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."ended_at" IS NOT NULL
     OR NEW."ended_at" IS NULL
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."staff_id" IS DISTINCT FROM OLD."staff_id"
     OR NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."email" IS DISTINCT FROM OLD."email"
     OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
     OR NEW."start_type" IS DISTINCT FROM OLD."start_type"
     OR NEW."predecessor_tenure_id" IS DISTINCT FROM OLD."predecessor_tenure_id"
     OR NEW."succession_id" IS DISTINCT FROM OLD."succession_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'organization_head_tenures rows are append-only; only an open tenure may be closed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "organization_head_tenures_close_only"
  BEFORE UPDATE ON "organization_head_tenures"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_tenure_update_guard"();
CREATE TRIGGER "organization_head_tenures_delete_only_with_organization"
  BEFORE DELETE ON "organization_head_tenures"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_history_delete_guard"();

-- head_successions: a handover in progress moves through its states; once
-- finished (completed, cancelled, declined or expired) it is history.
CREATE FUNCTION "livequeue_succession_update_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" NOT IN ('AWAITING_VERIFICATION', 'AWAITING_ACCEPTANCE') THEN
    RAISE EXCEPTION 'A finished head succession cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."initiated_by_staff_id" IS DISTINCT FROM OLD."initiated_by_staff_id"
     OR NEW."successor_email" IS DISTINCT FROM OLD."successor_email"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'A head succession''s parties cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "head_successions_guard_update"
  BEFORE UPDATE ON "head_successions"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_succession_update_guard"();
CREATE TRIGGER "head_successions_delete_only_with_organization"
  BEFORE DELETE ON "head_successions"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_history_delete_guard"();

-- organization_deletion_receipts: permanent.
CREATE FUNCTION "livequeue_receipt_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'organization_deletion_receipts rows are permanent'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "organization_deletion_receipts_immutable"
  BEFORE UPDATE OR DELETE ON "organization_deletion_receipts"
  FOR EACH ROW EXECUTE FUNCTION "livequeue_receipt_immutable"();
