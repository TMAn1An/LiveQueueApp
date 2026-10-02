-- ADR-062: a customer who has not chosen their own reminder time follows the
-- queue's default. NULL records exactly that, so the queue's current default
-- is read when a reminder is dispatched instead of being copied at join time.
-- Existing rows keep the value they have; nothing is rewritten.
ALTER TABLE "notification_preferences" ALTER COLUMN "reminder_minutes" DROP NOT NULL;
