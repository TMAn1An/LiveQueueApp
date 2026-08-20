# LiveQueue Claude Code Instructions

## 1. Project Source of Truth

The main product and technical specification is:

docs/LiveQueue_AI_Ready_Specification.md

Always read the relevant part of the specification before implementing a feature.

Do not silently change requirements.

If the specification is unclear or contains a contradiction:

1. Identify the problem.
2. Explain the impact.
3. Propose the safest solution.
4. Ask for approval before making a major architectural change.

---

## 2. Project Architecture

LiveQueue consists of three applications.

### Backend

- Node.js LTS
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Socket.io
- JWT authentication
- Zod validation

### Web Dashboard

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- TanStack Query
- Socket.io Client

### Mobile App

- Flutter
- Dart
- Provider or an appropriate equivalent state management solution
- mobile_scanner
- shared_preferences
- socket_io_client
- flutter_local_notifications
- Firebase Cloud Messaging for background push notifications

---

## 3. Core Architecture Rules

These rules are mandatory.

### Database

PostgreSQL is the primary source of truth.

Do not create another source of truth in:

- React state
- Flutter state
- Socket.io
- Redis
- local storage

Client-side state is only a representation of server state.

### Backend

Business rules belong in the backend.

Do not put important business rules inside:

- React components
- Flutter widgets
- Socket.io event handlers
- route controllers

Use appropriate service/domain layers.

### Multi-tenancy

LiveQueue is a multi-tenant system.

Every organization-owned database operation must be scoped to the authenticated organization.

Never trust an organization ID supplied by:

- React
- Flutter
- request body
- query parameters
- URL parameters

The authenticated user's organization must determine tenant access.

A user from Organization A must never access Organization B data.

### Authorization

Frontend permission checks are only for user experience.

The backend must enforce:

- authentication
- organization membership
- roles
- permissions
- resource ownership

Never rely on frontend authorization.

---

## 4. Token System Rules

Token operations are business-critical.

Use database transactions for operations that can affect queue consistency.

This includes:

- token creation
- token numbering
- token calling
- next token selection
- counter assignment
- token state transitions

Token creation must be idempotent.

Network retries must not create duplicate tokens.

Token state transitions must be validated centrally.

Do not allow arbitrary token status changes from the frontend.

---

## 5. Real-Time Rules

Socket.io is used for real-time communication.

However:

PostgreSQL = source of truth.

Socket.io = notification/distribution mechanism.

Never treat Socket.io as the database.

Only emit important Socket.io events after the related database transaction succeeds.

Example:

Correct:

Database transaction
        ↓
Transaction succeeds
        ↓
Emit Socket.io event

Incorrect:

Emit Socket.io event
        ↓
Try database operation

The second approach can cause clients to display false information.

---

## 6. Mobile Notification Rules

Do not depend on a permanent Socket.io connection for background notifications.

Mobile operating systems may suspend background applications.

Use Firebase Cloud Messaging or another proper push notification system for background notifications.

Socket.io should mainly handle live updates while the application is active.

---

## 7. React Rules

Use TanStack Query for server state.

Examples:

- queues
- services
- counters
- tokens
- staff
- reports
- dashboard statistics

Do not store the same server data in multiple competing state systems.

React Context should be used only for small application-level state when appropriate.

Examples:

- authentication/session state
- simple UI settings

Do not put business logic inside React components.

Keep components focused on presentation and interaction.

---

## 8. Flutter Rules

Keep business logic outside UI widgets.

Use clear separation between:

- screens
- widgets
- state
- services
- API communication
- models

Do not duplicate backend business rules in Flutter.

The backend remains authoritative.

---

## 9. Validation

Validate all external input.

Backend request validation must use Zod or an equivalent strongly typed validation layer.

Never assume frontend validation is enough.

Validate:

- request body
- route parameters
- query parameters
- authentication input
- token operations
- dynamic form submissions

---

## 10. Security

Never commit:

- passwords
- JWT secrets
- API keys
- Firebase private keys
- database credentials
- production environment files
- certificates
- private tokens

Use environment variables for secrets.

Add appropriate:

- authentication
- authorization
- rate limiting
- input validation
- secure headers
- CORS configuration
- safe error responses
- structured security logging

Do not expose internal stack traces or sensitive information to clients.

---

## 11. Code Quality

Write production-quality code.

Prefer:

- TypeScript
- strong typing
- small functions
- small focused modules
- clear naming
- reusable components
- centralized validation
- centralized error handling
- database transactions
- automated tests

Avoid:

- giant files
- giant functions
- duplicated business logic
- unnecessary abstractions
- magic numbers
- `any` unless there is a documented reason
- premature optimization
- unnecessary dependencies
- unnecessary microservices

---

## 12. Infrastructure

Do not introduce infrastructure just because it might be useful someday.

MVP should remain simple.

Do not add:

- Redis
- Kafka
- Kubernetes
- microservices
- message brokers

unless there is a documented technical requirement.

Redis may be introduced later if the system needs:

- distributed Socket.io scaling
- caching
- distributed locks
- background job queues
- multiple backend instances

---

## 13. Development Workflow

Never try to build the entire project in one uncontrolled pass.

Work in phases.

Recommended order:

1. Architecture and planning
2. Project foundation
3. Database and Prisma
4. Authentication and organizations
5. Staff and permissions
6. Queue/service/counter management
7. Token engine
8. Real-time system
9. React dashboard
10. Flutter mobile app
11. Notifications
12. Reports and audit logs
13. Security hardening
14. Testing
15. Production readiness

Complete and verify one phase before moving to the next.

---

## 14. Before Coding

Before implementing a new feature:

1. Read the relevant specification.
2. Inspect existing code.
3. Understand current architecture.
4. Identify affected modules.
5. Identify database changes.
6. Identify API changes.
7. Identify frontend/mobile changes.
8. Identify tests required.

Do not immediately start changing files.

---

## 15. Changes Must Be Focused

Do not perform unrelated refactoring while implementing a feature.

If you discover a separate problem:

1. Mention it.
2. Record it if important.
3. Continue with the current task unless it blocks the work.

Avoid large unnecessary rewrites.

---

## 16. Testing

After implementation:

1. Run TypeScript type checking.
2. Run linting.
3. Run unit tests.
4. Run integration tests where applicable.
5. Run relevant end-to-end tests.
6. Fix failures.
7. Re-run the tests.

Do not claim a feature is complete when tests are failing.

---

## 17. Documentation

Maintain:

docs/IMPLEMENTATION_PLAN.md

docs/ARCHITECTURE_DECISIONS.md

docs/PROGRESS.md

Update these files when appropriate.

Record important architectural decisions.

Do not duplicate the entire product specification inside these files.

---

## 18. Git

Use Git throughout development.

Complete work in small logical commits.

Before committing:

- run tests
- run type checks
- run lint
- inspect the Git diff
- make sure no secrets are included

Do not rewrite Git history unless explicitly instructed.

---

## 19. AI Behavior

You are the implementation agent, not the product owner.

Do not invent major requirements.

Do not silently change architecture.

Do not silently remove features.

Do not blindly follow a technically dangerous requirement.

If a requirement creates a serious architectural or security problem:

1. Stop.
2. Explain the problem.
3. Explain the consequence.
4. Give a recommended solution.
5. Ask for approval when the change is significant.

Prefer simple, maintainable solutions.

---

## 20. Important Rule

When asked to implement a large feature:

DO NOT immediately generate a huge amount of code.

First understand the existing system.

Then make a plan.

Then implement the smallest complete piece.

Then test it.

Then continue.

Quality is more important than speed.