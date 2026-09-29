-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "schedule_daily_capacity" INTEGER,
ADD COLUMN     "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedule_visible_to_customers" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "assigned_session_date" DATE,
ADD COLUMN     "assigned_session_end_minute" INTEGER,
ADD COLUMN     "assigned_session_start_minute" INTEGER,
ADD COLUMN     "queue_session_id" TEXT;

-- CreateTable
CREATE TABLE "queue_sessions" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "capacity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queue_sessions_queue_id_weekday_idx" ON "queue_sessions"("queue_id", "weekday");

-- CreateIndex
CREATE INDEX "tokens_queue_id_assigned_session_date_idx" ON "tokens"("queue_id", "assigned_session_date");

-- CreateIndex
CREATE INDEX "tokens_queue_session_id_assigned_session_date_idx" ON "tokens"("queue_session_id", "assigned_session_date");

-- AddForeignKey
ALTER TABLE "queue_sessions" ADD CONSTRAINT "queue_sessions_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_queue_session_id_fkey" FOREIGN KEY ("queue_session_id") REFERENCES "queue_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
