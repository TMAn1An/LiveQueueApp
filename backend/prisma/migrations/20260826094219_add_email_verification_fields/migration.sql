-- AlterEnum
ALTER TYPE "StaffStatus" ADD VALUE 'PENDING_EMAIL_VERIFICATION';

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "email_verification_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_verification_token_hash" TEXT,
ADD COLUMN     "registration_expires_at" TIMESTAMP(3);
