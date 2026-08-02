-- ============================================================
-- Phase 2 — Seed Data: Users & Teams
-- ============================================================
-- Phase 2 seeds ONLY users and teams.
-- Ticket types already exist from Phase 1 migration.
-- This file will be extended in later phases.

-- Enable pgcrypto for password hashing.
-- On Supabase Cloud the extension is pre-installed in the `extensions` schema
-- and `public` does not get it. Locally `supabase start` installs it into
-- `public`. Either way, schema-qualifying the calls below (extensions.crypt,
-- extensions.gen_salt) keeps the seed working in both environments.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- --------------------------------------------------------
-- Users (auth.users)
-- The handle_new_user trigger auto-creates profiles rows.
-- UUIDs use range ...0011 - ...0018 to avoid conflict
-- with test UUIDs in 001-schema.test.ts (which use ...0001 - ...0007).
-- --------------------------------------------------------

DO $$
DECLARE
  _users JSONB := '[
    {"id":"00000000-0000-0000-0000-000000000011","email":"admin@example.com","name":"Admin"},
    {"id":"00000000-0000-0000-0000-000000000012","email":"agent.smith@example.com","name":"Agent Smith"},
    {"id":"00000000-0000-0000-0000-000000000013","email":"agent.jones@example.com","name":"Agent Jones"},
    {"id":"00000000-0000-0000-0000-000000000014","email":"alice@example.com","name":"Alice"},
    {"id":"00000000-0000-0000-0000-000000000015","email":"bob@example.com","name":"Bob"},
    {"id":"00000000-0000-0000-0000-000000000016","email":"carol@example.com","name":"Carol"},
    {"id":"00000000-0000-0000-0000-000000000017","email":"dave@example.com","name":"Dave"},
    {"id":"00000000-0000-0000-0000-000000000018","email":"eve@example.com","name":"Eve"}
  ]'::jsonb;
  _u JSONB;
