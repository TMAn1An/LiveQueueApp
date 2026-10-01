-- LiveQueue production fresh start.
--
-- Empties every application table and keeps the database, schema, tables,
-- indexes, constraints and `_prisma_migrations` (with all its rows) intact.
-- Run only against the intended database, after taking a Neon backup branch:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/ops/fresh-start.sql
--
-- The guard block aborts the whole transaction unless the migration history is
-- exactly what this script was written for and the application tables in
-- `public` are exactly the 18 listed below (so a new table added later is
-- never silently left behind, and nothing outside the list is touched).

\set ON_ERROR_STOP on

\echo '== target'
SELECT current_database() AS database, current_schema() AS schema,
       split_part(version(), ' ', 2) AS postgres;

\echo '== row counts before'
SELECT 'organizations' AS t, count(*) FROM organizations
UNION ALL SELECT 'staff', count(*) FROM staff
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'queues', count(*) FROM queues
UNION ALL SELECT 'queue_services', count(*) FROM queue_services
UNION ALL SELECT 'queue_sessions', count(*) FROM queue_sessions
UNION ALL SELECT 'counters', count(*) FROM counters
UNION ALL SELECT 'queue_form_fields', count(*) FROM queue_form_fields
UNION ALL SELECT 'devices', count(*) FROM devices
UNION ALL SELECT 'organization_device_blocks', count(*) FROM organization_device_blocks
UNION ALL SELECT 'tokens', count(*) FROM tokens
UNION ALL SELECT 'token_services', count(*) FROM token_services
UNION ALL SELECT 'device_fcm_tokens', count(*) FROM device_fcm_tokens
UNION ALL SELECT 'notification_preferences', count(*) FROM notification_preferences
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'queue_identity_claims', count(*) FROM queue_identity_claims
UNION ALL SELECT 'phone_verifications', count(*) FROM phone_verifications
UNION ALL SELECT 'customer_email_verifications', count(*) FROM customer_email_verifications
UNION ALL SELECT '_prisma_migrations', count(*) FROM _prisma_migrations;

BEGIN;

DO $$
DECLARE
  expected text[] := ARRAY[
    'audit_logs', 'counters', 'customer_email_verifications', 'device_fcm_tokens',
    'devices', 'notification_preferences', 'organization_device_blocks',
    'organizations', 'phone_verifications', 'queue_form_fields',
    'queue_identity_claims', 'queue_services', 'queue_sessions', 'queues',
    'sessions', 'staff', 'token_services', 'tokens'];
  actual text[];
  applied int;
  latest text;
BEGIN
  SELECT count(*) INTO applied FROM _prisma_migrations
   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  SELECT migration_name INTO latest FROM _prisma_migrations
   ORDER BY migration_name DESC LIMIT 1;
  IF applied <> 25 OR latest <> '20261001000131_add_organization_name_key' THEN
    RAISE EXCEPTION 'unexpected migration state: % applied, latest %', applied, latest;
  END IF;

  SELECT array_agg(tablename::text ORDER BY tablename) INTO actual
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'unexpected application tables in public: %', actual;
  END IF;
END $$;

TRUNCATE TABLE
  organizations, staff, sessions, queues, queue_services, queue_sessions,
  counters, queue_form_fields, devices, organization_device_blocks, tokens,
  token_services, device_fcm_tokens, notification_preferences, audit_logs,
  queue_identity_claims, phone_verifications, customer_email_verifications
RESTART IDENTITY CASCADE;

COMMIT;

\echo '== row counts after (every application table must be 0)'
SELECT 'organizations' AS t, count(*) FROM organizations
UNION ALL SELECT 'staff', count(*) FROM staff
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'queues', count(*) FROM queues
UNION ALL SELECT 'queue_services', count(*) FROM queue_services
UNION ALL SELECT 'queue_sessions', count(*) FROM queue_sessions
UNION ALL SELECT 'counters', count(*) FROM counters
UNION ALL SELECT 'queue_form_fields', count(*) FROM queue_form_fields
UNION ALL SELECT 'devices', count(*) FROM devices
UNION ALL SELECT 'organization_device_blocks', count(*) FROM organization_device_blocks
UNION ALL SELECT 'tokens', count(*) FROM tokens
UNION ALL SELECT 'token_services', count(*) FROM token_services
UNION ALL SELECT 'device_fcm_tokens', count(*) FROM device_fcm_tokens
UNION ALL SELECT 'notification_preferences', count(*) FROM notification_preferences
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'queue_identity_claims', count(*) FROM queue_identity_claims
UNION ALL SELECT 'phone_verifications', count(*) FROM phone_verifications
UNION ALL SELECT 'customer_email_verifications', count(*) FROM customer_email_verifications;

\echo '== migrations (must be 25, latest 20261001000131_add_organization_name_key)'
SELECT count(*) AS migrations, max(migration_name) AS latest FROM _prisma_migrations;

\echo '== schema (must still be 19 tables in public)'
SELECT count(*) AS tables FROM pg_tables WHERE schemaname = 'public';
