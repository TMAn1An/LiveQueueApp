# LiveQueue
## AI-Ready Product Requirements & Technical Specification

**Version:** 2.0.0  
**Date:** 2026-08-18  
**Status:** Development Specification

---

# 1. Product Summary

LiveQueue is a multi-organization, real-time queue management platform.

The system has three main applications:

1. **Backend API**: Node.js + Express + PostgreSQL + Prisma
2. **Web Dashboard**: React + Vite + Tailwind CSS
3. **Mobile App**: Flutter

The main goal is simple:

> A customer should be able to discover a queue, join it, receive a token, see their live position, and get notified when their turn is approaching. Staff should be able to manage counters and tokens in real time.

The system must support multiple organizations. Each organization has its own staff, queues, services, counters, tokens, settings, and reports. Data from one organization must never be visible to another organization.

---

# 2. Important Product Decisions

The following decisions are part of the specification and should not be changed without a clear reason.

## 2.1 Multi-tenant architecture

Every organization is an independent tenant.

All organization-owned records must contain an `organization_id` directly or be connected to an organization through a parent record.

The backend must always enforce tenant isolation.

A staff member from Organization A must never be able to access:

- Organization B queues
- Organization B staff
- Organization B counters
- Organization B tokens
- Organization B reports
- Organization B blocked devices

## 2.2 Queue states

A queue should support:

- `ACTIVE`
- `PAUSED`
- `INACTIVE`

Only an active queue can accept new tokens.

Pausing a queue does not delete existing tokens.

## 2.3 Token states

Use this lifecycle:

```text
WAITING
   ↓
CALLED
   ↓
IN_PROGRESS
   ↓
COMPLETED

WAITING → SKIPPED
CALLED  → SKIPPED
IN_PROGRESS → SKIPPED
```

The system must prevent invalid state changes.

For example, a `COMPLETED` token cannot become `WAITING` again.

## 2.4 Counter states

Use:

- `ACTIVE`
- `ON_BREAK`
- `OFFLINE`

A counter marked `ON_BREAK` or `OFFLINE` must not receive a new token.

## 2.5 Roles

Default roles:

- `OWNER`
- `ADMIN`
- `STAFF` (named `ACCOUNTANT` prior to V2 Checkpoint 1 — see docs/ARCHITECTURE_DECISIONS.md ADR-021)

Permissions must be explicit.

Do not rely only on role names. Store/check permissions so that an organization can have different access rules.

---

# 3. User Types

## 3.1 Owner

The organization owner has full control.

The owner can:

- Manage organization settings
- Manage staff
- Manage roles and permissions
- Create/edit/delete queues
- Manage services
- Manage counters
- Manage blocked devices
- View analytics
- Export reports
- Delete the organization

The owner cannot be deleted by another staff member.

## 3.2 Admin

Admin permissions are configurable.

Typical permissions:

- Manage queues
- Manage services
- Manage counters
- Manage staff
- Operate tokens
- View reports

## 3.3 Staff

(This role was named "Accountant" prior to V2 Checkpoint 1; it was renamed to the general-purpose "Staff" because this is a general queue management system, not one specific to accounting — see ADR-021.)

Staff should have limited access.

Typical permissions:

- View dashboard
- View queue statistics
- View reports
- Export reports

Staff should not operate tokens or manage security settings unless explicitly granted permission.

## 3.4 Customer

A customer uses the mobile app.

A customer can:

- Scan a QR code
- Discover a queue
- Select a service
- Fill in required information
- Join a queue
- Receive a token
- Track the token
- Configure reminders
- Receive turn alerts
- View token history

A customer does not need a traditional email/password account.

---

# 4. Core User Flows

## 4.1 Organization registration

As of V2 Checkpoint 2 (ADR-024), registration no longer creates an immediately-usable organization — the owner must first prove ownership of the supplied email address:

```text
Owner opens dashboard
        ↓
Enters organization name
        ↓
Enters email and password
        ↓
Backend validates input
        ↓
Organization is created
        ↓
Owner staff account is created, status = PENDING_EMAIL_VERIFICATION
        ↓
Owner receives JWT (dashboard opens, but queue functionality is blocked)
        ↓
Verification email is sent (Resend)
        ↓
Owner clicks the link within 15 minutes (or requests a resend)
        ↓
Backend verifies the token, status becomes ACTIVE
        ↓
Full dashboard/queue access
```

If the owner does not verify within **1 hour** of registration (independent of how many 15-minute links were sent or expired within that window), the pending organization and owner are deleted together — the email becomes available for a fresh registration. See ADR-024 for the full design (token shape, the `requireVerified` access boundary, and the cleanup job).

## 4.2 Staff login

```text
Staff enters email/password
        ↓
Backend validates credentials
        ↓
Backend checks account status
        ↓
JWT is issued
        ↓
Frontend loads organization + permissions
        ↓
Dashboard opens
```

## 4.3 Customer joins through QR

```text
Customer opens mobile app
        ↓
Scans organization/queue QR code
        ↓
App validates QR data
        ↓
App requests public queue configuration
        ↓
Customer sees queue details
        ↓
Customer selects one or more services (checkbox, or single-select when the
queue disallows multiple services — V2 Checkpoint 5/6, ADR-027/ADR-028)
        ↓
Backend rejects the join if the queue disallows repeat visits and this
device already completed a token here (V2 Checkpoint 6, ADR-028)
        ↓
Customer fills dynamic form
        ↓
Customer confirms
        ↓
Backend creates token, computing the total duration
from the selected services (never a client-supplied number)
        ↓
App displays token number + position
        ↓
Live tracking starts
```

As of V2 Checkpoint 5, a customer may select multiple services in one join — the token's required duration is the sum of every selected service's own `durationMinutes`, computed and validated server-side. See ADR-027 for the full design, including the production-safe migration and the backward-compatible request contract (`serviceId` singular is still accepted from an older client; `serviceIds` array is the current shape).

