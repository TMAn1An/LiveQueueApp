-- ADR-037: verified email becomes the customer identity that repeat-visit
-- restrictions can actually use today.
--
-- Additive only. Nothing is dropped, renamed, deleted or rewritten:
--   * two values are ADDED to RepeatIdentityMode;
--   * one new table is created.
--
-- The two VERIFIED_PHONE values are deliberately LEFT IN PLACE. Removing a
-- PostgreSQL enum value means rebuilding the type and every column that uses
-- it, which is a destructive operation to buy nothing here — no SMS provider
-- was ever integrated, so neither phone mode has ever identified a real
-- customer, and no production queue can be holding one. They stay so that a
-- value already written to a development database still parses; the
-- application refuses to configure them from now on (see
-- queueIdentityPolicy.service.ts).
--
-- Splitting the two ADD VALUE statements across migrations is unnecessary:
-- this project targets PostgreSQL 12+, where several values may be added in
-- one transaction provided none is used in that same transaction — and none
-- is used here.

-- AlterEnum
ALTER TYPE "RepeatIdentityMode" ADD VALUE 'VERIFIED_EMAIL';
ALTER TYPE "RepeatIdentityMode" ADD VALUE 'VERIFIED_EMAIL_AND_CUSTOM_FIELD';

-- CreateTable
CREATE TABLE "customer_email_verifications" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "email_fingerprint" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_email_verifications_queue_id_email_fingerprint_idx" ON "customer_email_verifications"("queue_id", "email_fingerprint");

-- CreateIndex
CREATE INDEX "customer_email_verifications_expires_at_idx" ON "customer_email_verifications"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_email_verifications" ADD CONSTRAINT "customer_email_verifications_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
