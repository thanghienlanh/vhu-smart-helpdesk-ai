-- ============================================================
-- Migration 035 — VHU Smart Helpdesk AI: core extensions
-- ============================================================
-- Adapts the inherited HelpDesk schema for the "VHU Smart Helpdesk AI"
-- university IT-support workflow. This migration is ADDITIVE: it keeps
-- every inherited table/column/trigger/policy working unmodified and
-- layers the VHU-specific status machine, roles, categories, AI fields,
-- audit log, webhook log and rating table on top.
--
-- Compatibility strategy ("Hybrid"): the legacy `tickets.status` enum
-- (open/pending/closed) keeps driving the inherited CSAT-scheduling,
-- KB-generation gate, bulk actions, reports and SLA-business-hours
-- engine untouched. The new `tickets.vhu_status` column is the primary,
-- user-facing status for the VHU ticket workflow (10 states) and is
-- kept in sync into `status` by a trigger so none of those inherited
-- features break. See README.md "Đối chiếu schema" for the full table.

-- Roles and enum types (user_role 'manager', vhu_ticket_status,
-- ai_process_status) are created in migration 035_vhu_enum_extensions.sql —
-- split out because PostgreSQL cannot use a newly added enum value in the
-- same transaction it was added in.

-- --------------------------------------------------------
-- 3. Departments (VHU org units — distinct from the inherited
--    `teams` table, which groups end-users, not support staff)
-- --------------------------------------------------------
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 150),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY departments_select ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY departments_insert ON departments FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY departments_update ON departments FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY departments_delete ON departments FOR DELETE TO authenticated USING (is_admin());

-- --------------------------------------------------------
-- 4. profiles extensions
-- --------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 30),
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- is_active mirrors the inherited is_blocked flag (VHU spec names it
-- is_active; the inherited RLS helper is_blocked() keeps working as-is).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN GENERATED ALWAYS AS (NOT is_blocked) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_department_id ON profiles (department_id);

-- --------------------------------------------------------
-- 5. categories → extended in place to match ticket_categories
-- --------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS default_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS response_sla_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS resolution_sla_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS categories_updated_at ON categories;
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- --------------------------------------------------------
-- 6. Ticket code generator (IT-000001, collision-safe via sequence)
-- --------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS ticket_code_seq START 1;

CREATE OR REPLACE FUNCTION next_ticket_code()
RETURNS TEXT AS $$
  SELECT 'IT-' || lpad(nextval('ticket_code_seq')::text, 6, '0');
$$ LANGUAGE sql;

-- --------------------------------------------------------
-- 7. tickets: VHU columns
-- --------------------------------------------------------
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS ticket_code TEXT,
  ADD COLUMN IF NOT EXISTS vhu_status vhu_ticket_status NOT NULL DEFAULT 'NEW',
  -- Final priority (Manager/Admin decision). Kept in sync with the
  -- inherited `severity` column so the legacy severity-driven SLA
  -- business-hours engine and reports keep working unmodified.
  ADD COLUMN IF NOT EXISTS priority priority_level,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS device_name TEXT,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS desired_resolution_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_category TEXT,
  ADD COLUMN IF NOT EXISTS ai_priority priority_level,
  ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2) CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS ai_reason TEXT,
  ADD COLUMN IF NOT EXISTS ai_suggested_actions JSONB,
  ADD COLUMN IF NOT EXISTS ai_suggested_department TEXT,
  ADD COLUMN IF NOT EXISTS ai_status ai_process_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS ai_error TEXT,
  ADD COLUMN IF NOT EXISTS priority_adjusted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS priority_adjusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority_adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Backfill ticket_code for any pre-existing rows, then enforce NOT NULL