As of V2 Checkpoint 6, each queue carries two independent settings, both defaulting to `true` for every existing queue: `allowRepeatVisits` (when `false`, a device that already holds a `COMPLETED` token in this queue cannot create another — a `SKIPPED` token never counts, and this is checked separately from the pre-existing "one active token per device per queue" rule) and `allowMultipleServices` (when `false`, exactly one service must be selected). The repeat-visit rule is keyed on the existing device identifier only — there is no customer account, phone/email verification, or fingerprinting in this system, so a customer using two devices is not caught by it; this is a documented, accepted limitation, not a gap to silently work around. See ADR-028 for the full design, including the concurrency analysis and why this is deliberately not a stronger identity system.

## 4.4 Staff calls a token

```text
Staff selects available counter
        ↓
Staff chooses next eligible token
        ↓
Backend atomically assigns token to counter
        ↓
Token becomes CALLED
        ↓
Customer receives real-time update
        ↓
Customer receives turn notification
        ↓
Staff starts service
        ↓
Token becomes IN_PROGRESS
        ↓
Staff completes or skips token
```

---

# 5. Architecture

```text
┌─────────────────────┐
│    Flutter App      │
│      Customer       │
└──────────┬──────────┘
           │ REST + Socket.io
           │
┌──────────▼──────────┐
│   Node.js Backend   │
│   Express + Prisma  │
└───────┬───────┬─────┘
        │       │
        │       └──────── Socket.io events
        │
┌───────▼──────────────┐
│     PostgreSQL       │
└──────────────────────┘
        ▲
        │ Prisma
        │
┌───────┴──────────────┐
│    React Dashboard   │
│  Staff / Admin /     │
│       Owner          │
└──────────────────────┘
```

## Communication

### Mobile → Backend

Use:

- REST API for commands and initial data
- Socket.io for live queue updates

### Dashboard → Backend

Use:

- REST API for CRUD and token operations
- Socket.io for real-time dashboard updates

### Backend → Database

Use Prisma ORM.

### Backend → Clients

Use Socket.io events for:

- Token status changes
- Queue position changes
- Counter changes
- New token events
- Queue pause/activation
- Turn calls

---

# 6. Recommended Tech Stack

## Backend

- Node.js LTS
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Socket.io
- JWT + refresh/session handling
- bcrypt or Argon2
- Helmet
- CORS
- express-rate-limit or equivalent rate limiting
- node-cron where scheduled jobs are required
- Zod for request validation
- Pino or Winston for structured logging
- Redis is optional for later scaling, not required for MVP
- Firebase Cloud Messaging (FCM) or equivalent push service for background mobile notifications

**Node.js:** use a current LTS version for production. Do not hard-code Node.js 25 as a project requirement.

## Web

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- TanStack Query for server-state fetching, caching, mutations, and refetching
- React Context for small app-level state such as authentication/session state
- Socket.io client

## Mobile

- Flutter
- Dart
- Provider or another simple state management solution
- `mobile_scanner`
- `shared_preferences`
- `socket_io_client`
- `flutter_local_notifications`
- Firebase Cloud Messaging (FCM) for reliable background push notifications where required

## Stack Decision

The selected stack is appropriate for the current LiveQueue requirements and should remain the default implementation stack.

### Why this stack fits

- **Node.js + Express** is a strong fit for an API that handles many concurrent queue operations and real-time events.
- **PostgreSQL** is the source of truth for organizations, queues, tokens, counters, permissions, and reporting data.
- **Prisma** provides a clear database access layer and migration workflow.
- **Socket.io** is well suited for live token, counter, queue, and dashboard updates.
- **React + Vite** is suitable for a fast operational dashboard.
- **TanStack Query** should manage server data instead of putting all API state into React Context.
- **Flutter** is suitable for a single mobile codebase targeting Android and iOS.
- **FCM/push notifications** should handle background alerts because mobile operating systems may suspend background application processes.
- **Redis** should not be introduced for the MVP unless there is a real requirement. Add it later if the system needs distributed Socket.io scaling, caching, distributed coordination, or background job queues.

### Architecture rule

Do not replace this stack with Laravel, a different frontend framework, or a different mobile framework unless a specific project requirement justifies the change.

---

# 7. Functional Requirements

# 7.1 Organization Management

The system must allow an organization owner to:

- Create an organization
- View organization information
- Edit organization information
- Configure customer terminology
- Configure default queue settings
- Delete the organization

Deleting an organization is destructive.

The UI must:

1. Explain that deletion is permanent.
2. Require the owner to confirm.
3. Require a second confirmation step.
4. Perform a transaction/cascade cleanup safely.

Recommended confirmation:

```text
Type the organization name to confirm deletion.
```

---

# 7.2 Authentication

## Registration

Endpoint:

```http
POST /api/auth/register
```

Required:

- organization name
- owner email
- password

Validation:

- Valid email
- Strong password
- Unique owner email
- Non-empty organization name

## Login

```http
POST /api/auth/login
```

Response must contain:

- staff information
- organization information
- permissions
- access token

## Current user

```http
GET /api/auth/me
```

## Logout

The frontend should clear local authentication state.

For stronger security, production systems should support token revocation/session management.

---

# 7.3 Staff Management

Staff fields should include:

- id
- name
- email
- password hash
- role
- permissions
- status
- organization id
- created timestamp
- updated timestamp
- last login timestamp

Recommended status:

- `ACTIVE`
- `SUSPENDED`

Endpoints:

```http
GET    /api/staff
POST   /api/staff
GET    /api/staff/:staffId
PUT    /api/staff/:staffId
DELETE /api/staff/:staffId
```

Rules:

- Owner cannot be deleted by normal staff.
- Suspended staff cannot log in.
- Staff can only manage records inside their organization.
- Passwords must never be returned by the API.

---

# 7.4 Permissions

