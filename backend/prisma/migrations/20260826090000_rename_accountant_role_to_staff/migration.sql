-- Renames the StaffRole enum value ACCOUNTANT -> STAFF (V2 Checkpoint 1,
-- CLAUDE.md Rule L). RENAME VALUE is an in-place catalog rename: every
-- existing "staff" row whose role currently reads ACCOUNTANT keeps pointing
-- at the same enum label under its new name, with no data migration/backfill
-- needed and no window where the column is invalid.
ALTER TYPE "StaffRole" RENAME VALUE 'ACCOUNTANT' TO 'STAFF';