UPDATE tickets SET ticket_code = next_ticket_code() WHERE ticket_code IS NULL;
ALTER TABLE tickets ALTER COLUMN ticket_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_ticket_code ON tickets (ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_vhu_status ON tickets (vhu_status);
CREATE INDEX IF NOT EXISTS idx_tickets_department_id ON tickets (department_id);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets (priority);
CREATE INDEX IF NOT EXISTS idx_tickets_response_due_at ON tickets (response_due_at) WHERE first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_resolution_due_at ON tickets (resolution_due_at) WHERE resolved_at IS NULL;

-- --------------------------------------------------------
-- 8. tickets: triggers
-- --------------------------------------------------------

-- 8.1 Auto-generate ticket_code on insert
CREATE OR REPLACE FUNCTION set_ticket_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_code IS NULL THEN
    NEW.ticket_code := next_ticket_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_code ON tickets;
CREATE TRIGGER tickets_set_code BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_ticket_code();

-- 8.2 Default department from category when not explicitly set
CREATE OR REPLACE FUNCTION default_ticket_department()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.department_id IS NULL AND NEW.category_id IS NOT NULL THEN
    SELECT default_department_id INTO NEW.department_id FROM categories WHERE id = NEW.category_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_default_department ON tickets;
CREATE TRIGGER tickets_default_department BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION default_ticket_department();

-- 8.3 Default final priority from severity; mirror priority -> severity
-- so the inherited severity-driven SLA/business-hours engine and
-- reporting queries keep working without modification.
CREATE OR REPLACE FUNCTION default_ticket_priority()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.priority IS NULL THEN
    NEW.priority := COALESCE(NEW.severity, 'medium');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_default_priority ON tickets;
CREATE TRIGGER tickets_default_priority BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION default_ticket_priority();

CREATE OR REPLACE FUNCTION sync_priority_to_severity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.priority IS NOT NULL AND NEW.priority IS DISTINCT FROM OLD.priority THEN
    NEW.severity := NEW.priority;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_sync_priority_severity ON tickets;
CREATE TRIGGER tickets_sync_priority_severity BEFORE UPDATE OF priority ON tickets
  FOR EACH ROW EXECUTE FUNCTION sync_priority_to_severity();

-- 8.4 Compute flat SLA due timestamps from sla_policies/sla_severity_mapping
-- (VHU wants simple flat deadlines, unlike the inherited business-hours
-- timer engine in sla_timers — both coexist; see README).
CREATE OR REPLACE FUNCTION compute_ticket_sla_due()
RETURNS TRIGGER AS $$
DECLARE
  pol RECORD;
BEGIN
  SELECT sp.first_response_minutes, sp.resolution_minutes
    INTO pol
    FROM sla_severity_mapping ssm
    JOIN sla_policies sp ON sp.id = ssm.sla_policy_id
    WHERE ssm.severity = COALESCE(NEW.priority, NEW.severity);

  IF FOUND THEN
    NEW.response_due_at := NEW.created_at + make_interval(mins => pol.first_response_minutes);
    NEW.resolution_due_at := NEW.created_at + make_interval(mins => pol.resolution_minutes);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_sla_due_compute ON tickets;
CREATE TRIGGER tickets_sla_due_compute
  BEFORE INSERT OR UPDATE OF priority, severity ON tickets
  FOR EACH ROW WHEN (NEW.resolved_at IS NULL) EXECUTE FUNCTION compute_ticket_sla_due();

-- 8.5 Validate vhu_status transitions against ticket_status_transitions
-- (see section 9). This is defense-in-depth at the database level; the
-- primary "who is allowed" check happens in the Server Action layer.
CREATE OR REPLACE FUNCTION validate_ticket_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.vhu_status IS DISTINCT FROM OLD.vhu_status THEN
    IF NOT EXISTS (
      SELECT 1 FROM ticket_status_transitions
      WHERE from_status = OLD.vhu_status AND to_status = NEW.vhu_status
    ) THEN
      RAISE EXCEPTION 'Invalid ticket status transition: % -> %', OLD.vhu_status, NEW.vhu_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8.6 Lifecycle timestamps
CREATE OR REPLACE FUNCTION set_ticket_lifecycle_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.vhu_status = 'RESOLVED' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  IF NEW.vhu_status = 'CLOSED' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;
  IF NEW.vhu_status = 'REOPENED' THEN
    NEW.resolved_at := NULL;
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8.7 Sync legacy 3-state `status` from the new `vhu_status` so all
-- inherited features (CSAT scheduling, KB-generation gate, bulk close,
-- merge/duplicate close-behavior, reports) keep working unmodified.
CREATE OR REPLACE FUNCTION sync_legacy_ticket_status()
RETURNS TRIGGER AS $$
BEGIN
  NEW.status := CASE NEW.vhu_status
    WHEN 'NEW' THEN 'open'
    WHEN 'AI_ANALYZED' THEN 'open'
    WHEN 'ASSIGNED' THEN 'open'
    WHEN 'IN_PROGRESS' THEN 'open'
    WHEN 'REOPENED' THEN 'open'
    WHEN 'WAITING_USER' THEN 'pending'
    WHEN 'WAITING_CONFIRMATION' THEN 'pending'
    WHEN 'RESOLVED' THEN 'closed'
    WHEN 'CLOSED' THEN 'closed'
    WHEN 'CANCELLED' THEN 'closed'
  END::ticket_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8.8 Status history log
CREATE OR REPLACE FUNCTION log_ticket_status_history()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.vhu_status IS DISTINCT FROM OLD.vhu_status THEN
    INSERT INTO ticket_status_history (ticket_id, old_status, new_status, changed_by)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.vhu_status END, NEW.vhu_status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Numeric prefixes on UPDATE-OF-vhu_status triggers below fix firing
-- order (Postgres fires same-event triggers alphabetically by name):
-- validate -> lifecycle timestamps -> sync legacy status; history log
-- runs AFTER so it observes the final row.
DROP TRIGGER IF EXISTS tickets_10_validate_status_transition ON tickets;
DROP TRIGGER IF EXISTS tickets_20_lifecycle_timestamps ON tickets;
DROP TRIGGER IF EXISTS tickets_30_sync_legacy_status ON tickets;
DROP TRIGGER IF EXISTS tickets_40_log_status_history ON tickets;

-- 8.9 First response timestamp: set when the assigned agent's first
-- public post lands on the ticket.
CREATE OR REPLACE FUNCTION set_ticket_first_response()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.post_type = 'post' AND NOT NEW.is_private THEN
    UPDATE tickets
      SET first_response_at = COALESCE(first_response_at, now())
      WHERE id = NEW.ticket_id AND assigned_agent_id IS NOT NULL AND NEW.author_id = assigned_agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS posts_set_first_response ON posts;
CREATE TRIGGER posts_set_first_response
  AFTER INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION set_ticket_first_response();

-- --------------------------------------------------------
-- 9. Ticket status transition table (state machine, §6 of spec)
-- --------------------------------------------------------
CREATE TABLE ticket_status_transitions (
  from_status vhu_ticket_status NOT NULL,
  to_status vhu_ticket_status NOT NULL,
  allowed_roles TEXT[] NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

ALTER TABLE ticket_status_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_status_transitions_select ON ticket_status_transitions
  FOR SELECT TO authenticated USING (true);

INSERT INTO ticket_status_transitions (from_status, to_status, allowed_roles) VALUES
  ('NEW', 'AI_ANALYZED', ARRAY['system', 'manager', 'admin']),
  ('NEW', 'CANCELLED', ARRAY['user', 'manager', 'admin']),
  ('AI_ANALYZED', 'ASSIGNED', ARRAY['manager', 'admin']),
  ('AI_ANALYZED', 'CANCELLED', ARRAY['user', 'manager', 'admin']),
  ('ASSIGNED', 'IN_PROGRESS', ARRAY['agent', 'manager', 'admin']),
  ('ASSIGNED', 'CANCELLED', ARRAY['user', 'manager', 'admin']),
  ('IN_PROGRESS', 'WAITING_USER', ARRAY['agent', 'manager', 'admin']),
  ('IN_PROGRESS', 'WAITING_CONFIRMATION', ARRAY['agent', 'manager', 'admin']),
  ('IN_PROGRESS', 'ASSIGNED', ARRAY['agent', 'manager', 'admin']),
  ('WAITING_USER', 'IN_PROGRESS', ARRAY['agent', 'user', 'manager', 'admin']),
  ('WAITING_USER', 'WAITING_CONFIRMATION', ARRAY['agent', 'manager', 'admin']),
  ('WAITING_CONFIRMATION', 'RESOLVED', ARRAY['user', 'manager', 'admin']),
  ('WAITING_CONFIRMATION', 'REOPENED', ARRAY['user', 'manager', 'admin']),
  ('WAITING_CONFIRMATION', 'IN_PROGRESS', ARRAY['agent', 'manager', 'admin']),
  ('RESOLVED', 'CLOSED', ARRAY['manager', 'admin']),
  ('RESOLVED', 'REOPENED', ARRAY['user', 'manager', 'admin']),
  ('REOPENED', 'ASSIGNED', ARRAY['agent', 'manager', 'admin']),
  ('REOPENED', 'IN_PROGRESS', ARRAY['agent', 'manager', 'admin']),
  ('CLOSED', 'REOPENED', ARRAY['user', 'manager', 'admin']);

-- Now that ticket_status_transitions exists, attach the trigger chain.
CREATE TRIGGER tickets_10_validate_status_transition
  BEFORE UPDATE OF vhu_status ON tickets
  FOR EACH ROW EXECUTE FUNCTION validate_ticket_status_transition();

CREATE TRIGGER tickets_20_lifecycle_timestamps
  BEFORE UPDATE OF vhu_status ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_ticket_lifecycle_timestamps();

CREATE TRIGGER tickets_30_sync_legacy_status
  BEFORE INSERT OR UPDATE OF vhu_status ON tickets
  FOR EACH ROW EXECUTE FUNCTION sync_legacy_ticket_status();

CREATE TRIGGER tickets_40_log_status_history
  AFTER INSERT OR UPDATE OF vhu_status ON tickets
  FOR EACH ROW EXECUTE FUNCTION log_ticket_status_history();

-- --------------------------------------------------------
-- 10. Role helper functions (manager, department-scoped)
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean AS $$
  SELECT get_user_role() IN ('manager', 'admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_manager_of(dept_id UUID)
RETURNS boolean AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'manager' AND department_id = dept_id AND dept_id IS NOT NULL
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- --------------------------------------------------------
-- 11. ticket_status_history
-- --------------------------------------------------------
CREATE TABLE ticket_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  old_status vhu_ticket_status,
  new_status vhu_ticket_status NOT NULL,
  changed_by UUID REFERENCES profiles(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_status_history_ticket_id ON ticket_status_history (ticket_id);

ALTER TABLE ticket_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_status_history_select ON ticket_status_history
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_status_history.ticket_id AND (
        is_agent() OR t.creator_id = auth.uid() OR is_manager_of(t.department_id) OR is_teammate(t.creator_id)
      )
    )
  );

CREATE POLICY ticket_status_history_insert ON ticket_status_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- --------------------------------------------------------
-- 12. ticket_assignments (assignment history)
-- --------------------------------------------------------
CREATE TABLE ticket_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  assigned_from UUID REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id),
  assigned_by UUID NOT NULL REFERENCES profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_assignments_ticket_id ON ticket_assignments (ticket_id);

ALTER TABLE ticket_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_assignments_select ON ticket_assignments
  FOR SELECT TO authenticated USING (
    is_agent() OR EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_assignments.ticket_id
        AND (t.creator_id = auth.uid() OR is_manager_of(t.department_id))
    )
  );

