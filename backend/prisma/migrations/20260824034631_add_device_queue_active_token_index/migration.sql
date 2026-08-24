-- Enforces "one device may hold at most one active (WAITING/CALLED/
-- IN_PROGRESS) token per queue at a time" at the database level, as the
-- backstop for the equivalent application-level check in
-- token.service.ts::createToken (and the Recall guard in ::callToken).
--
-- This is a PARTIAL unique index (the WHERE clause) — a construct Prisma's
-- schema.prisma DSL cannot express (@@unique has no WHERE-clause syntax).
-- It is intentionally NOT declared anywhere in schema.prisma as a result.
--
-- MAINTENANCE WARNING: because schema.prisma has no knowledge of this
-- index, a *future* `prisma migrate dev` run (for an unrelated schema
-- change) will diff the shadow database against schema.prisma and may
-- propose a migration that DROPS this index, since schema.prisma appears
-- not to want it. If that happens, remove the erroneous DROP INDEX
-- statement from the newly generated migration before applying it — do
-- NOT let it apply. This is the standard, documented tradeoff for using a
-- Prisma-schema-inexpressible construct; there is no clean alternative
-- today.
--
-- COMPLETED and SKIPPED are deliberately excluded from the WHERE clause:
-- both immediately free the device+queue slot (SKIPPED despite not being
-- graph-terminal in the token state machine — see tokenStateMachine.ts).
CREATE UNIQUE INDEX "tokens_device_queue_active_key"
  ON "tokens" ("device_id", "queue_id")
  WHERE "status" IN ('WAITING', 'CALLED', 'IN_PROGRESS');
