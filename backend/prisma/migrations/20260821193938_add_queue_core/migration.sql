-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('ACTIVE', 'PAUSED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CounterStatus" AS ENUM ('ACTIVE', 'ON_BREAK', 'OFFLINE');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('text', 'number', 'email', 'phone', 'date', 'dropdown', 'radio', 'checkbox');

-- CreateTable
CREATE TABLE "queues" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "QueueStatus" NOT NULL DEFAULT 'ACTIVE',
    "client_terminology" TEXT,
    "token_prefix" TEXT NOT NULL,
    "starting_number" INTEGER NOT NULL DEFAULT 1,
    "next_token_number" INTEGER NOT NULL DEFAULT 1,
    "base_time_minutes" INTEGER NOT NULL DEFAULT 5,
    "default_notification_minutes" INTEGER NOT NULL DEFAULT 10,
    "form_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_services" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CounterStatus" NOT NULL DEFAULT 'OFFLINE',
    "staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_form_fields" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queues_organization_id_idx" ON "queues"("organization_id");

-- CreateIndex
CREATE INDEX "queue_services_queue_id_idx" ON "queue_services"("queue_id");

-- CreateIndex
CREATE INDEX "counters_queue_id_idx" ON "counters"("queue_id");

-- CreateIndex
CREATE INDEX "counters_staff_id_idx" ON "counters"("staff_id");

-- CreateIndex
CREATE INDEX "queue_form_fields_queue_id_version_idx" ON "queue_form_fields"("queue_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "queue_form_fields_queue_id_version_key_key" ON "queue_form_fields"("queue_id", "version", "key");

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_services" ADD CONSTRAINT "queue_services_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_form_fields" ADD CONSTRAINT "queue_form_fields_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
