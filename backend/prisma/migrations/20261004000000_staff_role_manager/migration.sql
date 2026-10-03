-- ADR-069: the Organization Manager role. On its own so the new enum value is
-- committed before any later migration or query could use it.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'MANAGER';
