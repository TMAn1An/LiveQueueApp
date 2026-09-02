-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "allow_multiple_services" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allow_repeat_visits" BOOLEAN NOT NULL DEFAULT true;
