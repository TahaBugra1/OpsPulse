# OpsPulse (Company Operations Hub) — Project Context for Claude Code

## Development workflow — read this first

This repo uses a self-contained workflow toolkit at `atdd-pipeline/`
(`atdd → plan → code-copilot → test-copilot → verify → red-team → commit`)
for feature work. **Full mechanics live in `atdd-pipeline/README.md` and
`atdd-pipeline/nasil_kullanilir.md` — read those, don't rely on a summary
here going stale.** Project-specific guidance on *when* to use the full
chain vs. coding directly is in `docs/atdd_pipeline_usage_guide.md`.

Never-violate rules (full mechanics behind these are in the files above):

- `atdd`: 8-12 adaptive clarification questions, never skipped.
- `plan`: read-only, never authors code.
- `code-copilot` / `test-copilot`: actual authoring happens ONLY inside a
  subagent (`Agent` tool). This session never `Write`/`Edit`s
  implementation or test files directly in this flow.
- `verify`: real PASS/FAIL/N/A from actually running gates, never faked.
- `red-team`: no external model, never modifies code, only reports findings
  + a Ready-to-Commit verdict.
- `commit`: never auto-triggered — always stops for explicit approval.
- Resuming a task: resume at the first missing file under
  `artifacts/<task-slug>/`, never from scratch.
- `jira-sync` is not used on this project — no Jira/Saga instance exists.

Do not run the full pipeline on mechanical, low-risk tasks (project
scaffolding, seed scripts, straightforward CRUD once a pattern exists) —
see the decision table in `docs/atdd_pipeline_usage_guide.md`. Do run it in
full for anything touching auth, authorization, the request state machine,
or real-time security.

Stack (once scaffolded): React, Node.js, Express, PostgreSQL, JWT, Google
OAuth, bcrypt. No `package.json` exists yet — populate the actual
build/lint/test commands here once it does.

---

## HOW YOU SHOULD OPERATE (project-level rules)

You are the implementation partner for a project whose architecture, database, and scope have already been through four independent red-team review rounds and a formally approved Strategic Upgrade Blueprint. This document is the source of truth for those decisions.

Rules:

1. Do NOT redesign the database, the role model, the state machine, or the security model. They are settled.
2. If something below looks technically wrong, say so explicitly before implementing it — but do not silently change it either. State the conflict, propose the fix, wait for confirmation unless it's a pure bug (e.g. a typo in this doc vs. `schema.sql`).
3. `db/schema.sql` is the literal source of truth for the database. If anything in this document's prose ever disagrees with `schema.sql`, **`schema.sql` wins** — flag the mismatch, don't guess.
4. Centralize writes. Every table-mutating operation for `requests` goes through one service function per concern (see "Backend Architecture"). Never write ad hoc UPDATE/INSERT statements against `requests` from a controller.
5. Backend authorization is authoritative. Frontend checks are UX only, never trust them for anything security-sensitive.
6. When implementing a feature, prefer small, testable steps over large code dumps. State what you're about to build and why before writing it.
7. Nothing described in "Explicitly Out of Scope" gets implemented unless the user explicitly asks for it in this exact session, by name.

---

## PROJECT VISION

OpsPulse is a company operations platform that securely manages internal requests (IT/HR/Finance) through an audited, role-based workflow, provides SLA visibility and operational analytics derived from that audit trail, gives real-time operational visibility, and — only if time remains — adds focused, non-authoritative AI-assisted decision support. It is not primarily an AI product; AI is a thin optional layer on a system that works completely without it.

This is a **20-day solo delivery**. The guaranteed target, protected above everything else, is:

```
CORE + ANALYTICS 2A + REAL-TIME 3A + REAL-TIME 3B
```

Everything past that (Analytics 2B/2C, Real-Time 3C, all of AI, RAG) is upside, not requirement. Fallback order if time runs short:

```
Cut first: RAG → AI Priority Rationale → AI Summary → AI Classification → Real-Time 3C → Analytics 2C
Protect always: Core, Analytics 2A, Real-Time 3A, Real-Time 3B
```