There are exactly three staff roles — `OWNER`, `ADMIN`, `STAFF` — each with a fixed permission set. (`STAFF` was named `ACCOUNTANT` prior to V2 Checkpoint 1 — see ADR-021; the permission set itself did not change.) There is no per-user permission customization and no separate roles-management permission; roles are assigned directly by name through the staff create/update endpoints. See `docs/ARCHITECTURE_DECISIONS.md`'s ADR-020 for the full rationale and role matrix.

Permission set:

```text
manage_organization
manage_staff
manage_queues
manage_services
manage_counters
operate_tokens
view_reports
export_reports
manage_blocked_devices
view_audit_logs
```

- `OWNER` and `ADMIN` hold all 10. Admin's only restrictions — cannot delete the Owner, cannot delete the organization — are enforced by dedicated role checks, independent of this permission list.
- `STAFF` holds exactly `manage_counters`, `operate_tokens`, `view_reports`, `export_reports`, `manage_blocked_devices`.

The backend must enforce permissions.

The frontend only hides unavailable actions. It must not be treated as the security layer.

---

# 7.5 Queue Management

A queue represents one service line.

Each queue contains:

- name
- description
- status
- customer terminology
- token prefix
- token starting number
- estimated base service time
- default reminder time
- dynamic form fields
- services
- counters
- QR code

Endpoints:

```http
GET    /api/queues
POST   /api/queues
GET    /api/queues/:queueId
PUT    /api/queues/:queueId
DELETE /api/queues/:queueId
PATCH  /api/queues/:queueId/status
```

## Queue creation

Example:

```json
{
  "name": "Customer Service",
  "description": "General customer support",
  "client_terminology": "Customer",
  "token_prefix": "A",
  "starting_number": 1,
  "base_time_minutes": 5,
  "default_notification_minutes": 10,
  "status": "ACTIVE"
}
```

---

# 7.6 Dynamic Form Builder

Each queue can define custom customer fields.

Supported types:

- text
- number
- email
- phone
- date
- dropdown
- radio
- checkbox

Each field should have:

```json
{
  "key": "phone",
  "label": "Phone Number",
  "type": "phone",
  "required": true,
  "placeholder": "Enter phone number",
  "options": []
}
```

Rules:

- `key` must be unique inside a queue.
- Required fields must be validated by backend and frontend.
- Do not trust submitted field definitions from the mobile app.
- The backend must validate submitted data against the current queue form configuration.
- Existing token form data must not change when the queue form is edited.

Use a form version number so historical submissions remain understandable.

---

# 7.7 Services

A queue may contain multiple services.

Example:

```text
Customer Service
├── General Inquiry       5 minutes
├── Account Update       10 minutes
└── Complaint             15 minutes
```

Fields:

- id
- queue id
- service name
- description
- duration in minutes
- active status

Endpoints:

```http
POST   /api/queues/:queueId/services
PUT    /api/services/:serviceId
DELETE /api/services/:serviceId
PATCH  /api/services/:serviceId/status
```

Only active services can be selected by customers.

---

# 7.8 Counters

A counter is a physical or virtual service point.

Fields:

- id
- queue id
- counter name
- status
- assigned staff
- created timestamp

Endpoints:

```http
GET    /api/queues/:queueId/counters
POST   /api/queues/:queueId/counters
PUT    /api/counters/:counterId
DELETE /api/counters/:counterId
PATCH  /api/counters/:counterId/status
PATCH  /api/counters/:counterId/assign
```

Rules:

- One counter belongs to one queue.
- A counter cannot serve two tokens at the same time.
- A counter on break/offline cannot receive a new token.
- Staff assignment must be validated.

---

# 7.9 Token Generation

Endpoint:

```http
POST /api/tokens
```

The request contains:

```json
{
  "queue_id": "queue-id",
  "service_id": "service-id",
  "form_data": {
    "full_name": "John Doe",
    "phone": "1234567890"
  }
}
```

Backend must:

1. Verify queue exists.
2. Verify queue is active.
3. Verify service belongs to the queue.
4. Verify service is active.
5. Validate form data.
6. Verify device is not blocked.
7. Generate the next serial number safely.
8. Create token.
9. Return token information.
10. Emit a real-time event.

Token creation must be transaction-safe so two customers cannot receive the same serial number.

---

# 7.10 Token Serial Numbers

Example:

```text
A001
A002
A003
```

The prefix and starting number should be configurable.

Serial generation must be safe under concurrent requests.

Do not generate serial numbers only by counting current tokens because deleted/old records or simultaneous requests can cause duplicates.

Recommended approach:

- Maintain a queue-level counter/sequence.
- Increment it inside a database transaction.
- Generate the display serial from that sequence.

---

# 7.11 Token Operations

## Call

```http
POST /api/tokens/:tokenId/call
```

Request:

```json
{
  "counter_id": "counter-id"
}
```

The backend must atomically verify:

- token is eligible
- counter is active
- counter is not serving another token
- staff has permission
- token belongs to the same organization

Then:

```text
WAITING → CALLED
```

Set:

- called_at
- counter_id

Emit:

```text
token.called
```

## Start

```http
POST /api/tokens/:tokenId/start
```

Changes:

```text
CALLED → IN_PROGRESS
```

## Complete

```http
POST /api/tokens/:tokenId/complete
```

Changes:

```text
IN_PROGRESS → COMPLETED
```

Set:

- completed_at

## Skip

```http
POST /api/tokens/:tokenId/skip
```

Allowed from:

- WAITING
- CALLED
- IN_PROGRESS

Set final status:

```text
SKIPPED
```

---

# 7.12 Next Token

Add a staff action:

```http
POST /api/queues/:queueId/next
```

The backend should:

1. Find the oldest eligible `WAITING` token.
2. Find an available counter.
3. Lock the relevant records.
4. Assign the token.
5. Change status to `CALLED`.
6. Emit events.

This avoids race conditions when multiple staff members click "Next" at nearly the same time.

---

# 7.13 Queue Position

For a waiting token, calculate:

```text
position = number of eligible waiting tokens ahead of it + 1
```

The position must update when:

- another token is completed
- another token is skipped
- a new token joins
- token order changes
- queue state changes

