-- ADR-071: governance history (Head tenure and succession, Admin workspace
-- transfers, organization deletion receipts) and service-step name snapshots.
-- Additive only: new enums, tables and nullable columns, plus deterministic backfills.

-- CreateEnum
CREATE TYPE "HeadTenureStartType" AS ENUM ('FOUNDING', 'SUCCESSION', 'BACKFILL');

-- CreateEnum
CREATE TYPE "HeadSuccessionReason" AS ENUM ('RETIREMENT', 'RESIGNATION', 'END_OF_TERM', 'ORGANIZATIONAL_RESTRUCTURING', 'CHANGE_OF_RESPONSIBILITY', 'PERSONAL_REASONS', 'OTHER');

-- CreateEnum
CREATE TYPE "HeadSuccessionStatus" AS ENUM ('AWAITING_VERIFICATION', 'AWAITING_ACCEPTANCE', 'COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AdminTransferOutcome" AS ENUM ('MANAGER', 'EXECUTIVE', 'REMOVED');

-- AlterTable
ALTER TABLE "token_service_steps" ADD COLUMN     "referred_by_name" TEXT,
ADD COLUMN     "staff_name" TEXT;

-- CreateTable
CREATE TABLE "organization_head_tenures" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "staff_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "start_type" "HeadTenureStartType" NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" "HeadSuccessionReason",
    "end_note" TEXT,
    "predecessor_tenure_id" TEXT,
    "succession_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_head_tenures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "head_successions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "HeadSuccessionStatus" NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "initiated_by_staff_id" TEXT NOT NULL,
    "initiated_by_name" TEXT NOT NULL,
    "initiated_by_email" TEXT NOT NULL,
    "successor_email" TEXT NOT NULL,
    "successor_name" TEXT NOT NULL,
    "successor_staff_id" TEXT,
    "reason" "HeadSuccessionReason" NOT NULL,
    "note" TEXT,
    "verification_code_hash" TEXT,
    "verification_expires_at" TIMESTAMP(3),
    "verification_attempts" INTEGER NOT NULL DEFAULT 0,
    "successor_token_hash" TEXT,
    "successor_token_expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "head_successions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_workspace_transfers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "queue_id" TEXT,
    "queue_name" TEXT,
    "old_admin_id" TEXT NOT NULL,
    "old_admin_name" TEXT NOT NULL,
    "old_admin_email" TEXT NOT NULL,
    "old_admin_outcome" "AdminTransferOutcome" NOT NULL,
    "new_admin_id" TEXT NOT NULL,
    "new_admin_name" TEXT NOT NULL,
    "new_admin_email" TEXT NOT NULL,
    "new_admin_previous_role" "StaffRole" NOT NULL,
    "transferred_by_id" TEXT NOT NULL,
    "transferred_by_name" TEXT NOT NULL,
    "transferred_by_email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "executives_moved" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_workspace_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_deletion_receipts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "deleted_by_staff_id" TEXT NOT NULL,
    "deleted_by_name" TEXT NOT NULL,
    "deleted_by_email" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_deletion_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_head_tenures_predecessor_tenure_id_key" ON "organization_head_tenures"("predecessor_tenure_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_head_tenures_succession_id_key" ON "organization_head_tenures"("succession_id");

-- CreateIndex
CREATE INDEX "organization_head_tenures_organization_id_started_at_idx" ON "organization_head_tenures"("organization_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "head_successions_successor_token_hash_key" ON "head_successions"("successor_token_hash");

-- CreateIndex
CREATE INDEX "head_successions_organization_id_created_at_idx" ON "head_successions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_workspace_transfers_organization_id_created_at_idx" ON "admin_workspace_transfers"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "organization_deletion_receipts_organization_id_idx" ON "organization_deletion_receipts"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_head_tenures" ADD CONSTRAINT "organization_head_tenures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "head_successions" ADD CONSTRAINT "head_successions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_workspace_transfers" ADD CONSTRAINT "admin_workspace_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: the names already shown in service history become the recorded
-- snapshot. A step whose operator or referrer no longer exists stays NULL —
-- never guessed.
UPDATE "token_service_steps" AS s
SET "staff_name" = st."name"
FROM "staff" AS st
WHERE s."staff_id" = st."id" AND s."staff_name" IS NULL;

UPDATE "token_service_steps" AS s
SET "referred_by_name" = st."name"
FROM "staff" AS st
WHERE s."referred_by_staff_id" = st."id" AND s."referred_by_name" IS NULL;

-- Backfill: every existing organization's current Head gets an open tenure,
-- dated from the organization's creation (the earliest moment we know they
-- held the role). Deterministic: one row per organization with an OWNER.
INSERT INTO "organization_head_tenures"
  ("id", "organization_id", "staff_id", "name", "email", "started_at", "start_type", "created_at")
SELECT gen_random_uuid()::text, o."id", st."id", st."name", st."email", o."created_at", 'BACKFILL', CURRENT_TIMESTAMP
FROM "organizations" AS o
JOIN LATERAL (
  SELECT s2."id", s2."name", s2."email"
  FROM "staff" AS s2
  WHERE s2."organization_id" = o."id" AND s2."role" = 'OWNER'
  ORDER BY s2."created_at" ASC, s2."id" ASC
  LIMIT 1
) AS st ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM "organization_head_tenures" t WHERE t."organization_id" = o."id"
);
