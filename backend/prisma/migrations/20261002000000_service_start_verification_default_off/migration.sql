-- ADR-055: new queues start with the service-start verification code off.
-- Changes only the column default. Every existing queue keeps exactly the
-- value it already has, which is now fixed for that queue's lifetime.
ALTER TABLE "queues" ALTER COLUMN "require_service_start_otp" SET DEFAULT false;