Do not permanently store position unless there is a strong reason. It is derived state.

---

# 7.14 Estimated Wait Time

Basic estimate:

```text
estimated_wait =
    estimated service time × eligible tokens ahead
    ÷ available active counters
```

Use the selected service duration when available.

The system should improve the estimate later using historical averages.

The UI must label this as an estimate, not a guarantee.

---

# 7.15 Mobile QR Code

QR format:

```text
livequeue://queue/{queueId}
```

The QR code should contain only a safe identifier.

The mobile app must:

1. Scan the QR code.
2. Validate its format.
3. Extract queue id.
4. Request public configuration.
5. Display queue details.
6. Allow the customer to join.

The backend must never trust the QR content by itself.

---

# 7.16 Public Queue API

Public queue configuration:

```http
GET /api/public/queues/:queueId/config
```

Use a client API key if required.

Return only data that is safe to expose publicly.

Example:

```json
{
  "queue": {
    "id": "queue-id",
    "name": "Customer Service",
    "organization_name": "Company Name",
    "client_terminology": "Customer",
    "form_requirements": [],
    "services": []
  },
  "state": {
    "active_tokens": 5,
    "estimated_wait_minutes": 15
  }
}
```

Do not expose:

- staff emails
- passwords
- private permissions
- internal security settings
- blocked device lists
- private customer form data

---

# 7.17 Mobile Live Tracking

The mobile app must show:

- token number
- current status
- current position
- estimated wait
- selected service
- counter when called
- queue name
- organization name

Example:

```text
Your Token: A023

Status: Waiting
Position: 4
Estimated Wait: 18 minutes

Service:
Account Update

You will be notified before your turn.
```

When called:

```text
Your Token: A023

Status: Your Turn
Counter: Counter 2
```

---

# 7.18 Notifications

Notification types:

1. Token created
2. Position changed
3. Reminder before turn
4. Token called
5. Token skipped
6. Queue paused
7. Queue resumed

## Reminder

The customer can choose a reminder time.

Minimum:

```text
2 minutes
```

The UI should allow reasonable values such as:

```text
2, 5, 10, 15, 20 minutes
```

The system must prevent reminders from being scheduled after the token's estimated turn has already passed.

## Turn alert

When a token becomes `CALLED`, the app should:

- show a notification
- vibrate if permitted
- play a notification sound if permitted

Do not depend only on background execution. Use platform-supported notification mechanisms.

---

# 7.19 Device Management

Each mobile installation should have a generated device identifier.

A device can have device-level authentication.

The backend should support:

```text
ACTIVE
BLOCKED
```

Blocked devices cannot:

- fetch protected queue actions
- create new tokens
- continue tracking protected tokens

Dashboard:

```http
GET    /api/blocked-devices
POST   /api/blocked-devices/:deviceId/block
DELETE /api/blocked-devices/:deviceId
```

Do not use device IDs as a replacement for user identity. They are only device-level controls.

---

# 7.20 Customer History

The mobile app should show previous tokens associated with the device.

Each history item:

- token number
- organization
- queue
- service
- created time
- final status

Recommended limitation:

```text
Keep the most recent 100 history records locally.
```

---

# 8. Real-Time Events

Use Socket.io rooms.

Recommended room structure:

```text
organization:{organizationId}
queue:{queueId}
token:{tokenId}
```

## Events

### Queue

```text
queue.created
queue.updated
queue.status_changed
```

### Token

```text
token.created
token.called
token.started
token.completed
token.skipped
token.position_changed
```

### Counter

```text
counter.created
counter.updated
counter.status_changed
```

## Security

Authenticated dashboard sockets must verify the staff JWT before joining organization rooms.

A client must not be able to subscribe to another organization's room by changing an ID in the frontend.

---

# 9. Web Dashboard

## Pages

### Authentication

- Login
- Registration
- Forgot password (recommended for production)

### Main

- Dashboard
- Queue management
- Queue details
- Counter management
- Staff management
- Blocked devices
- Reports
- Organization settings
- Profile/settings

---

# 10. Dashboard Requirements

## Dashboard

Show:

- Total active queues
- Waiting tokens
- Called tokens
- Active counters
- Counters on break
- Average wait time
- Average service time
- Completed today
- Skipped today

Also show a live queue table:

| Token | Queue | Service | Position | Status | Counter | Time |
|---|---|---|---:|---|---|---|

Actions:

- Call
- Start
- Complete
- Skip

Actions must appear only when valid for the current token state.

---

# 11. Queue Manager

The queue manager should provide:

- Queue list
- Search
- Status filter
- Create queue
- Edit queue
- Pause/resume
- Delete queue
- Service management
- Form builder
- Counter management
- QR generation

Deleting a queue should require confirmation.

If a queue has active tokens, warn the user before deletion.

Prefer soft deletion/archive for production systems.

---

# 12. QR Code Management

For every active queue:

- Generate QR code
- Display QR code
- Download QR code
- Print-friendly QR page

The QR page should show:

```text
Organization Name
Queue Name
Scan to Join
[QR CODE]
```

The QR should not expose private data.

---

# 13. Reports & Analytics

## Dashboard metrics

Track:

- Tokens created
- Tokens completed
- Tokens skipped
- Average waiting time
- Average service duration
- Peak hours
- Counter utilization
- Queue performance

## Date filters

Support:

- Today
- Yesterday
- Last 7 days
- Last 30 days
- Custom range

## Export

Add:

```text
CSV
```

PDF can be added later if required.

---

# 14. Audit Log

**This is a new recommended feature.**

Add an audit log because queue systems contain important staff actions.

Track:

- login
- logout
- staff created
- staff updated
- queue created
- queue updated
- queue deleted/archived
- counter changes
- token called
- token skipped
- token completed
- organization deletion request
- blocked device changes

Fields:

```text
id
organization_id
staff_id
action
entity_type
entity_id
metadata
ip_address
created_at
```

Do not store passwords or sensitive secrets in audit metadata.

---

# 15. Database Design

