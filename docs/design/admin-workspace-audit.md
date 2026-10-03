# Admin workspace / role / counter routing — baseline audit and open decisions

Status: audit only (2026-10-03). No schema or code has changed on this branch.
Baseline: master `0d180bc` (tag v1.0.4). Backend 1071/1071, dashboard 505/505,
mobile 468/468; tsc, lint, build, prisma validate, flutter analyze clean.

## Current architecture (as built)

| Area | Today |
|---|---|
| Roles | `StaffRole` = OWNER, ADMIN, STAFF. Permissions derived from role only (`constants/permissions.ts`). OWNER and ADMIN have identical permission sets; STAFF has operate_tokens, view/export reports, manage_blocked_devices. |
| Who creates whom | Registration creates the OWNER. OWNER **and ADMIN** may invite ADMIN or STAFF (`manageableRole = ADMIN|STAFF`) and change a STAFF member's role. Only OWNER may change/suspend another admin (ADR-057). |
| Staff ↔ organization | `Staff.organizationId` only. **No inviter / owning-admin column.** Inviter exists only in `audit_logs` (`staff_created`, actor = staffId), written best-effort. |
| Queue ownership | `Queue.organizationId` only. **No admin / creator column.** Every OWNER/ADMIN manages every queue in the organization. Creator exists only in `audit_logs` (`queue_created`). |
| Queue deletion | Soft delete (`deletedAt`), no reason, no deleter column (actor in audit log only). Tokens are left as they are. |
| Counters | `CounterStatus` = ACTIVE, ON_BREAK, OFFLINE (default OFFLINE). `staffId` unique across the whole database (one operator, one counter, ADR-064). Status changes do **not** require or release an operator, so ACTIVE-unassigned and OFFLINE-assigned counters are both valid today. Operators may be moved between counters of **different queues**. |
| Services | `QueueService` per queue. A token may select **several** services (`TokenService`, `allowMultipleServices` default true). No counter↔service relation. |
| Serving | Serve Next / call derive the counter from the caller's assignment (client counterId must match). Strict FCFS by `sequence_number` across the whole queue (ADR-025/048). ETA engine assumes every active counter can serve every token. |
| Audit / reports | Scoped by organization only; any OWNER/ADMIN sees all. Realtime dashboard events go to one `organization:{id}` room. |
| Queue creation | Name + options form; counters and services added afterwards; queues can exist with no counters. |

## Why production data cannot be migrated deterministically

1. **Queues have no admin.** New organizations are created with only an OWNER, and the onboarding flow has the OWNER create the queues, so many queues were created by no admin at all. Organizations may have more queues than admins, or admins and no queues.
2. **Executives have no admin.** Staff were invited by the OWNER or any admin; nothing ties a STAFF member to one admin. Counter assignments today can place a STAFF member in any queue.
3. **Audit logs are not a reliable source.** They are written best-effort, start at Phase 7, and record the OWNER as actor for most early queues and invitations.
4. **Counter state invariants are new.** ACTIVE counters without an operator and OFF counters holding an operator are valid today; enforcing the new lifecycle changes existing rows.
5. I cannot query production from this environment (the database and backend hosts are not reachable), so I cannot even count the affected rows.

## Decisions needed (see the session report for the full list)

D1 Organization Head and queues · D2 existing queues → admin · D3 existing executives → admin · D4 who may create/promote Admins · D5 counter-state backfill · D6 routing with multi-service tokens · D7 cross-queue operator moves · D8 deleted-queue tokens · D9 Manager invitations.
