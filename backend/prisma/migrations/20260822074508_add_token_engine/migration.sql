-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CALLED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "device_identifier" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "counter_id" TEXT,
    "device_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "serial_number" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
    "form_data" JSONB NOT NULL,
    "form_version" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_identifier_key" ON "devices"("device_identifier");

-- CreateIndex
CREATE INDEX "tokens_organization_id_created_at_idx" ON "tokens"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "tokens_queue_id_status_created_at_idx" ON "tokens"("queue_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "tokens_device_id_idx" ON "tokens"("device_id");

-- CreateIndex
CREATE INDEX "tokens_counter_id_idx" ON "tokens"("counter_id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_queue_id_sequence_number_key" ON "tokens"("queue_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_device_id_idempotency_key_key" ON "tokens"("device_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "queue_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "counters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