The original schema is too small for all stated features.

Use at least these entities:

```text
Organization
Staff
Queue
QueueService
QueueFormField
Counter
Token
Device
AuditLog
NotificationPreference
```

Optional later:

```text
Session
PasswordResetToken
NotificationLog
```

## Organization

```text
id
name
status
created_at
updated_at
```

## Staff

```text
id
organization_id
name
email
password_hash
role
permissions
status
last_login_at
created_at
updated_at
```

## Queue

```text
id
organization_id
name
description
status
client_terminology
token_prefix
starting_number
next_token_number
base_time_minutes
default_notification_minutes
form_version
created_at
updated_at
```

## QueueService

```text
id
queue_id
service_name
description
duration_minutes
is_active
created_at
updated_at
```

## QueueFormField

```text
id
queue_id
key
label
type
required
placeholder
options
sort_order
version
created_at
updated_at
```

## Counter

```text
id
queue_id
name
status
staff_id
created_at
updated_at
```

## Token

```text
id
organization_id
queue_id
service_id
counter_id
device_id
serial_number
sequence_number
status
form_data
form_version
created_at
called_at
started_at
completed_at
skipped_at
```

## Device

```text
id
device_identifier
status
last_seen_at
created_at
updated_at
```

## AuditLog

```text
id
organization_id
staff_id
action
entity_type
entity_id
metadata
ip_address
created_at
```

## NotificationPreference

```text
id
device_id
token_id
reminder_minutes
vibration_enabled
sound_enabled
notifications_enabled
created_at
updated_at
```

---

# 16. Important Database Rules

Add indexes for:

```text
organization_id
queue_id
status
created_at
device_id
```

Recommended compound indexes:

```text
(queue_id, status, created_at)
(organization_id, created_at)
```

Add unique constraints where needed:

```text
Staff email within the appropriate tenant/auth model
Queue form key within queue/version
Queue serial sequence within queue
```

Use database transactions for:

- token generation
- token calling
- token completion
- queue deletion/archive
- staff deletion
- organization deletion

---

# 17. API Standards

Use consistent JSON responses.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "QUEUE_NOT_ACTIVE",
    "message": "This queue is currently not accepting new customers."
  }
}
```

Use HTTP status codes correctly:

```text
200 OK
201 Created
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
```

Never return stack traces in production.

---

# 18. API Endpoint Map

## Authentication

```http
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/refresh
```

## Organization

```http
GET    /api/organization
PUT    /api/organization
DELETE /api/organization
```

## Staff

```http
GET    /api/staff
POST   /api/staff
GET    /api/staff/:staffId
PUT    /api/staff/:staffId
DELETE /api/staff/:staffId
```

## Queues

```http
GET    /api/queues
POST   /api/queues
GET    /api/queues/:queueId
PUT    /api/queues/:queueId
DELETE /api/queues/:queueId
PATCH  /api/queues/:queueId/status
POST   /api/queues/:queueId/next
```

## Services

```http
POST   /api/queues/:queueId/services
PUT    /api/services/:serviceId
DELETE /api/services/:serviceId
PATCH  /api/services/:serviceId/status
```

## Counters

```http
GET    /api/queues/:queueId/counters
POST   /api/queues/:queueId/counters
PUT    /api/counters/:counterId
DELETE /api/counters/:counterId
PATCH  /api/counters/:counterId/status
PATCH  /api/counters/:counterId/assign
```

## Tokens

```http
POST   /api/tokens
GET    /api/tokens/:tokenId
GET    /api/tokens/:tokenId/status
POST   /api/tokens/:tokenId/call
POST   /api/tokens/:tokenId/start
POST   /api/tokens/:tokenId/complete
POST   /api/tokens/:tokenId/skip
```

## Public

```http
GET    /api/public/queues/:queueId/config
```

## Devices

```http
GET    /api/blocked-devices
POST   /api/blocked-devices/:deviceId/block
DELETE /api/blocked-devices/:deviceId
```

## Reports

```http
GET /api/reports/summary
GET /api/reports/queues
GET /api/reports/counters
GET /api/reports/tokens
GET /api/reports/export
```

## Audit

```http
GET /api/audit-logs
```

---

# 19. Security Requirements

The following are mandatory.

## Authentication

- Hash passwords with bcrypt or Argon2.
- Never store plain passwords.
- Use strong JWT secrets.
- Use short-lived access tokens in production.
- Add refresh token/session handling if long sessions are required.

## Authorization

Every protected endpoint must check:

1. Authentication
2. Organization membership
3. Permission
4. Resource ownership

## Validation

Validate:

- request body
- query parameters
- route parameters
- enum values
- form data

## Rate limiting

Add rate limits to:

- login
- registration
- public queue endpoints
- token creation
- password reset

## HTTP security

Use:

- Helmet
- strict CORS
- secure cookies where applicable
- HTTPS in production

## Secrets

Never commit:

```text
.env
JWT_SECRET
DATABASE_URL
API keys
private keys
production credentials
```

---

# 20. Mobile App Screens

Required screens:

1. Splash
2. Home
3. QR Scanner
4. Queue Details
5. Dynamic Form
6. Service Selection
7. Token Confirmation
8. Live Tracking
9. Notification Settings
10. Token History
11. Token Details
12. Settings

## Home

Provide:

- Scan QR button
- Current active token
- Recent history

## Queue Details

Show:

- organization name
- queue name
- current waiting count
- estimated wait
- available services
- queue status

## Dynamic Form

Render fields from backend configuration.

Never hard-code queue-specific fields.

## Live Tracking

Must update without manual refresh.

---

# 21. Server State and Client State

Use **TanStack Query** for data that comes from the backend.

Examples:

- queues
- services
- counters
- staff
- reports
- token details
- dashboard statistics

Use React Context only for small application-level state such as:

- authenticated staff
- session state
- UI-level settings

Socket.io events should invalidate or update relevant TanStack Query data rather than creating a second, conflicting server-state system.

# 22. Mobile State Management

Keep state separated into:

```text
AuthState
QueueState
TokenState
NotificationState
HistoryState
```

Do not put the whole application into one large StatefulWidget.

Use services/repositories for API communication.

---

# 22. Web Frontend Structure

Recommended:

```text
src/
├── api/
├── components/
├── pages/
├── layouts/
├── hooks/
├── context/
├── services/
├── utils/
├── types/
└── App.jsx
```

Recommended pages:

```text
Login
Register
Dashboard
Queues
QueueDetails
Counters
Staff
Reports
BlockedDevices
AuditLogs
OrganizationSettings
Profile
```

Use reusable components for:

- tables
- forms
- modals
- confirmation dialogs
- status badges
- loading states
- error messages
- pagination

---

# 23. Project Structure

```text
livequeue/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.js
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── middleware/
│   │   ├── validators/
│   │   ├── sockets/
│   │   ├── jobs/
│   │   ├── utils/
│   │   └── server.js
│   ├── tests/
│   └── package.json
│
├── web-dashboard/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── layouts/
│   │   ├── hooks/
│   │   ├── context/
│   │   ├── services/
│   │   └── App.jsx
│   ├── tests/
│   └── package.json
│
├── mobile-app/
│   ├── lib/
│   │   ├── models/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── providers/
│   │   ├── screens/
│   │   ├── widgets/
│   │   └── main.dart
│   ├── test/
│   ├── integration_test/
│   └── pubspec.yaml
│
└── README.md
```

---

# 24. Environment Variables

Backend:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=
JWT_SECRET=
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d
CLIENT_API_KEY=
CORS_ORIGINS=
BCRYPT_SALT_ROUNDS=12
```

