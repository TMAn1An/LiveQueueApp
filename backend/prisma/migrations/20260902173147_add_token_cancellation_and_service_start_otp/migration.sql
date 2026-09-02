-- AlterEnum
ALTER TYPE "TokenStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "service_start_otp_cipher" TEXT,
ADD COLUMN     "service_start_otp_expires_at" TIMESTAMP(3),
ADD COLUMN     "service_start_otp_failed_attempts" INTEGER NOT NULL DEFAULT 0;