CREATE POLICY ticket_assignments_insert ON ticket_assignments
  FOR INSERT TO authenticated WITH CHECK (
    is_agent() OR EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_assignments.ticket_id AND is_manager_of(t.department_id)
    )
  );

-- --------------------------------------------------------
-- 13. audit_logs (system-wide audit trail, §11 of spec)
-- --------------------------------------------------------
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id),
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_ticket_id ON audit_logs (ticket_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Written exclusively by the server-side audit service via the
-- service-role client — never from the browser.
CREATE POLICY audit_logs_insert_service ON audit_logs
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY audit_logs_select_admin ON audit_logs
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY audit_logs_select_manager ON audit_logs
  FOR SELECT TO authenticated USING (
    ticket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = audit_logs.ticket_id AND is_manager_of(t.department_id)
    )
  );

-- No UPDATE/DELETE policies for any authenticated role: audit_logs is
-- immutable from the application's perspective (Requester/Agent/Manager
-- cannot edit or delete it; only a direct service-role/DB-admin
-- connection could, which the application never exercises).

-- --------------------------------------------------------
-- 14. webhook_logs (Telegram delivery history, §10 of spec)
-- --------------------------------------------------------
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  http_status INTEGER,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_webhook_logs_idempotency ON webhook_logs (idempotency_key);
CREATE INDEX idx_webhook_logs_ticket_id ON webhook_logs (ticket_id);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_logs_all_service ON webhook_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY webhook_logs_select_admin ON webhook_logs
  FOR SELECT TO authenticated USING (is_admin());

