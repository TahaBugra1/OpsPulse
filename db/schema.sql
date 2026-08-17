-- ============================================================
-- OpsPulse (Company Operations Hub) — PostgreSQL schema
-- FINAL — approved as source of truth after 4 red-team review
-- rounds + Strategic Upgrade Blueprint approval. Assumes PostgreSQL
-- 13+. Analytics, real-time, and AI layers all read this schema
-- as-is — none of them require a schema change (see blueprint).
-- Reopen is explicitly NOT part of the state machine (locked scope).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- Shared trigger function for updated_at. Applied to tables with more
-- than one independent write path (users: role/is_active/password
-- changes; requests: status-transition service + scoped priority PATCH).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- departments
-- ------------------------------------------------------------
CREATE TABLE departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  -- Real orgs retire/reorganize departments over time. RESTRICT on
  -- every FK into this table already protects historical requests —
  -- is_active only controls whether it's offered for NEW requests.
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(150) NOT NULL,
  -- Nullable: Google accounts may omit family_name. Restored after two
  -- prior DISAGREE verdicts on this exact question — the new technical
  -- reason is that Google OAuth supplies given_name/family_name as
  -- separate fields natively, which this column now maps onto directly.
  surname        VARCHAR(150),
  email          CITEXT NOT NULL UNIQUE,
  -- Nullable for Google-only users (no local password ever set).
  password_hash  VARCHAR(255),
  -- Google's `sub` claim: a numeric-string identifier, not a UUID.
  google_id      VARCHAR(255) UNIQUE,
  role           VARCHAR(30) NOT NULL DEFAULT 'EMPLOYEE'
                   CHECK (role IN ('EMPLOYEE', 'DEPARTMENT_AUTHORITY', 'ADMIN')),
  -- Nullable for EMPLOYEE/ADMIN by design (keeps an optional future
  -- "home department" for EMPLOYEE stats possible without a migration).
  -- Enforced NOT NULL specifically for DEPARTMENT_AUTHORITY below, since
  -- a NULL department here would silently break that officer's own
  -- "my department's requests" query (NULL matches nothing in SQL).
  department_id  UUID REFERENCES departments(id) ON DELETE RESTRICT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role != 'DEPARTMENT_AUTHORITY' OR department_id IS NOT NULL),
  -- Prevents an account with no possible way to ever log in.
  CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- request_types
-- ------------------------------------------------------------
CREATE TABLE request_types (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(150) NOT NULL UNIQUE,
  department_id  UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- requests
-- ------------------------------------------------------------
CREATE TABLE requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Display-only sequential number ("#1024" in the UI). Never used in
  -- URLs/API lookups or authorization checks — id (UUID) stays the
  -- actual identifier everywhere else, so a sequential, guessable
  -- number is never exposed as something someone could enumerate.
  request_number   SERIAL UNIQUE,
  title            VARCHAR(200) NOT NULL,
  description      TEXT NOT NULL,
  request_type_id  UUID NOT NULL REFERENCES request_types(id) ON DELETE RESTRICT,
  -- SERVER-DERIVED ONLY: resolved from request_types.department_id at
  -- creation time, inside the same transaction as the INSERT. The API
  -- must never accept this field from client input (see review §6) —
  -- accepting it would let a request be created with request_type_id
  -- and department_id pointing to different departments.
  department_id    UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_by       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to      UUID REFERENCES users(id) ON DELETE RESTRICT,
  priority         VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'
                     CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  status           VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')),
  -- Computed once at creation (created_at + a priority-based duration,
  -- e.g. HIGH=4h/MEDIUM=24h/LOW=72h) and recomputed by the service
  -- layer if priority later changes. No lookup table for 3 fixed
  -- durations — that's config, not data. No cron job reads this yet;
  -- for now it only powers frontend "overdue" highlighting, same
  -- pattern as the priority-based visual emphasis decided earlier.
  sla_due_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevents impossible states: OPEN must be unassigned; ASSIGNED/IN_PROGRESS/
  -- COMPLETED must be assigned; REJECTED may be either.
  CHECK (
    (status = 'OPEN' AND assigned_to IS NULL)
    OR (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED') AND assigned_to IS NOT NULL)
    OR (status = 'REJECTED')
  )
);

CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_requests_department_status ON requests(department_id, status);
CREATE INDEX idx_requests_created_by ON requests(created_by);
CREATE INDEX idx_requests_assigned_to ON requests(assigned_to);
-- Partial: only non-terminal requests are ever "overdue" in a way anyone cares about.
CREATE INDEX idx_requests_sla_overdue ON requests(sla_due_at) WHERE status NOT IN ('COMPLETED', 'REJECTED');

-- ------------------------------------------------------------
-- request_comments
-- ------------------------------------------------------------
CREATE TABLE request_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_comments_request_id ON request_comments(request_id);

-- ------------------------------------------------------------
-- request_history
-- action set: assignment is captured implicitly via actor_id on a
-- STATUS_CHANGED row (claiming = OPEN -> ASSIGNED), so no separate
-- ASSIGNED action exists. PRIORITY_CHANGED covers the scoped PATCH
-- endpoint's write path, keeping every write to `requests` auditable.
-- ------------------------------------------------------------
CREATE TABLE request_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  actor_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action      VARCHAR(30) NOT NULL
                CHECK (action IN ('CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED')),
  old_value   VARCHAR(30),
  new_value   VARCHAR(30),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Defense-in-depth backstop for "rejection requires a note"; primary
  -- enforcement stays in the application service layer.
  CHECK (new_value IS DISTINCT FROM 'REJECTED' OR note IS NOT NULL)
);

CREATE INDEX idx_request_history_request_id ON request_history(request_id);

-- ------------------------------------------------------------
-- notifications
-- Not an audit table (unlike request_history) — purely a UI
-- convenience, so CASCADE is appropriate here even though the rest of
-- this schema is deliberately RESTRICT-heavy. message is a plain,
-- backend-composed string (e.g. "Your request #1024 has been
-- assigned to Mehmet Yilmaz") rather than a type+params structure —
-- simplest option for the ~3 notification kinds this MVP needs.
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  UUID REFERENCES requests(id) ON DELETE CASCADE,
  -- Structured kind, separate from the free-text message, so the
  -- frontend can pick the right icon/color without parsing message
  -- text (which the mockup shows as visually distinct per kind).
  type        VARCHAR(30) NOT NULL
                CHECK (type IN ('REQUEST_ASSIGNED', 'REQUEST_COMPLETED', 'REQUEST_REJECTED', 'COMMENT_ADDED')),
  message     TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: only unread rows, since the one query that matters
-- (the header badge count) only ever cares about read_at IS NULL, and
-- this keeps the index small even as read notifications pile up.
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

-- Full index for the "View all notifications" list — the partial
-- index above can't serve this query since it doesn't filter on
-- read_at.
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