BEGIN
  FOR _u IN SELECT * FROM jsonb_array_elements(_users) LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous,
      confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current,
      email_change, reauthentication_token, email_change_confirm_status
    ) VALUES (
      (_u->>'id')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated',
      _u->>'email',
      extensions.crypt('Password123', extensions.gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('display_name', _u->>'name'),
      '{"provider":"email","providers":["email"]}'::jsonb,
      false, false,
      '', '', '', '', '', '', 0
    );
  END LOOP;
END $$;

-- --------------------------------------------------------
-- Identity records (required for email/password login)
-- --------------------------------------------------------

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  id::text,
  now(), now(), now()
FROM auth.users
WHERE id IN (
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000012'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid,
  '00000000-0000-0000-0000-000000000015'::uuid,
  '00000000-0000-0000-0000-000000000016'::uuid,
  '00000000-0000-0000-0000-000000000017'::uuid,
  '00000000-0000-0000-0000-000000000018'::uuid
);

-- --------------------------------------------------------
-- Update profiles: set roles
-- --------------------------------------------------------

UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000011';
UPDATE profiles SET role = 'agent' WHERE id = '00000000-0000-0000-0000-000000000012';
UPDATE profiles SET role = 'agent' WHERE id = '00000000-0000-0000-0000-000000000013';

-- --------------------------------------------------------
-- Team: "Alice's Team" with Alice, Bob, Carol
-- --------------------------------------------------------

INSERT INTO teams (id, name) VALUES ('00000000-0000-0000-0000-000000000110', 'Alice''s Team');

UPDATE profiles SET team_id = '00000000-0000-0000-0000-000000000110' WHERE id IN (
  '00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000016'
);

-- ============================================================
-- Phase 3 — Seed Data: Tickets, Posts, Comments, Notes
-- ============================================================

-- Get the default ticket type ID (Question)
DO $$
DECLARE
  _type_question UUID;
  _type_issue UUID;
  _type_suggestion UUID;
  _tid1 BIGINT; _tid2 BIGINT; _tid3 BIGINT; _tid4 BIGINT;
  _tid5 BIGINT; _tid6 BIGINT; _tid7 BIGINT; _tid8 BIGINT; _tid9 BIGINT;
BEGIN
  SELECT id INTO _type_question FROM ticket_types WHERE name = 'Question';
  SELECT id INTO _type_issue FROM ticket_types WHERE name = 'Issue';
  SELECT id INTO _type_suggestion FROM ticket_types WHERE name = 'Suggestion';

  -- --------------------------------------------------------
  -- Alice's tickets (3): open, pending, closed
  -- --------------------------------------------------------

  -- Ticket 1: Alice - open, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Password reset not working', 'password-reset-not-working', 'open', 'high', 'medium', false, _type_issue,
          '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000012')
  RETURNING id INTO _tid1;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000014',
    E'I tried to reset my password using the forgot password link but I never received the email. I have checked my spam folder.\n\n**Steps to reproduce:**\n1. Click "Forgot password"\n2. Enter email\n3. Wait for email — never arrives',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000012',
    'Hi Alice, I can see the reset email was sent successfully from our end. Could you please check if you have any email filters that might be blocking it? Also, please verify the email address you used.',
    'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000014',
    'I double-checked and it is the correct email. No filters found either. Still not receiving it.',
    'post');

  -- Agent note (will render in Phase 6)
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000012',
    'Checked mail logs — delivery confirmed. Might be ISP-level blocking. Escalating to email team.',
    'note');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid1, '00000000-0000-0000-0000-000000000014');

  -- Ticket 2: Alice - pending, private
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Feature request: dark mode', 'feature-request-dark-mode', 'pending', 'low', 'low', true, _type_suggestion,
          '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000013')
  RETURNING id INTO _tid2;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid2, '00000000-0000-0000-0000-000000000014',
    'Would love to see a **dark mode** option in the application. Working late at night and the bright screen is hard on the eyes.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid2, '00000000-0000-0000-0000-000000000013',
    'Thanks for the suggestion! We have this on our roadmap. Marking as pending while we evaluate the timeline.',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid2, '00000000-0000-0000-0000-000000000014');

  -- Ticket 3: Alice - closed
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('How to export data?', 'how-to-export-data', 'closed', 'medium', 'low', false, _type_question,
          '00000000-0000-0000-0000-000000000014')
  RETURNING id INTO _tid3;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid3, '00000000-0000-0000-0000-000000000014',
    'How can I export my data to CSV? I looked in the settings but could not find an export option.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid3, '00000000-0000-0000-0000-000000000012',
    E'Go to **Settings > Data > Export** and select CSV format. You can also use the API endpoint `/api/export`.\n\nLet me know if that helps!',
    'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid3, '00000000-0000-0000-0000-000000000014',
    'Found it, thank you!',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid3, '00000000-0000-0000-0000-000000000014');

  -- --------------------------------------------------------
  -- Bob's tickets (2): one open (public), one closed (duplicate)
  -- --------------------------------------------------------

  -- Ticket 4: Bob - open, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('Billing shows wrong amount', 'billing-shows-wrong-amount', 'open', 'critical', 'high', false, _type_issue,
          '00000000-0000-0000-0000-000000000015')
  RETURNING id INTO _tid4;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid4, '00000000-0000-0000-0000-000000000015',
    E'My invoice for this month shows $299 but my plan is $99/month. This is the third time this has happened.\n\n```\nInvoice #12345\nAmount: $299.00\nExpected: $99.00\n```',
    true, 'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid4, '00000000-0000-0000-0000-000000000015');

  -- Ticket 5: Bob - closed, duplicate of ticket 1 (Alice's password reset)
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, duplicate_of_id)
  VALUES ('Cannot reset password', 'cannot-reset-password', 'closed', 'medium', 'medium', false, _type_issue,
          '00000000-0000-0000-0000-000000000015', _tid1)
  RETURNING id INTO _tid5;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid5, '00000000-0000-0000-0000-000000000015',
    'When I try to reset my password, the reset email never arrives. I have tried multiple times.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid5, '00000000-0000-0000-0000-000000000012',
    E'This ticket has been closed as a duplicate of [#' || _tid1 || '](/tickets/' || _tid1 || '/password-reset-not-working).',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid5, '00000000-0000-0000-0000-000000000015');

  -- --------------------------------------------------------
  -- Carol's tickets (2): one open, one pending
  -- --------------------------------------------------------

  -- Ticket 6: Carol - open, private
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Bug in search results', 'bug-in-search-results', 'open', 'high', 'high', true, _type_issue,
          '00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000012')
  RETURNING id INTO _tid6;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid6, '00000000-0000-0000-0000-000000000016',
    E'The search feature is returning completely irrelevant results. When I search for "billing", I get results about "password reset".\n\nThis started happening after the last update.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid6, '00000000-0000-0000-0000-000000000012',
    'Thanks for reporting this. We have identified the issue with the search indexing. Working on a fix now.',
    'post');

  -- Comment (will render in Phase 6)
  INSERT INTO posts (ticket_id, author_id, body, post_type, parent_post_id)
  VALUES (_tid6, '00000000-0000-0000-0000-000000000016',
    'Any ETA on the fix?',
    'comment',
    (SELECT id FROM posts WHERE ticket_id = _tid6 AND author_id = '00000000-0000-0000-0000-000000000012' AND post_type = 'post' LIMIT 1));

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid6, '00000000-0000-0000-0000-000000000016');

  -- Ticket 7: Carol - pending, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('How to change notification settings?', 'how-to-change-notification-settings', 'pending', 'low', 'low', false, _type_question,
          '00000000-0000-0000-0000-000000000016')
  RETURNING id INTO _tid7;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid7, '00000000-0000-0000-0000-000000000016',
    'Where can I find the notification settings? I am getting too many email notifications.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid7, '00000000-0000-0000-0000-000000000013',
    E'You can manage your notifications from **Profile > Notification Settings**.\n\nYou can:\n- Disable email notifications entirely\n- Choose which events trigger notifications\n- Set a digest frequency\n\nDoes that help?',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid7, '00000000-0000-0000-0000-000000000016');

  -- --------------------------------------------------------
  -- Dave's tickets (2): one open, one closed (no team)
  -- --------------------------------------------------------

  -- Ticket 8: Dave - open, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('Suggestion: keyboard shortcuts', 'suggestion-keyboard-shortcuts', 'open', 'low', 'low', false, _type_suggestion,
          '00000000-0000-0000-0000-000000000017')
  RETURNING id INTO _tid8;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid8, '00000000-0000-0000-0000-000000000017',
    E'It would be great to have keyboard shortcuts for common actions:\n\n- `Ctrl+N` — New ticket\n- `Ctrl+Enter` — Submit reply\n- `Esc` — Close modal\n\nThis would greatly improve productivity for power users.',
    true, 'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid8, '00000000-0000-0000-0000-000000000017');

  -- Ticket 9: Dave - closed, private
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Login issue on mobile', 'login-issue-on-mobile', 'closed', 'medium', 'medium', true, _type_issue,
          '00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000013')
  RETURNING id INTO _tid9;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid9, '00000000-0000-0000-0000-000000000017',
    'I cannot log in from my phone (iPhone 15, Safari). The login button does not respond to taps. Works fine on desktop.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid9, '00000000-0000-0000-0000-000000000013',
    'We have identified and fixed the touch event handling issue on iOS Safari. The fix is deployed. Could you try again?',
    'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid9, '00000000-0000-0000-0000-000000000017',
    'It works now. Thank you for the quick fix!',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid9, '00000000-0000-0000-0000-000000000017');

  -- Eve has 0 tickets (testing empty state per §3.3)

  -- ============================================================
  -- Phase 5 — Categories, Tags, and Assignments
  -- ============================================================

  -- Categories (3)
  INSERT INTO categories (id, name) VALUES
    ('00000000-0000-0000-0000-000000000201', 'Billing'),
    ('00000000-0000-0000-0000-000000000202', 'Technical'),
    ('00000000-0000-0000-0000-000000000203', 'Account');

  -- Tags (5, with distinct colors)
  INSERT INTO tags (id, name, color) VALUES
    ('00000000-0000-0000-0000-000000000301', 'urgent', '#EF4444'),
    ('00000000-0000-0000-0000-000000000302', 'bug', '#F97316'),
    ('00000000-0000-0000-0000-000000000303', 'feature-request', '#3B82F6'),
    ('00000000-0000-0000-0000-000000000304', 'documentation', '#14B8A6'),
    ('00000000-0000-0000-0000-000000000305', 'UI', '#8B5CF6');

  -- Category assignments on existing tickets
  -- Ticket 1 (Password reset not working) → Account
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000203' WHERE id = _tid1;
  -- Ticket 4 (Billing shows wrong amount) → Billing
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000201' WHERE id = _tid4;
  -- Ticket 6 (Bug in search results) → Technical
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000202' WHERE id = _tid6;
  -- Ticket 8 (Suggestion: keyboard shortcuts) → Technical
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000202' WHERE id = _tid8;
  -- Ticket 9 (Login issue on mobile) → Account
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000203' WHERE id = _tid9;

  -- Tag assignments on existing tickets (2-3 tags per ticket, 5 tickets)
  -- Ticket 1 → urgent, bug
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid1, '00000000-0000-0000-0000-000000000301'),
    (_tid1, '00000000-0000-0000-0000-000000000302');
  -- Ticket 2 → feature-request
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid2, '00000000-0000-0000-0000-000000000303');
  -- Ticket 4 → urgent, bug, UI
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid4, '00000000-0000-0000-0000-000000000301'),
    (_tid4, '00000000-0000-0000-0000-000000000302'),
    (_tid4, '00000000-0000-0000-0000-000000000305');
  -- Ticket 6 → bug, UI
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid6, '00000000-0000-0000-0000-000000000302'),
    (_tid6, '00000000-0000-0000-0000-000000000305');
  -- Ticket 8 → feature-request, documentation
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid8, '00000000-0000-0000-0000-000000000303'),
    (_tid8, '00000000-0000-0000-0000-000000000304');

  -- ============================================================
  -- Phase 12 — SLA Policies
  -- ============================================================

  -- Override severity on 3 tickets for SLA visibility
  UPDATE tickets SET severity = 'critical' WHERE id = _tid1;
  UPDATE tickets SET severity = 'high' WHERE id = _tid3;
  UPDATE tickets SET severity = 'critical' WHERE id = _tid5;

