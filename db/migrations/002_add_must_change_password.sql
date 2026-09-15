-- One-time migration: adds must_change_password to users, so accounts an
-- ADMIN provisions (or resets) with a backend-generated temporary password
-- must change that password before the account can be used. Enforced in
-- authMiddleware and the Socket.io handshake.
-- NOT re-runnable — the column will already exist after the first
-- successful run. Run once, manually, against the live database.
--
-- No backfill: existing accounts either chose their own password, came
-- from Google, or are seed accounts, and no column records which accounts
-- were created with an admin-typed password, so they cannot be flagged
-- selectively. Flagging every DEPARTMENT_AUTHORITY row would lock out the
-- seed accounts the test suite logs in with.
--
-- Rollback: ALTER TABLE users DROP COLUMN must_change_password;
-- Before rolling back, reset the password of every user with
-- must_change_password = true — otherwise they keep an admin-known
-- temporary password with no enforcement.

BEGIN;

ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMIT;