-- --------------------------------------------------------
-- 15. ticket_ratings (1-5 star CSAT tied to an authenticated
--    Requester — distinct from the inherited anonymous-token
--    `csat_ratings` table, which stays as-is)
-- --------------------------------------------------------
CREATE TABLE ticket_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE UNIQUE,
  requester_id UUID NOT NULL REFERENCES profiles(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ticket_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_ratings_select ON ticket_ratings
  FOR SELECT TO authenticated USING (
    requester_id = auth.uid() OR is_agent() OR EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_ratings.ticket_id AND is_manager_of(t.department_id)
    )
  );

CREATE POLICY ticket_ratings_insert ON ticket_ratings
  FOR INSERT TO authenticated WITH CHECK (
    requester_id = auth.uid()
    AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_ratings.ticket_id AND t.creator_id = auth.uid())
  );

CREATE POLICY ticket_ratings_update ON ticket_ratings
  FOR UPDATE TO authenticated USING (requester_id = auth.uid()) WITH CHECK (requester_id = auth.uid());

-- --------------------------------------------------------
-- 16. notifications: add title (kept nullable — inherited consumers
--    only rely on `message`)
-- --------------------------------------------------------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;

-- --------------------------------------------------------
-- 17. SLA policies seeded/updated with VHU thresholds
--    (§13 of spec). Reuses the inherited sla_policies +
--    sla_severity_mapping tables — 'critical' severity carries the
--    URGENT label in the UI.
-- --------------------------------------------------------
INSERT INTO sla_policies (name, first_response_minutes, resolution_minutes) VALUES
  ('VHU - Thấp', 1440, 4320),
  ('VHU - Trung bình', 480, 2880),
  ('VHU - Cao', 120, 720),
  ('VHU - Khẩn cấp', 15, 120)
