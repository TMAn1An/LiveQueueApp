-- ADR-035. Three changes in one migration, because the first two share the
-- queue's timezone and the third is independent but ships together.
--
--  1. Repeat restrictions become a custom window (a duration, a fixed cutoff,
--     or once-ever) instead of the four fixed periods.
--  2. Timezone gains an organization-level default that queues inherit.
--  3. Staff invitations get their own hashed, expiring, single-use token.
--
-- Nothing is dropped that holds data. `repeat_restriction_period` and
-- `period_key` are both KEPT — the columns that replace them are populated
-- from their values below, and the originals stay readable afterwards.
-- `period_key` only loses its NOT NULL, since new claims no longer have a
-- fixed window to name. The one dropped object is a unique INDEX, replaced
-- immediately by an equivalent one; no row is deleted or rewritten away.

-- CreateEnum
CREATE TYPE "RepeatRestrictionType" AS ENUM ('ONCE_EVER', 'DURATION', 'UNTIL_DATETIME');

-- CreateEnum
CREATE TYPE "RepeatRestrictionUnit" AS ENUM ('MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "repeat_restriction_amount" INTEGER,
ADD COLUMN     "repeat_restriction_type" "RepeatRestrictionType",
ADD COLUMN     "repeat_restriction_unit" "RepeatRestrictionUnit",
ADD COLUMN     "repeat_restriction_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "queue_identity_claims" ADD COLUMN     "claim_slot" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "consumed_at" TIMESTAMP(3),
ADD COLUMN     "eligible_again_at" TIMESTAMP(3),
ADD COLUMN     "superseded_at" TIMESTAMP(3),
ALTER COLUMN "period_key" DROP NOT NULL;

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "invitation_expires_at" TIMESTAMP(3),
ADD COLUMN     "invitation_sent_at" TIMESTAMP(3),
ADD COLUMN     "invitation_token_hash" TEXT;

-- ---------------------------------------------------------------------------
-- Data: carry every configured queue policy into the new columns.
--
-- The mapping preserves each queue's intent exactly. DAILY/WEEKLY/MONTHLY
-- become a 1 day / 1 week / 1 month DURATION. Note this is a real semantic
-- shift for the recurring three: the old rule freed a customer at the next
-- local midnight, the new one frees them a full day/week/month after their
-- visit. That direction is deliberate — it can only ever hold someone longer,
-- never let them back sooner, which is the safe way to be wrong about a
-- limit an organization asked for. Individual claims keep their exact old
-- expiry (below), so nobody already waiting is affected by the shift.
-- ---------------------------------------------------------------------------
UPDATE "queues" SET
  "repeat_restriction_type" = CASE "repeat_restriction_period"
    WHEN 'ONCE_EVER' THEN 'ONCE_EVER'::"RepeatRestrictionType"
    ELSE 'DURATION'::"RepeatRestrictionType"
  END,
  "repeat_restriction_amount" = CASE WHEN "repeat_restriction_period" = 'ONCE_EVER' THEN NULL ELSE 1 END,
  "repeat_restriction_unit" = CASE "repeat_restriction_period"
    WHEN 'DAILY' THEN 'DAY'::"RepeatRestrictionUnit"
    WHEN 'WEEKLY' THEN 'WEEK'::"RepeatRestrictionUnit"
    WHEN 'MONTHLY' THEN 'MONTH'::"RepeatRestrictionUnit"
    ELSE NULL
  END
WHERE "repeat_restriction_period" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Data: give every already-recorded visit the exact moment it used to expire.
--
-- This is computed from the claim's own period_key rather than from the
-- queue's new duration, so an existing customer's wait is neither shortened
-- nor extended by this migration — '2026-09-08' under DAILY still frees them
-- at local midnight on the 9th, exactly as it did before. 'EVER' stays NULL,
-- which means never.
--
-- consumed_at is backfilled from updated_at: the row's last write was the
-- transition to CONSUMED, so it is the best record of when the visit landed.
-- RESERVED claims get neither column — an active token blocks on its own.
-- ---------------------------------------------------------------------------
UPDATE "queue_identity_claims" c SET
  "consumed_at" = c."updated_at",
  "eligible_again_at" = CASE
    WHEN c."period_key" = 'EVER' THEN NULL
    -- 'YYYY-MM-DD' — next local midnight after that day.
    WHEN c."period_key" ~ '^\d{4}-\d{2}-\d{2}$'
      THEN ((c."period_key"::date + INTERVAL '1 day') AT TIME ZONE COALESCE(q."timezone", 'UTC'))
    -- 'YYYY-Www' — the Monday after that ISO week.
    WHEN c."period_key" ~ '^\d{4}-W\d{2}$'
      THEN ((to_date(c."period_key", 'IYYY-"W"IW') + INTERVAL '1 week') AT TIME ZONE COALESCE(q."timezone", 'UTC'))
    -- 'YYYY-MM' — the first local midnight of the following month.
    WHEN c."period_key" ~ '^\d{4}-\d{2}$'
      THEN ((to_date(c."period_key", 'YYYY-MM') + INTERVAL '1 month') AT TIME ZONE COALESCE(q."timezone", 'UTC'))
    ELSE NULL
  END
FROM "queues" q
WHERE q."id" = c."queue_id" AND c."status" = 'CONSUMED';

-- ---------------------------------------------------------------------------
-- Data: exactly one claim per (queue, identity) may govern eligibility.
--
-- The old unique index allowed several — one per period — so a customer who
-- visited a DAILY queue three times has three rows. The newest is the one
-- that decides whether they may return; the rest become history. History is
-- kept, never deleted: superseded rows take their own id as their slot value,
-- which is unique by construction and so can never collide with anything.
-- ---------------------------------------------------------------------------
UPDATE "queue_identity_claims" SET
  "claim_slot" = "id",
  "superseded_at" = NOW()
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("queue_id", "identity_fingerprint") "id"
  FROM "queue_identity_claims"
  ORDER BY "queue_id", "identity_fingerprint", "created_at" DESC, "id" DESC
);

-- DropIndex
DROP INDEX "queue_identity_claims_queue_id_identity_fingerprint_period__key";

-- CreateIndex
CREATE INDEX "queue_identity_claims_queue_id_identity_fingerprint_idx" ON "queue_identity_claims"("queue_id", "identity_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "queue_identity_claims_queue_id_identity_fingerprint_claim_s_key" ON "queue_identity_claims"("queue_id", "identity_fingerprint", "claim_slot");
