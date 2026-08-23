-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "reminder_sent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "device_fcm_tokens" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_fcm_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "reminder_minutes" INTEGER NOT NULL,
    "vibration_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_fcm_tokens_device_id_key" ON "device_fcm_tokens"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_fcm_tokens_fcm_token_key" ON "device_fcm_tokens"("fcm_token");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_device_id_token_id_key" ON "notification_preferences"("device_id", "token_id");

-- CreateIndex
CREATE INDEX "tokens_status_reminder_sent_at_idx" ON "tokens"("status", "reminder_sent_at");

-- AddForeignKey
ALTER TABLE "device_fcm_tokens" ADD CONSTRAINT "device_fcm_tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
