# Code Diff — request-service
_Reference: atdd.md, plan.md_

## Files Created
- `backend/services/requests.service.js` — `createRequest`, `claimRequest`, `changeRequestStatus`, `changePriority`, all transaction-wrapped via a shared `withTransaction(fn)` helper
- `backend/controllers/requests.controller.js` — thin controllers, mirrors `auth.controller.js`'s shape
- `backend/routes/requests.routes.js` — `POST /`, `POST /:id/assign`, `PATCH /:id/status`, `PATCH /:id/priority`

## Files Modified
- `backend/server.js` — mounted `/api/requests` behind `authMiddleware` (its first real usage). No other line touched.
- `backend/package.json` — unrelated to this task: still carries the `"seed": "node seed.js"` script added earlier as part of resolving plan.md's blocking dependency (see below); no new packages added for this task itself (`pg`'s `Pool.connect()` needed no new dependency).

## Supporting file (written directly, not via code-copilot, per plan.md's resolved Open Question)
- `backend/seed.js` — populates 3 departments, 4 request_types, 2 `DEPARTMENT_AUTHORITY` users, idempotent. Required because the DB had zero rows in `departments`/`request_types`/`users`, and `DEPARTMENT_AUTHORITY` cannot be created through any API (self-registration always forces `EMPLOYEE`) — without this, neither integration tests nor manual Postman verification could exercise `claimRequest`/`changeRequestStatus`/`changePriority` at all.

## Acceptance Criteria Coverage (independently verified — live end-to-end testing against the real DB, not just code reading)

