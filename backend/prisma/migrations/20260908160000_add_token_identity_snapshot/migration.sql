-- ADR-034 follow-up: keep the identity a token was admitted under on the
-- token itself.
--
-- The claim row in queue_identity_claims does not survive the whole token
-- lifecycle by design: SKIPPED and CANCELLED delete it, because neither is a
-- delivered service and the customer must be free to rejoin. But a SKIPPED
-- token can come back — Recall (SKIPPED -> CALLED) reuses that same row — and
-- once the claim was gone there was nothing left to re-establish it from. A
-- skipped-then-recalled-then-completed visit therefore recorded no claim at
-- all, and the customer could join again inside the same restriction period.
--
-- These three columns are the snapshot needed to put the claim back. The
-- fingerprint is the same HMAC the claim stores — never a raw national ID or
-- phone number. All three are nullable and stay null for every token on an
-- unrestricted queue, including every token that already exists.
--
-- Additive only: no DROP, no DELETE, no TRUNCATE, no NOT NULL without a
-- default. Existing rows are untouched and existing reads are unaffected.

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "identity_fingerprint" TEXT,
ADD COLUMN     "identity_mode" "RepeatIdentityMode",
ADD COLUMN     "identity_period_key" TEXT;
