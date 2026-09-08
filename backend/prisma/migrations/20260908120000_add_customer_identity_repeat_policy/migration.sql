-- CreateEnum
CREATE TYPE "RepeatRestrictionPeriod" AS ENUM ('ONCE_EVER', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RepeatIdentityMode" AS ENUM ('VERIFIED_PHONE', 'CUSTOM_FIELD', 'VERIFIED_PHONE_AND_CUSTOM_FIELD');

-- CreateEnum
CREATE TYPE "IdentityClaimStatus" AS ENUM ('RESERVED', 'CONSUMED');

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "repeat_identity_field_key" TEXT,
ADD COLUMN     "repeat_identity_mode" "RepeatIdentityMode",
ADD COLUMN     "repeat_restriction_period" "RepeatRestrictionPeriod",
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "queue_identity_claims" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "identity_fingerprint" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" "IdentityClaimStatus" NOT NULL DEFAULT 'RESERVED',
    "mode" "RepeatIdentityMode" NOT NULL,
    "token_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_identity_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "phone_fingerprint" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "queue_identity_claims_token_id_key" ON "queue_identity_claims"("token_id");

-- CreateIndex
CREATE INDEX "queue_identity_claims_queue_id_status_idx" ON "queue_identity_claims"("queue_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "queue_identity_claims_queue_id_identity_fingerprint_period__key" ON "queue_identity_claims"("queue_id", "identity_fingerprint", "period_key");

-- CreateIndex
CREATE INDEX "phone_verifications_queue_id_phone_fingerprint_idx" ON "phone_verifications"("queue_id", "phone_fingerprint");

-- CreateIndex
CREATE INDEX "phone_verifications_expires_at_idx" ON "phone_verifications"("expires_at");

-- AddForeignKey
ALTER TABLE "queue_identity_claims" ADD CONSTRAINT "queue_identity_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_identity_claims" ADD CONSTRAINT "queue_identity_claims_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_identity_claims" ADD CONSTRAINT "queue_identity_claims_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Additive only: every column added is nullable and no existing row is
-- rewritten. Queues that already have allow_repeat_visits = false keep that
-- flag but now have no identity policy, which the service treats as
-- "configuration required" — it refuses new joins there rather than falling
-- back to the installation-based rule a reinstall could bypass. See ADR-034.