Web:

```env
VITE_API_URL=http://localhost:4000
```

Mobile:

Use build-time configuration:

```text
API_BASE_URL
```

Do not hard-code production secrets into the mobile application.

Important:

> A key shipped inside a mobile app must be treated as extractable. Therefore, a mobile client API key is not a secret security boundary.

---

# 25. Error Handling

The UI must handle:

- network failure
- expired authentication
- queue unavailable
- queue paused
- device blocked
- duplicate token request
- invalid form
- invalid QR code
- socket disconnection
- server error

Show user-friendly messages.

Do not expose internal errors such as SQL errors or stack traces.

---

# 26. Offline and Connection Recovery

The mobile app should tolerate temporary network loss.

When disconnected:

- show connection status
- keep the last known token status
- do not show stale information as current
- reconnect Socket.io automatically
- refresh token status after reconnecting

Do not allow duplicate token creation caused by retrying the same request.

Use an idempotency key for token creation.

Example:

```http
Idempotency-Key: <unique-request-id>
```

The backend should return the existing token if the same request is submitted again.

---

# 27. Testing Requirements

## Backend

Test:

- registration
- login
- authorization
- tenant isolation
- queue CRUD
- service CRUD
- counter CRUD
- token generation
- duplicate token prevention
- token state transitions
- concurrent "Next" actions
- blocked devices
- reports

## Web

Test:

- login
- permissions
- queue management
- token operations
- real-time updates
- validation
- error states

## Mobile

Test:

- QR scanning
- invalid QR
- queue loading
- dynamic forms
- token creation
- live tracking
- notification settings
- history
- reconnection

## Critical concurrency test

Simulate two staff members pressing "Next" at the same time.

Expected result:

```text
Only one staff member receives the same token.
```

---

# 28. Acceptance Criteria

The project is considered functional when all of the following work.

## Organization

- [ ] Owner can register.
- [ ] Owner can log in.
- [ ] Organization data is isolated.
- [ ] Owner can manage organization settings.

## Staff

- [ ] Owner can create staff.
- [ ] Owner can edit staff.
- [ ] Owner can suspend staff.
- [ ] Permissions are enforced by backend.
- [ ] Owner protection works.

## Queue

- [ ] Owner/admin can create queues.
- [ ] Queue can be paused/resumed.
- [ ] Queue can contain multiple services.
- [ ] Queue can have dynamic forms.
- [ ] Queue can generate QR code.

## Counters

- [ ] Multiple counters can exist.
- [ ] Staff can be assigned.
- [ ] Counter can go on break.
- [ ] Counter cannot receive two active tokens.

## Customer

- [ ] Customer can scan QR.
- [ ] Customer can view queue.
- [ ] Customer can select service.
- [ ] Customer can complete dynamic form.
- [ ] Customer can receive a token.
- [ ] Customer can see position.
- [ ] Customer can see estimated wait.
- [ ] Customer receives turn notification.

## Token

- [ ] Serial numbers are unique.
- [ ] Token state transitions are enforced.
- [ ] Staff can call tokens.
- [ ] Staff can start tokens.
- [ ] Staff can complete tokens.
- [ ] Staff can skip tokens.
- [ ] Concurrent token calls are safe.

## Real time

- [ ] Dashboard updates without refresh.
- [ ] Mobile app updates without refresh.
- [ ] Reconnection works.
- [ ] Unauthorized socket rooms are blocked.

## Reports

- [ ] Daily statistics work.
- [ ] Date filters work.
- [ ] Queue reports work.
- [ ] Counter reports work.
- [ ] CSV export works.

## Security

- [ ] Passwords are hashed.
- [ ] Protected APIs require authentication.
- [ ] Permissions are checked server-side.
- [ ] Tenant isolation is tested.
- [ ] Rate limiting is enabled.
- [ ] Secrets are not committed.

---

# 29. Features Added During This Specification Review

The original specification was strong as a feature list, but several important implementation rules were missing.

The following have been added:

### 29.1 Queue pause state

Added:

```text
ACTIVE
PAUSED
INACTIVE
```

Reason: a queue often needs to temporarily stop accepting customers without deleting it.

### 29.2 Counter OFFLINE state

Added:

```text
ACTIVE
ON_BREAK
OFFLINE
```

Reason: `ON_BREAK` and unavailable/offline are different operational states.

### 29.3 Token START endpoint

