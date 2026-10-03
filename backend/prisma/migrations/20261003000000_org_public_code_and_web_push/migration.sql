-- ADR-068: one public QR per organization, queue listing on it, and
-- standards-based Web Push subscriptions for the iPhone/iPad Safari portal.
--
-- public_code: a random, non-secret code. The default is volatile, so
-- PostgreSQL evaluates it per row: every existing organization gets its own
-- code here, and every new one gets one from the database.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "public_code" TEXT NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12);

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "listed_on_organization_page" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_device_id_idx" ON "web_push_subscriptions"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_public_code_key" ON "organizations"("public_code");

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