END $$;

-- SLA Policy (outside DO block — does not reference local variables)
INSERT INTO sla_policies (id, name, first_response_minutes, resolution_minutes)
VALUES ('00000000-0000-0000-0000-000000000401', 'Standard SLA', 240, 1440)
ON CONFLICT DO NOTHING;

-- Severity mapping: Critical and High → Standard SLA; Low and Medium unmapped
UPDATE sla_severity_mapping SET sla_policy_id = '00000000-0000-0000-0000-000000000401' WHERE severity = 'critical';
UPDATE sla_severity_mapping SET sla_policy_id = '00000000-0000-0000-0000-000000000401' WHERE severity = 'high';

-- ============================================================
-- Phase 13 — Knowledge Base: Categories & Articles
-- ============================================================

-- KB Categories (2)
INSERT INTO kb_categories (id, name, display_order) VALUES
  ('00000000-0000-0000-0000-000000000501', 'Getting Started', 1),
  ('00000000-0000-0000-0000-000000000502', 'Troubleshooting', 2);

-- KB Articles (3)
-- Article 1: "How to create a ticket" — Getting Started, published, author: Agent Smith
INSERT INTO kb_articles (id, title, slug, body, status, category_id, author_id) VALUES
  (1, 'How to create a ticket', 'how-to-create-a-ticket',
   E'# How to Create a Ticket\n\nCreating a ticket is easy! Follow these steps:\n\n1. Click **My Tickets** in the navigation bar\n2. Click the **Create Ticket** button\n3. Fill in the **Title** with a short summary of your issue\n4. Select the appropriate **Type** and **Urgency**\n5. Describe your issue in the **Description** field (Markdown supported)\n6. Click **Create Ticket**\n\n## Tips\n\n- Be as specific as possible in your description\n- Include any error messages you see\n- Attach screenshots if they help explain the issue\n\nOnce submitted, an agent will review your ticket and respond as soon as possible.',
   'published', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000012');

-- Article 2: "Understanding ticket statuses" — Getting Started, published, author: Agent Smith
INSERT INTO kb_articles (id, title, slug, body, status, category_id, author_id) VALUES
  (2, 'Understanding ticket statuses', 'understanding-ticket-statuses',
   E'# Understanding Ticket Statuses\n\nEvery ticket in the system has a status that indicates its current state:\n\n| Status | Meaning |\n|--------|----------|\n| **Open** | The ticket has been created and is awaiting agent review |\n| **In Progress** | An agent is actively working on the ticket |\n| **Pending** | The agent is waiting for more information from you |\n| **Resolved** | The issue has been addressed |\n| **Closed** | The ticket is complete and no further action is needed |\n\n## What to Do\n\n- If your ticket is **Pending**, check for agent replies and respond\n- If **Resolved** but the issue persists, reply to reopen it\n- **Closed** tickets can no longer be replied to (unless an agent reopens)\n\nNeed further help? Create a ticket!',
   'published', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000012');

-- Article 3: "Common login issues" — Troubleshooting, draft, author: Admin
INSERT INTO kb_articles (id, title, slug, body, status, category_id, author_id) VALUES
  (3, 'Common login issues', 'common-login-issues',
   E'# Common Login Issues\n\nIf you are having trouble logging in, try the following:\n\n## Forgot Password\n\n1. Click **Forgot Password** on the login page\n2. Enter your email address\n3. Check your inbox for a reset link\n4. Follow the link to set a new password\n\n## Account Not Found\n\nIf you receive an "account not found" error:\n- Make sure you are using the correct email address\n- Check if you signed up with a different email\n- Contact support if the issue persists\n\n## Browser Issues\n\n- Clear your browser cache and cookies\n- Try a different browser or incognito mode\n- Ensure JavaScript is enabled',
   'draft', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000011');

-- Reset sequence for kb_articles id
SELECT setval('kb_articles_id_seq', 3);

-- ============================================================
-- Phase 20 — Subscription Tiers
-- ============================================================

INSERT INTO subscription_tiers (key, display_name, color, icon, sort_order,
  cap_change_visibility, cap_set_severity, cap_change_status, cap_change_type, cap_add_remove_tags,
  limit_ticket_rate, limit_max_file_size, limit_max_files_per_post)
VALUES
  ('free', 'Free', 'gray', NULL, 1,
    false, false, false, false, false,
    NULL, NULL, NULL),
  ('licensed', 'Licensed', 'blue', NULL, 2,
    true, false, false, false, false,
    20, NULL, NULL),
  ('enterprise', 'Enterprise', 'purple', NULL, 3,
    true, true, true, true, true,
    50, 26214400, NULL);

-- Tier assignments
-- Alice → Enterprise (no expiration)
UPDATE profiles SET tier_id = (SELECT id FROM subscription_tiers WHERE key = 'enterprise'), tier_expires_at = NULL
WHERE email = 'alice@example.com';

-- Bob → Licensed (expires 2026-12-31)
UPDATE profiles SET tier_id = (SELECT id FROM subscription_tiers WHERE key = 'licensed'), tier_expires_at = '2026-12-31T23:59:59Z'
WHERE email = 'bob@example.com';

-- Dave → Licensed (expired 2026-01-01)
UPDATE profiles SET tier_id = (SELECT id FROM subscription_tiers WHERE key = 'licensed'), tier_expires_at = '2026-01-01T00:00:00Z'
WHERE email = 'dave@example.com';

-- ============================================================
-- Phase VHU-0 — Re-assert VHU SLA severity mapping
-- ============================================================
-- The inherited "Phase 12 — SLA Policies" block above (kept as-is, since it
-- is working inherited functionality) points severity 'critical'/'high' at
-- the original demo "Standard SLA" policy (240/1440 min), which silently
-- overrides the VHU-compliant mapping migration 036 set up
-- ('VHU - Khẩn cấp' 15/120 min, 'VHU - Cao' 120/720 min). Re-assert the
-- correct VHU mapping here, before any VHU demo tickets are inserted below
-- (ticket inserts compute response_due_at/resolution_due_at from whatever
-- mapping is active at insert time via the `compute_ticket_sla_due`
-- trigger), so SLA due dates match spec §13 thresholds.
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Thấp') WHERE severity = 'low';
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Trung bình') WHERE severity = 'medium';
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Cao') WHERE severity = 'high';
UPDATE sla_severity_mapping SET sla_policy_id = (SELECT id FROM sla_policies WHERE name = 'VHU - Khẩn cấp') WHERE severity = 'critical';

-- ============================================================
-- Phase VHU-1 — Required demo accounts (Requester/Agent/Manager/Admin)
-- Password for all four: Demo@123456
-- ============================================================

DO $$
DECLARE
  _vhu_users JSONB := '[
    {"id":"00000000-0000-0000-0000-000000000021","email":"requester@demo.local","name":"Người dùng Demo"},
    {"id":"00000000-0000-0000-0000-000000000022","email":"agent@demo.local","name":"Nhân viên Demo"},
    {"id":"00000000-0000-0000-0000-000000000023","email":"manager@demo.local","name":"Quản lý Demo"},
    {"id":"00000000-0000-0000-0000-000000000024","email":"admin@demo.local","name":"Quản trị viên Demo"}
  ]'::jsonb;
  _u JSONB;
BEGIN
  FOR _u IN SELECT * FROM jsonb_array_elements(_vhu_users) LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous,
      confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current,
      email_change, reauthentication_token, email_change_confirm_status
    ) VALUES (
      (_u->>'id')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated',
      _u->>'email',
      extensions.crypt('Demo@123456', extensions.gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('display_name', _u->>'name'),
      '{"provider":"email","providers":["email"]}'::jsonb,
      false, false,
      '', '', '', '', '', '', 0
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(), (_u->>'id')::uuid,
      jsonb_build_object('sub', _u->>'id', 'email', _u->>'email'),
      'email', _u->>'id', now(), now(), now()
    );
  END LOOP;
END $$;

UPDATE profiles SET role = 'user' WHERE id = '00000000-0000-0000-0000-000000000021';
UPDATE profiles SET role = 'agent' WHERE id = '00000000-0000-0000-0000-000000000022';
UPDATE profiles SET role = 'manager' WHERE id = '00000000-0000-0000-0000-000000000023';
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000024';

UPDATE profiles SET department_id = (SELECT id FROM departments WHERE name = 'Phòng Hạ tầng mạng')
  WHERE id IN ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000023');

-- ============================================================
-- Phase VHU-2 — VHU IT helpdesk demo tickets (22 tickets covering
-- all 10 statuses, all 4 priority levels, urgent + overdue + rated
-- tickets, per the assignment's acceptance criteria).
-- ============================================================

DO $$
DECLARE
  _req UUID := '00000000-0000-0000-0000-000000000021';
  _agent UUID := '00000000-0000-0000-0000-000000000022';
  _mgr UUID := '00000000-0000-0000-0000-000000000023';
  _admin UUID := '00000000-0000-0000-0000-000000000024';
  _type_issue UUID;
  _dept_mang UUID; _dept_qths UUID; _dept_tb UUID; _dept_cntt UUID;
  _cat_mang UUID; _cat_mtph UUID; _cat_mchieu UUID; _cat_tbph UUID;
  _cat_email UUID; _cat_tksv UUID; _cat_cttt UUID; _cat_pmdt UUID;
  _cat_cdpm UUID; _cat_attt UUID; _cat_mayin UUID; _cat_khac UUID;
  _tid BIGINT;
BEGIN
  SELECT id INTO _type_issue FROM ticket_types WHERE name = 'Issue';

  SELECT id INTO _dept_mang FROM departments WHERE name = 'Phòng Hạ tầng mạng';
  SELECT id INTO _dept_qths FROM departments WHERE name = 'Phòng Quản trị hệ thống';
  SELECT id INTO _dept_tb FROM departments WHERE name = 'Phòng Thiết bị - Phòng học';
  SELECT id INTO _dept_cntt FROM departments WHERE name = 'Phòng Công nghệ thông tin';

  SELECT id INTO _cat_mang FROM categories WHERE name = 'Mạng Internet';
  SELECT id INTO _cat_mtph FROM categories WHERE name = 'Máy tính phòng học';
  SELECT id INTO _cat_mchieu FROM categories WHERE name = 'Máy chiếu';
  SELECT id INTO _cat_tbph FROM categories WHERE name = 'Thiết bị phòng học';
  SELECT id INTO _cat_email FROM categories WHERE name = 'Email trường';
  SELECT id INTO _cat_tksv FROM categories WHERE name = 'Tài khoản sinh viên';
  SELECT id INTO _cat_cttt FROM categories WHERE name = 'Cổng thông tin sinh viên';
  SELECT id INTO _cat_pmdt FROM categories WHERE name = 'Phần mềm đào tạo';
  SELECT id INTO _cat_cdpm FROM categories WHERE name = 'Cài đặt phần mềm';
  SELECT id INTO _cat_attt FROM categories WHERE name = 'An toàn thông tin';
  SELECT id INTO _cat_mayin FROM categories WHERE name = 'Máy in';
  SELECT id INTO _cat_khac FROM categories WHERE name = 'Yêu cầu khác';

  -- 1. NEW — chưa được AI phân tích
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, location, vhu_status, ai_status)
  VALUES ('Không truy cập được Wi-Fi ký túc xá', 'khong-truy-cap-duoc-wifi-ktx', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _cat_mang, _dept_mang, 'Ký túc xá khu B', 'NEW', 'PENDING')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Từ sáng nay em không kết nối được Wi-Fi ở ký túc xá khu B, các phòng khác vẫn dùng bình thường.', true, 'post');

  -- 2. AI_ANALYZED — đã có kết quả AI
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, location, device_name, vhu_status,
    ai_summary, ai_category, ai_priority, ai_confidence, ai_reason, ai_suggested_actions, ai_status)
  VALUES ('Máy tính phòng B203 không lên nguồn', 'may-tinh-phong-b203-khong-len-nguon', 'high', 'high', 'high',
    true, _type_issue, _req, _cat_mtph, _dept_tb, 'Phòng B203', 'Máy 12', 'AI_ANALYZED',
    'Máy tính số 12 tại phòng B203 không lên nguồn, ảnh hưởng một sinh viên trong buổi thực hành.',
    'Máy tính phòng học', 'high', 0.88, 'Sự cố ảnh hưởng một máy tính, có thể chuyển sang máy khác tạm thời.',
    '["Kiểm tra nguồn điện và dây cắm", "Kiểm tra bộ nguồn (PSU)", "Bố trí máy dự phòng cho sinh viên"]'::jsonb, 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Máy số 12 phòng B203 bấm nút nguồn không lên, đèn màn hình cũng không sáng.', true, 'post');

  -- 3. ASSIGNED
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, location, vhu_status, ai_status)
  VALUES ('Máy chiếu phòng A105 bị mờ', 'may-chieu-phong-a105-bi-mo', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _agent, _cat_mchieu, _dept_tb, 'Phòng A105', 'ASSIGNED', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Máy chiếu phòng A105 lên hình rất mờ, chữ khó đọc dù đã chỉnh độ nét.', true, 'post');
  INSERT INTO ticket_assignments (ticket_id, assigned_from, assigned_to, assigned_by, reason)
  VALUES (_tid, NULL, _agent, _mgr, 'Phân công theo khu vực phụ trách');

  -- 4. IN_PROGRESS
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, location, vhu_status, ai_status)
  VALUES ('Loa phòng hội thảo C301 không có âm thanh', 'loa-phong-hoi-thao-c301-khong-co-am-thanh', 'high', 'high', 'high',
    true, _type_issue, _req, _agent, _cat_tbph, _dept_tb, 'Phòng C301', 'IN_PROGRESS', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Hệ thống loa phòng hội thảo C301 không phát được âm thanh, ảnh hưởng buổi báo cáo chiều nay.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Đã kiểm tra tại chỗ, đang thay dây tín hiệu âm thanh.', 'post');

  -- 5. IN_PROGRESS + URGENT + quá hạn (created_at lùi về quá khứ) — ví dụ trong đề bài
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, location, device_name, vhu_status,
    ai_summary, ai_category, ai_priority, ai_confidence, ai_reason, ai_suggested_actions,
    ai_suggested_department, ai_status, created_at)
  VALUES ('Mất Internet phòng A203 trước giờ thi', 'mat-internet-phong-a203-truoc-gio-thi', 'critical', 'critical', 'critical',
    true, _type_issue, _req, _agent, _cat_mang, _dept_mang, 'Phòng A203', 'Toàn bộ máy phòng A203', 'IN_PROGRESS',
    'Toàn bộ máy tính phòng A203 mất kết nối Internet trước giờ thi lúc 14 giờ.',
    'Mạng Internet', 'critical', 0.96, 'Sự cố ảnh hưởng toàn bộ phòng máy và kỳ thi sắp diễn ra.',
    '["Kiểm tra switch tại phòng A203", "Kiểm tra trạng thái đường truyền", "Kiểm tra DHCP và gateway", "Liên hệ cán bộ coi thi để cập nhật tiến độ"]'::jsonb,
    'Phòng Hạ tầng mạng', 'COMPLETED', now() - interval '10 days')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type, created_at)
  VALUES (_tid, _req, 'Máy tính tại phòng A203 không kết nối được Internet. Lớp chuẩn bị thi vào lúc 14 giờ và toàn bộ máy đều không truy cập được hệ thống thi.', true, 'post', now() - interval '10 days');
  INSERT INTO webhook_logs (ticket_id, event_type, idempotency_key, payload, attempt_count, status, http_status, sent_at)
  VALUES (_tid, 'ticket_urgent', 'seed-webhook-' || _tid, jsonb_build_object('ticket_code', (SELECT ticket_code FROM tickets WHERE id = _tid), 'priority', 'URGENT'), 1, 'SIMULATED', 200, now() - interval '10 days');

  -- 6. WAITING_USER
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Không nhận được email trường gửi lịch thi', 'khong-nhan-duoc-email-truong-gui-lich-thi', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _agent, _cat_email, _dept_qths, 'WAITING_USER', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Em không nhận được email thông báo lịch thi từ hệ thống trường.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Bạn vui lòng cho mình biết địa chỉ email trường (@vhu.edu.vn) bạn đang dùng để kiểm tra hộp thư.', 'post');

  -- 7. WAITING_CONFIRMATION
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Không đăng nhập được tài khoản sinh viên', 'khong-dang-nhap-duoc-tai-khoan-sinh-vien', 'low', 'low', 'low',
    true, _type_issue, _req, _agent, _cat_tksv, _dept_qths, 'WAITING_CONFIRMATION', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Tài khoản sinh viên của em báo sai mật khẩu dù em chắc chắn đã nhập đúng.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Mình đã đặt lại mật khẩu tài khoản của bạn về mặc định. Bạn thử đăng nhập lại và xác nhận giúp mình nhé.', 'post');

  -- 8. RESOLVED + đã đánh giá 5 sao
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, resolved_at, ai_status)
  VALUES ('Không xem được điểm trên cổng thông tin sinh viên', 'khong-xem-duoc-diem-tren-cong-thong-tin', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _agent, _cat_cttt, _dept_qths, 'RESOLVED', now() - interval '1 day', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Trang điểm trên cổng thông tin sinh viên bị trắng, không hiển thị gì.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Đã khắc phục lỗi hiển thị do cache trình duyệt. Bạn vui lòng tải lại trang và kiểm tra.', 'post');
  INSERT INTO ticket_ratings (ticket_id, requester_id, rating, comment)
  VALUES (_tid, _req, 5, 'Xử lý rất nhanh, cảm ơn bộ phận CNTT!');

  -- 9. CLOSED + đã đánh giá 4 sao
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, resolved_at, closed_at, ai_status)
  VALUES ('Phần mềm quản lý đào tạo báo lỗi khi đăng ký học phần', 'phan-mem-dao-tao-loi-dang-ky-hoc-phan', 'high', 'high', 'high',
    true, _type_issue, _req, _agent, _cat_pmdt, _dept_qths, 'CLOSED', now() - interval '3 days', now() - interval '2 days', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Khi bấm đăng ký học phần, hệ thống báo lỗi 500 và không lưu được.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Lỗi do quá tải hệ thống giờ cao điểm, đã được khắc phục. Ticket đã đóng.', 'post');
  INSERT INTO ticket_ratings (ticket_id, requester_id, rating, comment)
  VALUES (_tid, _req, 4, 'Ổn, hơi lâu một chút.');

  -- 10. REOPENED
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Yêu cầu cài đặt phần mềm thống kê SPSS', 'yeu-cau-cai-dat-phan-mem-spss', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _agent, _cat_cdpm, _dept_cntt, 'REOPENED', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Em cần cài phần mềm SPSS cho máy phòng thực hành để làm đồ án.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _req, 'Phần mềm cài xong nhưng bị lỗi không mở được, em mở lại yêu cầu này.', 'post');

  -- 11. CANCELLED
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Nghi ngờ máy tính phòng lab nhiễm virus', 'nghi-ngo-may-tinh-phong-lab-nhiem-virus', 'low', 'low', 'low',
    true, _type_issue, _req, _cat_attt, _dept_qths, 'CANCELLED', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Em thấy máy chạy chậm nghi bị virus nhưng kiểm tra lại thì do máy cấu hình yếu, xin hủy yêu cầu.', true, 'post');

  -- 12. NEW
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, location, vhu_status, ai_status)
  VALUES ('Máy in thư viện hết mực', 'may-in-thu-vien-het-muc', 'low', 'low', 'low',
    true, _type_issue, _req, _cat_mayin, _dept_tb, 'Thư viện tầng 2', 'NEW', 'PENDING')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Máy in dùng chung ở thư viện tầng 2 báo hết mực từ hôm qua.', true, 'post');

  -- 13. ASSIGNED + URGENT (sự cố an toàn thông tin) — webhook mô phỏng
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, location, vhu_status,
    ai_summary, ai_category, ai_priority, ai_confidence, ai_reason, ai_suggested_actions, ai_status)
  VALUES ('Phát hiện truy cập bất thường vào hệ thống điểm', 'phat-hien-truy-cap-bat-thuong-he-thong-diem', 'critical', 'critical', 'critical',
    true, _type_issue, _req, _agent, _cat_attt, _dept_qths, 'Phòng Quản trị hệ thống', 'ASSIGNED',
    'Ghi nhận nhiều lần đăng nhập bất thường vào hệ thống quản lý điểm ngoài giờ hành chính.',
    'An toàn thông tin', 'critical', 0.91, 'Có dấu hiệu truy cập trái phép vào hệ thống dữ liệu quan trọng.',
    '["Khóa tạm thời tài khoản liên quan", "Kiểm tra log truy cập chi tiết", "Đổi mật khẩu quản trị hệ thống điểm"]'::jsonb, 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Hệ thống cảnh báo có đăng nhập lạ vào tài khoản quản trị điểm lúc 2 giờ sáng.', true, 'post');
  INSERT INTO webhook_logs (ticket_id, event_type, idempotency_key, payload, attempt_count, status, http_status, sent_at)
  VALUES (_tid, 'ticket_urgent', 'seed-webhook-' || _tid, jsonb_build_object('ticket_code', (SELECT ticket_code FROM tickets WHERE id = _tid), 'priority', 'URGENT'), 1, 'SIMULATED', 200, now());

  -- 14. IN_PROGRESS
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Hỗ trợ tạo lớp học phần trên hệ thống LMS', 'ho-tro-tao-lop-hoc-phan-lms', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _agent, _cat_khac, _dept_cntt, 'IN_PROGRESS', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Giảng viên cần hỗ trợ tạo lớp học phần mới trên hệ thống học trực tuyến.', true, 'post');

  -- 15. WAITING_USER + HIGH
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Mạng chậm toàn bộ khu giảng đường B', 'mang-cham-toan-bo-khu-giang-duong-b', 'high', 'high', 'high',
    true, _type_issue, _req, _agent, _cat_mang, _dept_mang, 'WAITING_USER', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Mạng ở khu giảng đường B chậm bất thường từ sáng nay.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Bạn đang dùng Wi-Fi hay mạng dây? Vui lòng cho mình biết phòng cụ thể.', 'post');

  -- 16. RESOLVED + đánh giá 3 sao
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, resolved_at, ai_status)
  VALUES ('Bàn phím máy tính phòng B105 bị liệt vài phím', 'ban-phim-may-tinh-phong-b105-liet-phim', 'low', 'low', 'low',
    true, _type_issue, _req, _agent, _cat_mtph, _dept_tb, 'RESOLVED', now() - interval '5 hours', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Bàn phím máy số 5 phòng B105 bị liệt phím A và S.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Đã thay bàn phím mới.', 'post');
  INSERT INTO ticket_ratings (ticket_id, requester_id, rating, comment)
  VALUES (_tid, _req, 3, 'Xử lý được nhưng hơi chậm.');

  -- 17. CLOSED + URGENT (đã xử lý xong) + đánh giá 2 sao
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, resolved_at, closed_at, ai_status)
  VALUES ('Hệ thống email trường bị gián đoạn toàn trường', 'he-thong-email-truong-gian-doan-toan-truong', 'critical', 'critical', 'critical',
    true, _type_issue, _req, _agent, _cat_email, _dept_qths, 'CLOSED', now() - interval '6 days', now() - interval '5 days', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Toàn bộ email @vhu.edu.vn không gửi/nhận được từ trưa nay.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Sự cố do bảo trì máy chủ mail ngoài kế hoạch, đã khôi phục.', 'post');
  INSERT INTO webhook_logs (ticket_id, event_type, idempotency_key, payload, attempt_count, status, http_status, sent_at)
  VALUES (_tid, 'ticket_urgent', 'seed-webhook-' || _tid, jsonb_build_object('ticket_code', (SELECT ticket_code FROM tickets WHERE id = _tid), 'priority', 'URGENT'), 1, 'SENT', 200, now() - interval '6 days');
  INSERT INTO ticket_ratings (ticket_id, requester_id, rating, comment)
  VALUES (_tid, _req, 2, 'Thời gian gián đoạn hơi lâu, ảnh hưởng công việc.');

  -- 18. NEW + quá hạn (chưa phản hồi, tạo từ lâu)
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, location, vhu_status, ai_status, created_at)
  VALUES ('Máy chiếu phòng D201 không nhận tín hiệu HDMI', 'may-chieu-phong-d201-khong-nhan-hdmi', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _cat_mchieu, _dept_tb, 'Phòng D201', 'NEW', 'PENDING', now() - interval '4 days')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type, created_at)
  VALUES (_tid, _req, 'Máy chiếu phòng D201 không nhận tín hiệu HDMI từ laptop giảng viên.', true, 'post', now() - interval '4 days');

  -- 19. AI_ANALYZED + HIGH
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, location, vhu_status,
    ai_summary, ai_category, ai_priority, ai_confidence, ai_reason, ai_suggested_actions, ai_status)
  VALUES ('Điều hòa phòng máy chủ ngừng hoạt động', 'dieu-hoa-phong-may-chu-ngung-hoat-dong', 'high', 'high', 'high',
    true, _type_issue, _req, _cat_tbph, _dept_tb, 'Phòng máy chủ', 'AI_ANALYZED',
    'Điều hòa phòng máy chủ ngừng hoạt động, có nguy cơ ảnh hưởng nhiệt độ thiết bị.',
    'Thiết bị phòng học', 'high', 0.85, 'Ảnh hưởng thiết bị hạ tầng quan trọng nếu không xử lý sớm.',
    '["Kiểm tra nguồn điện điều hòa", "Liên hệ đơn vị bảo trì điều hòa", "Theo dõi nhiệt độ phòng máy chủ"]'::jsonb, 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Điều hòa phòng máy chủ tầng trệt tự nhiên tắt và không bật lại được.', true, 'post');

  -- 20. IN_PROGRESS + LOW
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Không đổi được ảnh đại diện tài khoản sinh viên', 'khong-doi-duoc-anh-dai-dien-tai-khoan', 'low', 'low', 'low',
    true, _type_issue, _req, _agent, _cat_tksv, _dept_qths, 'IN_PROGRESS', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Em bấm đổi ảnh đại diện trên tài khoản sinh viên nhưng không lưu được.', true, 'post');

  -- 21. WAITING_CONFIRMATION + HIGH
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id, assigned_agent_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Cổng thông tin sinh viên không hiển thị thời khóa biểu', 'cong-thong-tin-khong-hien-thi-tkb', 'high', 'high', 'high',
    true, _type_issue, _req, _agent, _cat_cttt, _dept_qths, 'WAITING_CONFIRMATION', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Thời khóa biểu học kỳ mới không hiển thị trên cổng thông tin sinh viên.', true, 'post');
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid, _agent, 'Đã đồng bộ lại dữ liệu thời khóa biểu. Bạn vui lòng kiểm tra và xác nhận giúp mình.', 'post');

  -- 22. CANCELLED
  INSERT INTO tickets (title, slug, urgency, severity, priority, is_private, type_id, creator_id,
    category_id, department_id, vhu_status, ai_status)
  VALUES ('Hỗ trợ cài phần mềm diệt virus bản quyền', 'ho-tro-cai-phan-mem-diet-virus-ban-quyen', 'medium', 'medium', 'medium',
    true, _type_issue, _req, _cat_khac, _dept_cntt, 'CANCELLED', 'COMPLETED')
  RETURNING id INTO _tid;
  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid, _req, 'Em muốn xin bản quyền phần mềm diệt virus nhưng đã tự cài được, xin hủy yêu cầu này.', true, 'post');