ON CONFLICT (name) DO UPDATE SET
  first_response_minutes = EXCLUDED.first_response_minutes,
  resolution_minutes = EXCLUDED.resolution_minutes;

UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Thấp') WHERE severity = 'low';
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Trung bình') WHERE severity = 'medium';
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Cao') WHERE severity = 'high';
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Khẩn cấp') WHERE severity = 'critical';

-- Recompute SLA due dates for existing rows now that mappings exist.
UPDATE tickets t SET
  response_due_at = t.created_at + make_interval(mins => sp.first_response_minutes),
  resolution_due_at = t.created_at + make_interval(mins => sp.resolution_minutes)
FROM sla_severity_mapping ssm
JOIN sla_policies sp ON sp.id = ssm.sla_policy_id
WHERE ssm.severity = COALESCE(t.priority, t.severity) AND t.resolved_at IS NULL;

-- --------------------------------------------------------
-- 18. Additive RLS policies granting Manager visibility/edit rights
--    scoped to their department. These ADD to (never replace) the
--    inherited tickets_select/tickets_update policies — Postgres
--    combines permissive policies for the same command with OR.
-- --------------------------------------------------------
CREATE POLICY tickets_select_manager ON tickets
  FOR SELECT TO authenticated USING (is_manager_of(department_id));

