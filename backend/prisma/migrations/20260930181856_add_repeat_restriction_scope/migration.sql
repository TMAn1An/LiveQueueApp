-- ADR-049: repeat-visit entitlement scope (QUEUE | SESSION).
-- Additive only. Every existing queue and claim becomes QUEUE-scoped, which
-- is exactly today's behaviour. The claim unique index gains the scope key;
-- because every existing row gets the same 'QUEUE' value, the old uniqueness
-- implies the new one, so creating it cannot fail on existing data. The new
-- index is created before the old one is dropped, so the one-governing-claim
-- guarantee is never absent mid-migration.

-- CreateEnum
CREATE TYPE "RepeatRestrictionScope" AS ENUM ('QUEUE', 'SESSION');

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "repeat_restriction_scope" "RepeatRestrictionScope" NOT NULL DEFAULT 'QUEUE';

-- AlterTable
ALTER TABLE "queue_identity_claims" ADD COLUMN     "entitlement_scope_key" TEXT NOT NULL DEFAULT 'QUEUE';

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "identity_scope_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "queue_identity_claims_queue_id_identity_fingerprint_entitle_key" ON "queue_identity_claims"("queue_id", "identity_fingerprint", "entitlement_scope_key", "claim_slot");

-- DropIndex
DROP INDEX "queue_identity_claims_queue_id_identity_fingerprint_claim_s_key";