Added:

```http
POST /api/tokens/:tokenId/start
```

Reason: the original token lifecycle included `IN_PROGRESS` but did not define the operation that enters it.

### 29.4 Next-token operation

Added:

```http
POST /api/queues/:queueId/next
```

Reason: staff should not have to manually search for the next waiting token.

### 29.5 Idempotency

Added an idempotency key for token creation.

Reason: mobile network retries can otherwise create duplicate tokens.

### 29.6 Audit logs

Added an `AuditLog` entity.

Reason: staff actions need traceability in a real operational system.

### 29.7 Notification preferences

Added a dedicated notification preference model.

Reason: reminder time, sound, vibration, and notification status should be stored instead of being temporary UI settings.

### 29.8 Form versioning

Added form versions.

Reason: if a queue form changes after a customer joins, old token data must remain understandable.

### 29.9 Device model

Added a dedicated `Device` entity.

Reason: blocked-device management should not depend on an undeclared field inside the token table.

### 29.10 Soft deletion recommendation

Queue deletion should preferably archive a queue instead of immediately destroying historical records.

Reason: reports and historical token records are valuable.

### 29.11 Refresh/session handling

Added refresh-token/session support as a production recommendation.

Reason: a short-lived access token is safer than keeping a long-lived JWT.

### 29.12 Background notification architecture

Changed the requirement from relying on background Socket.io alone.

Reason: mobile operating systems can suspend background processes. Platform-supported push notifications are more reliable.

---

# 30. Features Removed or Changed

## 30.1 Node.js version

The original document required:

```text
Node.js LTS
```

This has been changed.

Use the current Node.js LTS version supported by the project.

Reason: production projects should not be tied to a short-lived non-LTS runtime unless there is a specific reason.

## 30.2 Automatic JWT refresh without an endpoint

The original dashboard description said:

```text
Token automatically refreshed when expired
```

but no refresh endpoint or refresh-token design existed.

This specification adds:

```http
POST /api/auth/refresh
```

The implementation must use an actual refresh/session strategy.

## 30.3 Generic "background server notifications"

This was too vague.

It is now split into:

- real-time updates while the app is active
- platform push notifications for background alerts

---

# 31. Development Order

Do not build everything at once.

Build in this order:

## Phase 1: Foundation

1. Repository setup
2. Backend
3. PostgreSQL
4. Prisma
5. Environment configuration
6. Error handling
7. Authentication
8. Organization model
9. Staff model

## Phase 2: Queue Core

1. Queue CRUD
2. Service CRUD
3. Counter CRUD
4. Queue status
5. Dynamic form builder
6. QR generation

## Phase 3: Token Engine

1. Token sequence
2. Token creation
3. Token status machine
4. Next token
5. Call
6. Start
7. Complete
8. Skip
9. Position
10. Estimated wait

## Phase 4: Real Time

1. Socket authentication
2. Organization rooms
3. Queue rooms
4. Token rooms
5. Dashboard events
6. Mobile events
7. Reconnection

## Phase 5: Mobile

1. QR scanner
2. Queue details
3. Service selection
4. Dynamic form
5. Token creation
6. Live tracking
7. Notification preferences
8. History

## Phase 6: Dashboard

1. Dashboard
2. Queue manager
3. Counter manager
4. Staff manager
5. Blocked devices
6. Reports
7. Audit logs
8. Organization settings

## Phase 7: Production Hardening

1. Rate limiting
2. Security headers
3. Logging
4. Audit logs
5. Error monitoring
6. Database backups
7. Push notifications
8. Load testing
9. Concurrency testing
10. Deployment

---

# 32. AI Coding Rules

This section is specifically for AI coding agents.

## Rule 1: Read before changing

Before modifying a file:

1. Inspect the existing code.
2. Understand its dependencies.
3. Check the Prisma schema.
4. Check related API routes.
5. Check related frontend/mobile usage.
6. Make the smallest safe change.

Do not rewrite unrelated code.

## Rule 2: Preserve architecture

Keep the three-app structure:

```text
backend
web-dashboard
mobile-app
```

Do not move everything into one application unless explicitly requested.

## Rule 3: Backend is authoritative

Never trust:

- frontend permission checks
- mobile form validation
- QR data
- device-provided organization IDs
- client-side token state

The backend must validate all important business rules.

## Rule 4: Tenant isolation is mandatory

Every organization-owned query must be scoped to the authenticated organization.

Bad:

```text
find token by tokenId
```

Good:

```text
find token where tokenId AND organizationId
```

## Rule 5: Do not duplicate business logic

Token state transitions and serial generation belong in backend services.

Do not implement separate token rules in React and Flutter.

## Rule 6: Real-time events follow successful database changes

Do not emit:

```text
token.completed
```

before the database transaction succeeds.

Correct:

```text
Database transaction succeeds
        ↓
Emit Socket.io event
```

## Rule 7: Do not invent APIs

If an endpoint is not specified:

1. Check existing routes.
2. Check controller/service code.
3. Check database schema.
4. Add a new endpoint only when necessary.
5. Document it.

## Rule 8: Keep historical data stable

Never overwrite historical token form data when queue configuration changes.

## Rule 9: Handle concurrency

Any operation involving:

- token sequence
- next token
- counter assignment
- token state changes

must consider concurrent requests.

## Rule 10: Explain breaking changes

If a change requires:

- database migration
- API contract change
- mobile update
- web update
- environment variable change

explain it before making the change.

---

# 33. UI/UX Principles

The system is operational software. Speed and clarity matter more than visual effects.

## Dashboard

Prioritize:

- large readable token numbers
- clear status colors
- fast actions
- minimal clicks
- live updates

## Mobile

Prioritize:

- simple joining flow
- clear token number
- clear position
- clear estimated wait
- obvious turn alert

Avoid:

- unnecessary animations
- complex onboarding
- excessive forms
- hidden important information

---

# 34. Performance Requirements

Target:

