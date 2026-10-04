-- Read-only production audit: counts only. The session is forced read-only
-- (PGOPTIONS default_transaction_read_only=on); no identifiers are printed.
\pset footer off
SELECT 'migrations_applied' AS k, count(*)::text AS v FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL SELECT 'migrations_failed', count(*)::text FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL
UNION ALL SELECT 'migration_' || migration_name, to_char(finished_at,'YYYY-MM-DD"T"HH24:MI:SS') FROM _prisma_migrations WHERE migration_name LIKE '20261004%'
UNION ALL SELECT 'organizations', count(*)::text FROM organizations
UNION ALL SELECT 'staff_total', count(*)::text FROM staff
UNION ALL SELECT 'staff_role_' || role::text, count(*)::text FROM staff GROUP BY role
UNION ALL SELECT 'queues_total', count(*)::text FROM queues
UNION ALL SELECT 'queues_live', count(*)::text FROM queues WHERE deleted_at IS NULL
UNION ALL SELECT 'queues_live_counterless', count(*)::text FROM queues q WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM counters c WHERE c.queue_id = q.id)
UNION ALL SELECT 'counters_' || status::text || CASE WHEN staff_id IS NULL THEN '_unassigned' ELSE '_assigned' END, count(*)::text FROM counters GROUP BY status, staff_id IS NULL
UNION ALL SELECT 'counters_offline_assigned_with_active_service', count(*)::text FROM counters c WHERE c.status = 'OFFLINE' AND c.staff_id IS NOT NULL AND EXISTS (SELECT 1 FROM tokens t WHERE t.counter_id = c.id AND t.status IN ('CALLED','IN_PROGRESS'))
UNION ALL SELECT 'tokens_total', count(*)::text FROM tokens
UNION ALL SELECT 'tokens_' || status::text, count(*)::text FROM tokens GROUP BY status
UNION ALL SELECT 'tokens_active_multiservice', count(*)::text FROM tokens t WHERE t.status IN ('WAITING','CALLED','IN_PROGRESS') AND (SELECT count(*) FROM token_services ts WHERE ts.token_id = t.id) > 1
UNION ALL SELECT 'audit_logs', count(*)::text FROM audit_logs
ORDER BY 1;

SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'queues' AND column_name = 'admin_id') AS post \gset
\if :post
SELECT 'post_queues_live_head_managed' AS k, count(*)::text AS v FROM queues WHERE deleted_at IS NULL AND admin_id IS NULL
UNION ALL SELECT 'post_queues_live_admin_owned', count(*)::text FROM queues WHERE deleted_at IS NULL AND admin_id IS NOT NULL
UNION ALL SELECT 'post_admins_with_more_than_one_live_queue', count(*)::text FROM (SELECT admin_id FROM queues WHERE deleted_at IS NULL AND admin_id IS NOT NULL GROUP BY admin_id HAVING count(*) > 1) x
UNION ALL SELECT 'post_executives_org_level', count(*)::text FROM staff WHERE role = 'STAFF' AND workspace_admin_id IS NULL
UNION ALL SELECT 'post_executives_in_workspace', count(*)::text FROM staff WHERE role = 'STAFF' AND workspace_admin_id IS NOT NULL
UNION ALL SELECT 'post_tokens_with_journey', count(*)::text FROM tokens WHERE current_step_number IS NOT NULL
UNION ALL SELECT 'post_token_steps', count(*)::text FROM token_service_steps
UNION ALL SELECT 'post_active_legacy_multiservice_without_steps', count(*)::text FROM tokens t WHERE t.status IN ('WAITING','CALLED','IN_PROGRESS') AND t.current_step_number IS NULL AND (SELECT count(*) FROM token_services ts WHERE ts.token_id = t.id) > 1
UNION ALL SELECT 'post_counter_services', count(*)::text FROM counter_services
UNION ALL SELECT 'post_unique_index_queues_admin_live_key', count(*)::text FROM pg_indexes WHERE indexname = 'queues_admin_live_key'
UNION ALL SELECT 'post_active_service_at_offline_counter', count(*)::text FROM tokens t JOIN counters c ON c.id = t.counter_id WHERE t.status IN ('CALLED','IN_PROGRESS') AND c.status = 'OFFLINE'
ORDER BY 1;
\endif
