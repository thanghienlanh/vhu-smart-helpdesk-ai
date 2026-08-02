-- ============================================================
-- Migration 035 — VHU Smart Helpdesk AI: enum extensions
-- ============================================================
-- Split out from migration 036 on its own: PostgreSQL forbids using a newly
-- added enum value (`ALTER TYPE ... ADD VALUE`) in the same transaction it
-- was added in (SQLSTATE 55P04 "unsafe use of new value"), and `supabase db
-- reset` applies each migration file as one transaction. Migration 036's
-- `is_manager()` function references the enum literal 'manager' directly in
-- a LANGUAGE SQL body, which Postgres parses/validates at CREATE FUNCTION
-- time — so the new label must already be committed from a prior migration.
-- `CREATE TYPE ... AS ENUM (...)` for brand-new types has no such
-- restriction (all its values are known from the start), but is kept here
-- too for a single, easy-to-audit "schema additions" migration.

-- --------------------------------------------------------
-- 1. Add the "manager" role (additive — does not rename/remove existing values)
-- --------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager';

-- --------------------------------------------------------
-- 2. VHU ticket status + AI process status enums
-- --------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vhu_ticket_status') THEN
    CREATE TYPE vhu_ticket_status AS ENUM (
      'NEW', 'AI_ANALYZED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER',
      'WAITING_CONFIRMATION', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_process_status') THEN
    CREATE TYPE ai_process_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
  END IF;
END
$$;