| AC | Status | How verified |
|----|--------|--------------|
| 1 — createRequest happy path, department_id server-resolved, sla_due_at computed | ✅ | Live: `201`, full row returned, `sla_due_at` (18:34:38.897Z) exactly `created_at` (14:34:38.897Z) + 4h for `HIGH` — millisecond-exact, confirming the timestamp-consistency fix (see below) actually works |
| 2 — claimRequest happy path | ✅ | Live: `200`, `status→ASSIGNED`, `assigned_to` set, `request_history`/`notifications` rows confirmed via direct DB query |
| 3 — claim conflict (already claimed) | ✅ | Live: second claim attempt on the same request → `409` "Bu talep zaten üstlenilmiş" |
| 4 — cross-department claim rejected | ✅ | Live: HR authority attempting to claim an IT-department request → `403` "Bu departmana ait değil" |
| 5 — ASSIGNED→IN_PROGRESS by assigned officer | ✅ | Live: `200` |
| 6 — invalid/reopen transitions rejected | ✅ | Live: `IN_PROGRESS→ASSIGNED` → `400`; `COMPLETED→IN_PROGRESS` (post-completion) → `400` — no reopen path exists |
| 7 — REJECTED requires note | ✅ | Live: `REJECTED` without `note` → `400` "Red sebebi belirtilmeli" |
| 8 — reject authorization (assigned-only for non-OPEN transitions) | ✅ | Live: a different department's officer attempting to reject an already-ASSIGNED request → `403` |
| 9 — priority change by assigned officer, sla_due_at recomputed from original created_at | ✅ | Live: `200`, `sla_due_at` recomputed to `created_at + 72h` for `LOW` — anchored at the original `created_at`, not "now" |
| 10 — priority change rejected on OPEN (unassigned) requests | ✅ | Live: `403` "Bu işlem için yetkiniz yok" |
| 11 — invalid/inactive request_type_id | ✅ | Live: nonexistent id → `404`; existing-but-inactive id → `400`; no row inserted in either case |
| 12 — transaction atomicity on DB error | ✅ (code review only) | Not live-simulated (same as auth task's AC9 — DB-outage simulation deemed impractical); `withTransaction` wraps every write path in `BEGIN`/`COMMIT`/`ROLLBACK`, code-reviewed and structurally identical across all 4 functions |

Also verified: COMPLETED/REJECTED transitions create the correct `notifications` rows (`REQUEST_COMPLETED`/`REQUEST_REJECTED`) to the request's `created_by`; `/health` and `/api/auth/*` behavior unchanged after this change (live-checked).

## Review findings caught and fixed (2 rounds with the same subagent)

1. **Race condition (real bug)** — `changePriority`'s UPDATE originally had no `status`/`assigned_to` guard in its WHERE clause, unlike `claimRequest`/`changeRequestStatus` which both correctly implement the "expected state in WHERE clause" optimistic-concurrency pattern CLAUDE.md requires generalized across every transition. This meant a request could have its priority silently changed after concurrently transitioning to a terminal state or being reassigned. **Fixed**: `changePriority`'s UPDATE now guards on `id`, `status IN ('ASSIGNED','IN_PROGRESS')`, and `assigned_to`, returning `409` on 0 rows affected — same pattern as the other two functions. Re-verified live (403 pre-check on a COMPLETED request's priority-change attempt still works; the deeper race-guard itself is a structural code-review confirmation, a true concurrent race is impractical to reproduce deterministically in manual testing).
2. **Timestamp precision** — `createRequest` originally computed `sla_due_at` from a JS-side `new Date()` that was never actually written to the row's `created_at` column (which used the DB's own `DEFAULT now()` instead) — a small, non-zero drift between the two. **Fixed**: the same JS timestamp is now explicitly inserted into both `created_at` and used to compute `sla_due_at`, guaranteeing exact consistency. Confirmed live: millisecond-exact match between the two columns in the response.

## Post-Red-Team Fixes
Red-team review (`red_team.json`) found 1 medium + 2 low fixable findings, all addressed by the same subagent and independently re-verified (25/25 tests still pass, three live curl checks confirming each fix, no regressions):
- `createRequest`: now rejects `role === 'ADMIN'` with 403, consistent with `claimRequest`/`changeRequestStatus`/`changePriority` — closes the gap where ADMIN could create requests despite the ATDD decision that ADMIN has no write access in this task.
- `changeRequestStatus`: the `REJECTED`-note check now type-checks (`typeof note !== 'string'`) before calling `.trim()`, so a non-string `note` returns a clean 400 instead of leaking a raw `TypeError`.
- `createRequest`: now explicitly rejects empty/missing `title`/`description` with a 400, instead of falling through to the DB's `NOT NULL` constraint and a vague 500.

## Remaining Limitations
- AC12 (DB outage mid-transaction) not live-tested, same accepted gap pattern as the auth task.
- ADMIN write-bypass, `request_comments`, `COMMENT_ADDED` notifications, and any cron/SLA-escalation job are all correctly absent (explicitly out of scope per atdd.md).

## Assumptions
- `REQUEST_ASSIGNED`/`REQUEST_COMPLETED`/`REQUEST_REJECTED` notifications all go to the request's `created_by` (the employee), matching atdd.md's stated assumption — confirmed this is what the code does.
- Invalid `priority` values (not LOW/MEDIUM/HIGH) in `createRequest`/`changePriority` are rejected with 400 "Geçersiz öncelik" — not explicitly required by an AC but necessary to avoid a raw DB CHECK-constraint error leaking to the client.

## CAVEMAN Review
- **Files added**: exactly the 3 planned service/controller/route files, no more (plus `seed.js`, which was separately authorized in `plan.md`, not part of this code-copilot delegation).
- **New abstractions**: `withTransaction(fn)` (BEGIN/COMMIT/ROLLBACK wrapper, reused identically by all 4 functions — real, present duplication avoided) and `computeSlaDueAt(anchor, priority)` (shared by `createRequest`/`changePriority`, pre-approved in the task spec as justified). No other abstractions.
- **New public APIs**: exactly the 4 service functions and 4 routes required, nothing extra.
- **Complexity justification**: `VALID_TRANSITIONS` is a plain data map (not a state-machine library or class), matching the project's existing preference for explicit code over frameworks. No ADMIN-bypass code path exists (correctly, per scope).
