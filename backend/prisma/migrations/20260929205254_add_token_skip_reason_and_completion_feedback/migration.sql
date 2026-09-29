-- CreateEnum
CREATE TYPE "SkipReasonCode" AS ENUM ('CUSTOMER_NOT_PRESENT', 'NO_RESPONSE', 'MISSING_REQUIREMENT', 'CUSTOMER_LEFT', 'OTHER');

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "completion_feedback" TEXT,
ADD COLUMN     "skip_reason_code" "SkipReasonCode",
ADD COLUMN     "skip_reason_text" TEXT;
