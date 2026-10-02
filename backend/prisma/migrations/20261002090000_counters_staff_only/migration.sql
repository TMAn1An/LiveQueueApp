-- ADR-064: only STAFF serve, so only STAFF stand at counters. Owners and
-- admins manage counters and assignments. Release any counter currently
-- held by an OWNER or ADMIN; data only, no schema change.
UPDATE "counters"
SET "staff_id" = NULL
WHERE "staff_id" IN (SELECT "id" FROM "staff" WHERE "role" <> 'STAFF');
