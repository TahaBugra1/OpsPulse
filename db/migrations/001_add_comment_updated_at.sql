-- One-time migration: adds edit/delete support to request_comments
-- (updated_at for edit tracking, is_deleted for tombstone-style delete)
-- and attaches the existing set_updated_at() trigger to the table.
-- NOT re-runnable — the columns/trigger will already exist after the
-- first successful run. Run once, manually, against the live database.

BEGIN;

ALTER TABLE request_comments ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE request_comments ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing rows just got `now()` as updated_at from the ALTER
-- above, not their own created_at. Without this, every pre-existing
-- comment would incorrectly show as "edited" the first time anyone views it.
UPDATE request_comments SET updated_at = created_at;

CREATE TRIGGER trg_request_comments_updated_at
  BEFORE UPDATE ON request_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