---

## ROLES

Exactly three, no others:

```
EMPLOYEE              — creates/tracks own requests, comments on them
DEPARTMENT_AUTHORITY  — sees only their managed department's requests, claims/processes/rejects
ADMIN                 — sees everything, manages users, system-wide dashboard
```

Registration NEVER allows selecting a role. All self-registration (email/password or Google) produces `role = EMPLOYEE`. Admins and department authorities are created only via seed data or an Admin-only user-management screen — never through the public registration form. This is a deliberate privilege-escalation defense, not an oversight; do not add a role dropdown to registration under any circumstance.

`users.department_id` is nullable in general, but `CHECK`-enforced `NOT NULL` specifically for `DEPARTMENT_AUTHORITY` (a NULL department here silently breaks that officer's own "my department's requests" query — NULL matches nothing in SQL).

---

## DATABASE

Source of truth: `db/schema.sql` (7 tables: `departments`, `users`, `request_types`, `requests`, `request_comments`, `request_history`, `notifications`). Visual reference: `db/schema.dbml` (paste into dbdiagram.io). **Neither has ever been executed against a real running Postgres instance yet** — only syntax-validated. The very first implementation task is proving it runs cleanly against a real database (Docker Compose recommended) before writing any application code against it.

Non-obvious design decisions you must preserve, not "clean up":

- **`requests.department_id` is a write-once snapshot**, resolved server-side from `request_types.department_id` at creation time inside the same transaction as the INSERT. It is **never** accepted from client input, and it is never updated after creation, even if the request_type's routing mapping later changes. This preserves historical routing accuracy — do not "simplify" this into a JOIN-derived value.
- **FK delete policy is deliberately RESTRICT almost everywhere** (protects audit/history integrity) with exactly two exceptions: `notifications.user_id`/`notifications.request_id` are `ON DELETE CASCADE` (notifications are UI convenience, not an audit record). Never change a RESTRICT to CASCADE to "make deletion easier" — there is no user-facing hard-delete for requests or users in this system at all; users are deactivated (`is_active = false`), never deleted.
- **`request_number`** (SERIAL) is a display-only sequential reference (`#1024`). **Never use it in URLs, API lookups, or authorization checks** — `id` (UUID) is the real identifier everywhere except UI display.
- **`role`/`status`/`priority`/`request_history.action`/`notifications.type`** are `VARCHAR` + `CHECK`, deliberately **not** native Postgres `ENUM` — CHECK is far easier to alter mid-project (adding/renaming a value is a one-line `ALTER TABLE`, not a type-recreation dance).
- **`requests.sla_due_at`** is computed once at creation (`created_at` + a priority-based duration, e.g. HIGH=4h/MEDIUM=24h/LOW=72h) and **recomputed by the service layer if priority later changes** (anchor stays `created_at`, not "now"). No cron job reads it yet — it currently only powers frontend "overdue" highlighting via a comparison at read time.
- **`is_active` exists only on `users`, `departments`, `request_types`** — never on `requests` (its lifecycle is already fully represented by `status`; a second "is this gone" flag would be redundant and confusing).
- **`notifications.type`** is a structured enum-like field separate from the free-text `message`, specifically so the frontend can choose an icon/color without parsing message text.
- **Resolution-time calculations must NEVER use `requests.updated_at`** (it reflects the *last* modification of any kind, not necessarily completion). Compute from `request_history`: the most recent row where `action = 'STATUS_CHANGED' AND new_value = 'COMPLETED'` for that request, using that row's `created_at`.
- Two `CHECK` constraints exist as **defense-in-depth backstops**, not the primary enforcement — the primary enforcement is always in the service layer so the user gets a clean 4xx error, not a raw constraint violation: `requests` (status/assigned_to consistency: OPEN⇒unassigned, ASSIGNED/IN_PROGRESS/COMPLETED⇒assigned, REJECTED⇒either) and `request_history` (`note` required when `new_value = 'REJECTED'`).
- `users.password_hash` and `users.google_id` are both nullable (a user can be local-only, Google-only, or both), guarded by `CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)` — an account with neither is an account nobody can ever log into.

---

## REQUEST STATE MACHINE — LOCKED

```
OPEN → ASSIGNED
OPEN → REJECTED
ASSIGNED → IN_PROGRESS
ASSIGNED → REJECTED
IN_PROGRESS → COMPLETED
IN_PROGRESS → REJECTED
```

`COMPLETED` and `REJECTED` are terminal. **There is no reopen.** No `COMPLETED → IN_PROGRESS`, no `REJECTED → OPEN`, in the core, in analytics, in real-time, or in AI. If a user needs further work after completion/rejection, they create a new request. Do not add a "Reopen" button or transition anywhere.

Claiming (`OPEN → ASSIGNED`) must be atomic via a conditional UPDATE, not select-then-update:

```sql
UPDATE requests
SET status = 'ASSIGNED', assigned_to = $1, updated_at = now()
WHERE id = $2 AND status = 'OPEN';
```

If the affected row count is 0, return 409 Conflict ("already claimed"). This same "put the expected current state in the WHERE clause" pattern should generalize to every status transition, not just claiming — a double-click on any transition button must not be able to write the same history event twice.

Also validate in the service layer (not the database): `assigned user.role = DEPARTMENT_AUTHORITY AND assigned user.department_id = request.department_id`. This does not need a DB constraint — the only code path that ever writes `assigned_to` already scopes claimable requests to the officer's own department, making a DB-level trigger redundant.

---

## SECURITY

- **Two-layer authorization, always**: role-based (route level — "can this role call this endpoint") AND object-level (query level — "does this resource actually belong to this user/department"). Role checks alone are insufficient; every query for a specific resource must filter by the authenticated user's own scope, never trust a client-supplied department/user ID for scoping.
- **`is_active` must be re-checked from the database on every authenticated request**, not just trusted from the JWT payload — otherwise deactivating a user takes up to an hour to actually take effect (JWT lifetime), not immediately.
- **JWT**: 1-hour access token, no refresh-token infrastructure. `expiresIn` varies by a `rememberMe` flag at login: `'1h'` (sessionStorage) if unchecked, `'7d'` (localStorage) if checked — same signing mechanism, just a different lifetime, not a different architecture. No revocation mechanism exists; this is an accepted, deliberate risk for an internal tool.
- **Google OAuth account linking**: match by Google's *verified* email claim against the existing `citext`-unique `users.email`. If a match exists, link `google_id` to that row; otherwise create a new user. Role is always `EMPLOYEE` regardless of registration path — this is a separate code path from email/password registration and must independently enforce the same rule. **Known unresolved risk**: local registration has no email verification step, so someone could register a fake account claiming another employee's real email, and Google-linking would then attach the real employee's Google identity to the attacker's account. Mitigation: restrict self-registration to a configurable corporate email domain (application-layer check, not hardcoded in DDL). Full email verification is out of scope unless explicitly requested.
- **AI endpoints need their own rate limit**, independent of the login rate limiter — LLM calls are slow and cost money per call.
- **AI must never be authoritative**: the LLM suggests `request_type`/`priority`; the backend validates the suggestion against real `request_types` rows before ever showing it to the user (never trust raw LLM output as a foreign key); the user can accept or override; if the LLM call fails or times out, request creation must still work normally via manual selection — AI is never a blocking dependency.
- **Prompt injection**: when sending request descriptions/comments/history to an LLM (classification, summary), treat all embedded user content as data, never as instructions, in the prompt template.
- **Real-time (Socket.io) needs its own authentication and authorization** — REST's object-level authorization does not automatically extend to WebSocket events. Authenticate the socket connection with JWT at handshake. Use role/department-scoped rooms (an EMPLOYEE's socket only receives events for their own requests/notifications; a DEPARTMENT_AUTHORITY's only for their managed department; ADMIN can receive system-wide). **Never use unrestricted global broadcast** — design this scoping in from the first line of real-time code, not as a retrofit.
- CORS restricted to the actual client origin (no wildcard). Helmet + express-rate-limit on the whole API, plus the AI-specific limiter above.

---

## BACKEND ARCHITECTURE

```
Route → Controller (thin) → Service (business rules + queries) → PostgreSQL
```

No separate Repository layer — Service owns both business logic and the queries it needs (e.g. `requestService.js` does both). This is a deliberate simplification for a solo project, not an oversight.

Every write to `requests` goes through the same small set of centralized service functions (e.g. `createRequest`, `changeRequestStatus`, `claimRequest`, `changePriority`) — these are the *only* places that mutate `requests`, log to `request_history`, and create notifications. New code paths (a new endpoint, an AI feature, a real-time trigger) must call into these functions, never write around them. This is what makes the audit trail, the SLA recompute-on-priority-change, and the "every write is logged" guarantee actually hold.

`updated_at` is trigger-managed (`set_updated_at()` in `schema.sql`, applied to `users` and `requests`) — do not also set it manually in application code; the trigger already handles it.

---

## API DESIGN PRINCIPLES

- Operation-specific endpoints, not a generic bypassable PATCH: `POST /api/requests/:id/assign`, `PATCH /api/requests/:id/status`, `PATCH /api/requests/:id/priority`. No endpoint should let a client set `status` or `assigned_to` outside these dedicated, workflow-aware paths.
- No request DELETE endpoint exists or should exist.
- URLs and API operations use `id` (UUID). `request_number` is returned in response payloads for display only.
- New surfaces from the upgrade layers (add only when actually building that layer):

```
GET  /api/analytics/summary | distribution | sla | workload
WS   request:updated | request:commented | notification:created
POST /api/requests/suggest-classification   (own rate limit, DB-validated output, non-blocking)
POST /api/requests/:id/summarize            (own rate limit, same object-level auth as viewing the request)
```

---

## UPGRADE LAYERS (build in this order, per the approved priority)

1. Core stability (confirm SLA/notifications/audit fully wired end to end)
2. Analytics 2A — summary cards, SLA compliance, avg resolution time, department workload (zero schema impact, pure derived queries)
3. Real-Time 3A — Request Detail live status/priority/comment updates
4. Real-Time 3B — live notification badge
5. Analytics 2B — distribution charts, volume over time
6. Real-Time 3C — authority queue live claim-removal (first real-time item cut if behind)
7. Analytics 2C — bottleneck/overload detection (first analytics item cut if behind)
8. AI Classification — only if the required layers above are actually done, not just planned
9. AI Summary — only as a follow-on to classification, sharing its service infrastructure, never built standalone first
10. AI Priority Rationale — first AI feature cut if time is short
11. RAG/pgvector — explicitly not this cycle

None of layers 2–10 require a database schema change. If implementing one of them seems to require a new table, stop and flag it — that's a signal something is being over-built relative to what was scoped.

---

## EXPLICITLY OUT OF SCOPE

Do not implement unless the user explicitly asks for it by name in this session:

```
Reopen functionality
Multi-department requests
File attachments
Email/SMS notifications
Automatic/cron-based SLA escalation
Microservices, event-driven architecture, generic rule engines
RAG / pgvector / embeddings
Native PostgreSQL ENUM types (use VARCHAR + CHECK)
A separate Repository layer
Refresh-token infrastructure
```

---

## CURRENT PROJECT STATE (as of handoff to this session)

**Zero application code exists.** No `package.json`, no backend/frontend folders, no `.git`. What exists is entirely design output: `db/schema.sql` (never executed against real Postgres), `db/schema.dbml`, and this document. Do not assume any backend/frontend scaffolding, dependencies, or configuration already exist — check before building on top of anything.

## FIRST TASK

1. Scaffold the repo (`backend/`, `frontend/`, git init).
2. Docker Compose a Postgres instance and run `db/schema.sql` against it for the first time — confirm it completes without error before anything else.
3. Only then start the Express skeleton.

Do not skip step 2. The schema has been reviewed four times but never actually executed.