CREATE POLICY tickets_update_manager ON tickets
  FOR UPDATE TO authenticated USING (is_manager_of(department_id)) WITH CHECK (is_manager_of(department_id));

-- --------------------------------------------------------
-- 19. Baseline config data: departments + 12 IT categories (§5/§7 of
--    spec). Demo TICKETS (not config) are seeded separately in
--    supabase/seed.sql.
-- --------------------------------------------------------
INSERT INTO departments (name, description) VALUES
  ('Phòng Hạ tầng mạng', 'Phụ trách hệ thống mạng, Internet, thiết bị mạng toàn trường'),
  ('Phòng Quản trị hệ thống', 'Phụ trách máy chủ, tài khoản, an toàn thông tin, phần mềm đào tạo'),
  ('Phòng Thiết bị - Phòng học', 'Phụ trách máy tính phòng học, máy chiếu, thiết bị phòng học, máy in'),
  ('Phòng Công nghệ thông tin', 'Bộ phận CNTT tổng hợp, xử lý các yêu cầu khác')
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, description, default_department_id, response_sla_minutes, resolution_sla_minutes)
SELECT c.name, c.description, d.id, c.response_sla_minutes, c.resolution_sla_minutes
FROM (VALUES
  ('Mạng Internet', 'Sự cố kết nối mạng, Internet, Wi-Fi', 'Phòng Hạ tầng mạng', 120, 720),
  ('Máy tính phòng học', 'Sự cố máy tính tại các phòng học, phòng thực hành', 'Phòng Thiết bị - Phòng học', 120, 720),
  ('Máy chiếu', 'Sự cố máy chiếu, màn chiếu tại phòng học', 'Phòng Thiết bị - Phòng học', 120, 720),
  ('Thiết bị phòng học', 'Sự cố thiết bị khác trong phòng học (âm thanh, điều khiển...)', 'Phòng Thiết bị - Phòng học', 480, 2880),
  ('Email trường', 'Sự cố tài khoản, hộp thư email của trường', 'Phòng Quản trị hệ thống', 480, 2880),
  ('Tài khoản sinh viên', 'Sự cố tài khoản đăng nhập hệ thống của sinh viên', 'Phòng Quản trị hệ thống', 480, 2880),
  ('Cổng thông tin sinh viên', 'Sự cố truy cập, hiển thị trên cổng thông tin sinh viên', 'Phòng Quản trị hệ thống', 480, 2880),
  ('Phần mềm đào tạo', 'Sự cố phần mềm quản lý đào tạo, học vụ', 'Phòng Quản trị hệ thống', 480, 2880),
  ('Cài đặt phần mềm', 'Yêu cầu cài đặt, cập nhật phần mềm', 'Phòng Công nghệ thông tin', 1440, 4320),
  ('An toàn thông tin', 'Sự cố bảo mật, virus, rò rỉ dữ liệu', 'Phòng Quản trị hệ thống', 15, 120),
  ('Máy in', 'Sự cố máy in, máy photocopy dùng chung', 'Phòng Thiết bị - Phòng học', 480, 2880),
  ('Yêu cầu khác', 'Các yêu cầu hỗ trợ CNTT khác chưa được phân loại', 'Phòng Công nghệ thông tin', 1440, 4320)
) AS c(name, description, dept_name, response_sla_minutes, resolution_sla_minutes)
JOIN departments d ON d.name = c.dept_name
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  default_department_id = EXCLUDED.default_department_id,
  response_sla_minutes = EXCLUDED.response_sla_minutes,
  resolution_sla_minutes = EXCLUDED.resolution_sla_minutes,
  is_active = true;