END $$;

-- --------------------------------------------------------
-- Sample audit_logs rows illustrating the structure (production
-- rows are written at runtime by the server-side audit service for
-- every mutating action — see src/lib/audit/log.ts).
-- --------------------------------------------------------
INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, entity_type, entity_id, ticket_id, new_data)
SELECT _admin.id, 'admin@demo.local', 'admin', 'update_sla_policy', 'sla_policies', sp.id::text, NULL,
       jsonb_build_object('name', sp.name, 'first_response_minutes', sp.first_response_minutes)
FROM (SELECT id, name, first_response_minutes FROM sla_policies WHERE name = 'VHU - Khẩn cấp') sp,
     (SELECT '00000000-0000-0000-0000-000000000024'::uuid AS id) _admin;

INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, entity_type, entity_id, ticket_id, new_data)
SELECT '00000000-0000-0000-0000-000000000023'::uuid, 'manager@demo.local', 'manager', 'assign_ticket', 'tickets', t.id::text, t.id,
       jsonb_build_object('assigned_to', 'agent@demo.local')
FROM tickets t WHERE t.title = 'Máy chiếu phòng A105 bị mờ';

INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, entity_type, entity_id, ticket_id, new_data)
SELECT '00000000-0000-0000-0000-000000000022'::uuid, 'agent@demo.local', 'agent', 'change_status', 'tickets', t.id::text, t.id,
       jsonb_build_object('new_status', 'RESOLVED')
FROM tickets t WHERE t.title = 'Không xem được điểm trên cổng thông tin sinh viên';
