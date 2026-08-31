# Plan — email-password-auth
_Reference: atdd.md_

## Files to Modify

| File | Why | Risk |
|------|-----|------|
| `backend/server.js` | Mount `/api/auth` routes; add a second, login-specific rate limiter (email-keyed, 5/15min — AC6) separate from the existing global `apiLimiter` | low |
| `backend/.env`, `backend/.env.example` | Add `ALLOWED_EMAIL_DOMAIN` (AC5) | low |
| `backend/package.json` | Add `supertest` as a devDependency for integration tests (test-copilot step); no new runtime deps — `bcrypt`, `jsonwebtoken` already installed | low |

## New Files

| File | Purpose |
|------|---------|
| `backend/routes/auth.routes.js` | `POST /register`, `POST /login` — mirrors `routes/health.routes.js` pattern (thin `Router`, delegates to controller) |
| `backend/controllers/auth.controller.js` | `register`, `login` — thin try/catch → HTTP status, same shape as `controllers/health.controller.js` |
| `backend/services/auth.service.js` | Business logic: email domain check, uniqueness check, password length check, bcrypt hash/compare, JWT sign (`expiresIn` from `rememberMe`), all DB access via `services/db.js`'s shared `pool` (same reuse pattern `health.service.js` already established) |
| `backend/middleware/auth.middleware.js` | JWT verify + **re-reads `is_active` from DB on every call** (AC7) — not wired to any route in this task (see Open Questions #2 resolution below); exported standalone for isolated unit testing and for future protected routes to import |

## Dependencies

- `backend/services/db.js` — existing shared `pg.Pool`, reused as-is (same pattern `health.service.js` uses: `const pool = require('./db')`)
- `bcrypt` (already in `package.json`, v6) — hash on register, compare on login
- `jsonwebtoken` (already in `package.json`) — sign on register/login
- `express-rate-limit` (already in `package.json`) — second instance in `server.js` with a `keyGenerator` returning `req.body.email` instead of IP
- `supertest` (new devDependency, test-copilot only) — HTTP-level integration testing against the Express app without binding a real port
- Node's built-in `node:test` + `node:assert` — test runner, zero new runtime dependency

## Migration Required?
**No.** Verified against `db/schema.sql` — the `users` table already has every column this task needs: `email` (citext, unique), `password_hash` (nullable varchar), `role` (default `'EMPLOYEE'`), `department_id` (nullable), `is_active` (boolean, default true), `created_at`/`updated_at` (trigger-managed). `ALLOWED_EMAIL_DOMAIN` is an application-layer check only, not a DB constraint — no `ALTER TABLE`.

## Risks
_(carried over from atdd.md, plus what exploration found)_
- Login rate-limiter uses `express-rate-limit`'s default in-memory store — fine for the current single-instance MVP, breaks down under horizontal scaling (already flagged in atdd.md as an accepted risk).
- No test framework existed in `package.json` before this task — resolved via user decision: `node:test` + `supertest`, zero extra runtime weight.
- `auth.middleware.js` is written but not mounted on any route in this task (per Kapsam Dışı — `/me` is optional/future) — it will only be exercised by isolated unit tests (mock `req`/`res`/`next`), not by an integration test hitting a real endpoint. This is a deliberate scope boundary, not a gap: AC7's guarantee (`is_active` re-checked from DB) lives in the middleware's own logic, verified in isolation.

## Open Questions
_(resolved before hand-off — recorded here per skill convention)_
1. **Test runner** — resolved: `node:test` + `supertest`.
2. **AC7 test approach without a mounted protected route** — resolved: isolated unit test of `auth.middleware.js`, no route mounted in this task.

No further open questions — ready for `code-copilot`.
