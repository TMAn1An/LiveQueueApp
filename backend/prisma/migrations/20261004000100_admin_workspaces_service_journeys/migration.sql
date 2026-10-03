-- ADR-069 (admin workspaces, queue deletion governance) and ADR-070 (counter
-- service routing, ordered service journeys, counter referrals). Additive:
-- every new column is nullable or defaulted, nothing is dropped, and no
-- existing queue, executive or token is attributed to anyone by guess.

-- CreateEnum
CREATE TYPE "JourneyStepStatus" AS ENUM ('PENDING', 'CALLED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "workspace_admin_id" TEXT;

-- AlterTable
ALTER TABLE "queue_services" ADD COLUMN     "max_occurrences_per_journey" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "admin_id" TEXT,
ADD COLUMN     "deleted_by_email" TEXT,
ADD COLUMN     "deleted_by_role" "StaffRole",
ADD COLUMN     "deleted_by_staff_id" TEXT,
ADD COLUMN     "deletion_reason" TEXT;

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "workspace_admin_id" TEXT;

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "cancel_reason_code" TEXT,
ADD COLUMN     "current_step_number" INTEGER;

-- CreateTable
CREATE TABLE "counter_services" (
    "counter_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counter_services_pkey" PRIMARY KEY ("counter_id","service_id")
);

-- CreateTable
CREATE TABLE "queue_recommended_steps" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "service_id" TEXT NOT NULL,

    CONSTRAINT "queue_recommended_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_service_steps" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "step_number" INTEGER NOT NULL,
    "service_id" TEXT NOT NULL,
    "status" "JourneyStepStatus" NOT NULL DEFAULT 'PENDING',
    "counter_id" TEXT,
    "staff_id" TEXT,
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "referred_to_counter_id" TEXT,
    "referred_from_counter_id" TEXT,
    "referred_by_staff_id" TEXT,
    "referred_at" TIMESTAMP(3),
    "referral_note" TEXT,

    CONSTRAINT "token_service_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counter_services_service_id_idx" ON "counter_services"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_recommended_steps_queue_id_position_key" ON "queue_recommended_steps"("queue_id", "position");

-- CreateIndex
CREATE INDEX "token_service_steps_service_id_idx" ON "token_service_steps"("service_id");

-- CreateIndex
CREATE INDEX "token_service_steps_referred_to_counter_id_idx" ON "token_service_steps"("referred_to_counter_id");

-- CreateIndex
CREATE INDEX "token_service_steps_counter_id_idx" ON "token_service_steps"("counter_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_service_steps_token_id_step_number_key" ON "token_service_steps"("token_id", "step_number");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_workspace_admin_id_created_at_idx" ON "audit_logs"("organization_id", "workspace_admin_id", "created_at");

-- CreateIndex
CREATE INDEX "queues_admin_id_idx" ON "queues"("admin_id");

-- CreateIndex
CREATE INDEX "staff_workspace_admin_id_idx" ON "staff"("workspace_admin_id");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_workspace_admin_id_fkey" FOREIGN KEY ("workspace_admin_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_services" ADD CONSTRAINT "counter_services_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "counters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_services" ADD CONSTRAINT "counter_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "queue_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_recommended_steps" ADD CONSTRAINT "queue_recommended_steps_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_recommended_steps" ADD CONSTRAINT "queue_recommended_steps_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "queue_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_service_steps" ADD CONSTRAINT "token_service_steps_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_service_steps" ADD CONSTRAINT "token_service_steps_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "queue_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_service_steps" ADD CONSTRAINT "token_service_steps_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "counters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_service_steps" ADD CONSTRAINT "token_service_steps_referred_to_counter_id_fkey" FOREIGN KEY ("referred_to_counter_id") REFERENCES "counters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_service_steps" ADD CONSTRAINT "token_service_steps_referred_from_counter_id_fkey" FOREIGN KEY ("referred_from_counter_id") REFERENCES "counters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ADR-069: one live queue per Admin. Deleted queues keep their admin_id for
-- history; legacy queues (admin_id NULL) are exempt until the Organization
-- Head assigns them.
CREATE UNIQUE INDEX "queues_admin_live_key" ON "queues"("admin_id") WHERE "admin_id" IS NOT NULL AND "deleted_at" IS NULL;

-- ADR-069 D5: bring existing counters in line with the counter lifecycle
-- (an operator is required unless the counter is off; turning a counter off
-- releases its operator). Someone called or being served is never stranded:
-- a counter with a CALLED/IN_PROGRESS token keeps its operator whatever its
-- status.
UPDATE "counters" SET "status" = 'OFFLINE'
WHERE "status" IN ('ACTIVE', 'ON_BREAK') AND "staff_id" IS NULL;

UPDATE "counters" c SET "staff_id" = NULL
WHERE c."status" = 'OFFLINE' AND c."staff_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "tokens" t
    WHERE t."counter_id" = c."id" AND t."status" IN ('CALLED', 'IN_PROGRESS')
  );
