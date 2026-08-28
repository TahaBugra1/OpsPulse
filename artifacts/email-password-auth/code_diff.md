# Code Diff — email-password-auth
_Reference: atdd.md, plan.md_

## Files Created
- `backend/services/auth.service.js` — `register`, `login` business logic (validation, bcrypt, JWT, DB queries via shared `pool`)
- `backend/controllers/auth.controller.js` — `postRegister`, `postLogin` thin controllers (try/catch → HTTP status), mirrors `health.controller.js`
- `backend/routes/auth.routes.js` — `POST /register`, `POST /login` (with a dedicated email-keyed rate limiter on `/login`), mirrors `health.routes.js`
- `backend/middleware/auth.middleware.js` — JWT verify + live `is_active` DB recheck; exported, **not mounted anywhere** (AC7 scope — no `/me` route in this task)

## Files Modified
- `backend/server.js` — mounted `authRoutes` at `/api/auth`, after `/health`, before `errorHandler`. No other line touched.
- `backend/.env`, `backend/.env.example` — appended `ALLOWED_EMAIL_DOMAIN` (existing lines untouched).
- `backend/package.json` — **not touched**, as instructed (all deps already present).

## Acceptance Criteria Coverage (independently verified, not just the subagent's claim)

| AC | Status | How verified |
|----|--------|--------------|
| 1 — register happy path, order format→domain→uniqueness→password→hash→INSERT | ✅ | Read the code; **found the subagent's own report misstated the order** (claimed uniqueness-before-password when code did password-before-uniqueness) — sent it back for a fix, re-verified the corrected file, then confirmed live via curl (201, correct token+user shape, no `password_hash` in response) |
| 2 — login happy path, rememberMe → 1h/7d | ✅ | Live curl: 200, `{token, user}` shape |
| 3 — inactive user login → 403 | ✅ | Live test: set `is_active=false` directly in DB, login with correct password → 403 "Hesap aktif değil" |
| 4 — duplicate email → 409 | ✅ | Live curl: second register with same email → 409 "Bu email zaten kayıtlı" |
| 5 — wrong domain → 400 | ✅ | Live curl: `ali@gmail.com` against `ALLOWED_EMAIL_DOMAIN=opspulse.com` → 400 |
| 6 — login rate limiter, 5/15min, email-keyed | ✅ | Live test: 6 sequential login calls for the same email → first attempts succeed/fail normally, 6th call → 429 |
| 7 — auth middleware, live `is_active` recheck, unmounted | ✅ | Read the code (queries DB on every call, doesn't trust JWT payload for `is_active`); sanity-loaded the module (`require` succeeds, exports a function); confirmed not referenced in `server.js` or any route |
| 8 — password <8 chars → 400 | ✅ | Live curl: 3-char password → 400 "Şifre en az 8 karakter olmalı" |
| 9 — DB error on INSERT → 500 generic | ✅ | Read the code (try/catch around INSERT, non-`23505` errors → 500 generic message); not live-tested (would require simulating a DB outage) — code inspection only |

## Remaining Limitations
(carried from subagent's own report, independently confirmed by reading the code)
- No email verification, refresh tokens, Google OAuth, `/me` route, or forgot-password — all correctly out of scope per atdd.md.
- Login error message is generic ("Email veya şifre hatalı") for both nonexistent user and wrong password — standard practice, not explicitly required or forbidden by atdd.md (AC4's explicit-message requirement applies to registration only).
- Login implicitly rejects Google-only accounts (`password_hash IS NULL`) — correct given this task only covers email/password login.

## Assumptions
- `ALLOWED_EMAIL_DOMAIN=opspulse.com` set as the real dev-local value in `.env` (no domain was specified by the project); `.env.example` uses `example.com` as a placeholder.
- Register uses a pre-check SELECT + a `23505` catch as a race-safe backstop (both approaches were explicitly allowed by the plan).
- bcrypt cost factor 10 (not specified in atdd.md — standard default).
- Email format validated with a simple, permissive regex, not RFC 5322-complete — sufficient for a corporate-domain-gated internal tool.

## CAVEMAN Review
- **Files added**: exactly the 4 planned, no more.
- **New abstractions**: 3 small in-file helpers in `auth.service.js` (`toPublicUser`, `signToken`, `emailDomain`), each used ≥2 times in the same file — avoids literal duplication across `register`/`login`, not speculative. No new abstraction layer, no validation framework, no error-class hierarchy.
- **New public APIs**: `auth.service.js` exports `{ register, login }`; `auth.controller.js` exports `{ postRegister, postLogin }`; `auth.routes.js` exports a Router; `auth.middleware.js` exports one function — same shape as the existing `health.*` files, nothing extra.
- **Complexity justification**: no config beyond the one required env var, no speculative extension points, straight-line validation matching existing project conventions.
- One process deviation caught during review: the subagent's *report* of its own implementation didn't match the *code* it wrote (validation order). Fixed via a targeted follow-up to the same subagent, re-verified independently after the fix — not editing the file directly, per the pipeline rule.

## Post-Red-Team Fixes
Red-team review (`red_team.json`) found 2 medium + 1 low fixable finding, all addressed by the same subagent and independently re-verified (12/12 tests still pass, live smoke test still correct):
- `auth.service.js`: `register()`'s uniqueness SELECT and `login()`'s credential SELECT are now wrapped in try/catch, sanitizing DB errors into generic 500 messages (previously only the INSERT had this protection) — business-logic checks (409/401/403) remain outside the try/catch, unaffected.
- `auth.middleware.js`: its DB query is now wrapped in try/catch, returning 500 instead of hanging on an unhandled rejection.
- `auth.service.js`: added a `fail(status, message)` helper, replacing 7 repeated `new Error(...); err.status=...; throw err;` blocks.

## One deviation from plan.md worth flagging
`plan.md` listed `backend/package.json` under "Files to Modify" (to add `supertest` as a devDependency) — that was explicitly scoped to the **test-copilot** step, not this one, and the subagent correctly left `package.json` untouched. `supertest` still needs to be added when `test-copilot` runs.
