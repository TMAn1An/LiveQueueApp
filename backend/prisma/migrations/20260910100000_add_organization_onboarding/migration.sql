-- V2 Product Completion checkpoint, Part C: first-time dashboard tutorial.
--
-- Purely additive: one nullable column, backfilled for every organization
-- that already exists so nobody currently using the dashboard is walked
-- through onboarding unexpectedly. An organization registered after this
-- migration runs gets NULL naturally (the registration code never sets this
-- column), which is exactly what makes it tutorial-eligible.
--
-- No DROP, no DELETE, no TRUNCATE. Nothing else about Organization changes.

ALTER TABLE "organizations" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);

-- Backfill: every pre-existing organization is treated as already onboarded,
-- using its own creation time as a plausible (and harmless — this timestamp
-- is never displayed) completion moment rather than "now" for every row.
UPDATE "organizations" SET "onboarding_completed_at" = "created_at"
WHERE "onboarding_completed_at" IS NULL;