- API response for normal CRUD: under 500 ms in normal deployment conditions
- Token creation: under 500 ms excluding network latency
- Real-time event delivery: near real time
- Dashboard should not poll aggressively when Socket.io can provide the update

Use pagination for:

- staff
- tokens
- audit logs
- reports

Do not load thousands of records into the browser/mobile app at once.

---

# 35. Deployment

Recommended production architecture:

```text
Internet
   │
   ▼
Reverse Proxy / HTTPS
   │
   ├── React static files
   │
   └── Node.js API
          │
          ├── PostgreSQL
          └── Push notification service
```

Backend can run behind:

- Nginx
- managed platform
- container platform
- VPS

Use a process manager or container orchestration.

Database must have:

- regular backups
- migration process
- monitoring
- restricted public access

---

# 36. Monitoring

Production should monitor:

- API errors
- response time
- database errors
- Socket.io connections
- failed notification jobs
- token creation failures
- authentication failures
- server CPU/memory
- database storage

Recommended tools can be selected later.

Do not make monitoring provider-specific at the application architecture level.

---

# 37. Future Features

These are intentionally not part of the MVP.

## Phase 2 possibilities

- Advanced wait-time prediction
- Peak-hour analysis
- Staff performance analytics
- Full internationalization
- RTL support
- Offline queue operations
- Two-factor authentication
- Biometric mobile authentication
- Appointment scheduling
- Calendar integration
- CRM integration
- Payment gateway
- Digital display/TV screen
- SMS notifications
- WhatsApp notifications
- Multiple branches per organization
- Customer accounts
- Web-based customer queue joining

These should not be implemented until the core queue engine is stable.

---

# 38. MVP Scope

The first release should include:

```text
✓ Multi-organization
✓ Owner/Admin/Accountant
✓ Staff management
✓ Queue management
✓ Service management
✓ Counter management
✓ Dynamic forms
✓ QR joining
✓ Token generation
✓ Token lifecycle
✓ Position tracking
✓ Estimated wait
✓ Real-time updates
✓ Mobile notifications
✓ Token history
✓ Blocked devices
✓ Basic analytics
✓ CSV reports
✓ Audit logs
✓ Authentication
✓ Permission checks
✓ Tenant isolation
```

Do not include advanced ML prediction, payments, CRM, offline queue operations, or appointment scheduling in the first release.

---

# 39. Final Stack Summary

Use the following stack unless a documented project requirement requires a change:

```text
Backend:
Node.js LTS
Express.js
PostgreSQL
Prisma
Socket.io
JWT + refresh/session handling
Zod
Helmet
Rate limiting
Structured logging

Web:
React
Vite
React Router
Tailwind CSS
TanStack Query
React Context where appropriate
Socket.io Client

Mobile:
Flutter
Dart
Provider or equivalent
mobile_scanner
shared_preferences
socket_io_client
flutter_local_notifications
Firebase Cloud Messaging

Optional scaling:
Redis
```

### MVP infrastructure rule

Do not add Redis, Kafka, Kubernetes, microservices, or other infrastructure just because the application may grow later.

Start with:

```text
React Dashboard
       │
       ▼
Node.js + Express
       │
       ├── Socket.io
       │
       ▼
PostgreSQL + Prisma
       │
       ▼
Push Notification Service
```

Add Redis only when there is a measured need for:

- multiple backend instances
- Socket.io horizontal scaling
- caching
- distributed locks/coordination
- background job queues

This keeps the first release easier to develop, test, deploy, and maintain.

## Claude Code Project Instructions Template

Create `CLAUDE.md` in the repository root with content similar to the following:

```md
# LiveQueue Claude Code Instructions

## Source of truth

Read `docs/LiveQueue_AI_Ready_Specification.md` before making architecture or feature decisions.

## Architecture

- Backend: Node.js LTS + Express + TypeScript
- Database: PostgreSQL + Prisma
- Real-time: Socket.io
- Web: React + TypeScript + Vite + Tailwind + TanStack Query
- Mobile: Flutter + Dart
- Background notifications: Firebase Cloud Messaging

## Non-negotiable rules

- PostgreSQL is the source of truth.
- Backend business rules are authoritative.
- Enforce tenant isolation on the backend.
- Never trust client-supplied organization IDs.
- Use database transactions for critical token operations.
- Token creation must be idempotent.
- Emit Socket.io events only after successful persistence.
- Do not use Socket.io as a replacement for push notifications.
- Do not duplicate server state across multiple frontend stores.
- Do not add infrastructure that the current requirements do not justify.

## Development process

- Work one phase at a time.
- Read the relevant specification before coding.
- Inspect existing code before modifying it.
- Prefer small, reviewable changes.
- Run tests, lint, and type checks after implementation.
- Update `docs/PROGRESS.md`.
- Record important architectural decisions in `docs/ARCHITECTURE_DECISIONS.md`.
- Do not silently change requirements.
- Stop and ask when a requirement is ambiguous or contradictory.

## Security

- Never commit secrets.
- Validate all external input.
- Enforce authorization on the backend.
- Scope organization-owned queries to the authenticated tenant.
- Use safe error responses.
- Log security-relevant events without exposing secrets or sensitive credentials.
```

# 40. Final Implementation Principle

The most important business rule is:

> **LiveQueue must always keep the customer, staff dashboard, backend, and database synchronized around the same queue state.**

The database is the source of truth.

The backend enforces business rules.

Socket.io distributes successful state changes.

React displays operational controls.

Flutter displays the customer's live queue state.

Every feature should follow this pattern:

```text
User Action
    ↓
Frontend Validation
    ↓
Authenticated API Request
    ↓
Backend Authorization
    ↓
Backend Business Validation
    ↓
Database Transaction
    ↓
Successful State Change
    ↓
Socket.io Event
    ↓
Web + Mobile Update
    ↓
Notification if Required
```

An AI coding agent should treat this document as the product and architecture contract. When the existing code conflicts with this document, do not blindly overwrite the code. First identify the conflict, explain the impact, and then make the smallest change required to bring the implementation into alignment.
