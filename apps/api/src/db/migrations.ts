/**
 * Core database schema (Spec 11_DATA_MODEL logical model → physical DDL).
 * Applied by runMigrations() at boot when DATABASE_URL is configured (Spec 10).
 *
 * Column names mirror the TypeScript shapes in @orbit/schemas so hydration
 * (store.hydrate()) is a direct row → object mapping.
 *
 * Invariants enforced here (Spec 11 "Required invariants"):
 * - Unique idempotency key per sender and logical send operation.
 * - Business internal notes live in a SEPARATE table from customer messages.
 * - All timestamps stored in UTC (TIMESTAMPTZ).
 * - Opaque stable IDs (TEXT), never sequential IDs for public exposure.
 * - Child rows cannot exist without an authorized parent scope (FKs).
 */

export interface Migration {
  id: string;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: '0001',
    name: 'core_schema',
    sql: `
-- User account (authentication root; never stores raw credentials here)
CREATE TABLE IF NOT EXISTS user_accounts (
  id                      TEXT PRIMARY KEY,
  email                   TEXT,
  display_name            TEXT NOT NULL,
  avatar_url              TEXT,
  status                  TEXT NOT NULL DEFAULT 'active',
  recovery_state          TEXT,
  deletion_requested_at   TIMESTAMPTZ,
  deletion_status         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_accounts_email
  ON user_accounts(lower(email)) WHERE email IS NOT NULL;

-- Auth sessions / devices (avoid precise location tracking by default)
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id               TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  active_workspace_id      TEXT,
  device_label             TEXT,
  platform                 TEXT,
  ip_address_masked        TEXT,
  is_passkey_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
  is_current_session       BOOLEAN NOT NULL DEFAULT FALSE,
  status                   TEXT NOT NULL DEFAULT 'active',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id, status);

-- Identity / workspace (personal or business)
CREATE TABLE IF NOT EXISTS identity_workspaces (
  id                TEXT PRIMARY KEY,
  owner_account_id  TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('personal', 'business')),
  display_name      TEXT NOT NULL,
  handle            TEXT NOT NULL,
  avatar_url        TEXT,
  bio               TEXT,
  color_cue         TEXT,
  category          TEXT,
  business_hours    TEXT,
  website           TEXT,
  is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  profile_fields    JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility_policy TEXT NOT NULL DEFAULT 'private',
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_handle ON identity_workspaces(lower(handle));

-- Workspace membership + role (deny-by-default capability checks live in domain layer)
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'agent', 'analyst', 'member')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'invited', 'suspended', 'revoked')),
  invited_by   TEXT,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (workspace_id, account_id)
);

-- Conversation (supports branches via parent/source backlinks, Spec 03)
CREATE TABLE IF NOT EXISTS conversations (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'branch')),
  title                 TEXT,
  created_by            TEXT,
  parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id     TEXT,
  intent_mode           TEXT NOT NULL DEFAULT 'standard',
  studio_settings       JSONB,
  retention_days        INTEGER,
  unread_count          INTEGER NOT NULL DEFAULT 0,
  is_pinned             BOOLEAN NOT NULL DEFAULT FALSE,
  is_muted              BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived           BOOLEAN NOT NULL DEFAULT FALSE,
  is_e2ee               BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_snippet  TEXT,
  last_message_at       TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_activity
  ON conversations(workspace_id, last_message_at DESC NULLS LAST);

-- Participants (membership scope for authorization)
CREATE TABLE IF NOT EXISTS conversation_participants (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  handle          TEXT NOT NULL,
  avatar_url      TEXT,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at         TIMESTAMPTZ,
  UNIQUE (conversation_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_workspace ON conversation_participants(workspace_id);

-- Message envelopes (customer/member-visible messages ONLY — never internal notes)
CREATE TABLE IF NOT EXISTS message_envelopes (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  sender_name         TEXT,
  idempotency_key     TEXT NOT NULL,
  client_message_id   TEXT,
  content_type        TEXT NOT NULL,
  body                TEXT,
  attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_state      TEXT NOT NULL DEFAULT 'accepted',
  reactions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_message_id TEXT,
  reply_to_snippet    TEXT,
  reply_to_sender_name TEXT,
  branch_id           TEXT,
  is_edited           BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at           TIMESTAMPTZ,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  is_encrypted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Spec 11: unique idempotency key per sender and logical send operation
  UNIQUE (sender_workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor
  ON message_envelopes(conversation_id, created_at);

-- Business internal notes: SEPARATE resource type and access policy (Spec 07/11).
-- Never joined into customer-facing message queries.
CREATE TABLE IF NOT EXISTS business_internal_notes (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id        TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  author_workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  author_name         TEXT NOT NULL,
  author_avatar_url   TEXT,
  body                TEXT NOT NULL,
  resource_type       TEXT NOT NULL DEFAULT 'business_internal_note',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_internal_notes_conversation
  ON business_internal_notes(conversation_id, created_at);

-- Vault (Spec 03 Context Vault) — visibility is explicit, not implicit
CREATE TABLE IF NOT EXISTS vault_collections (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT NOT NULL DEFAULT 'folder',
  visibility   TEXT NOT NULL DEFAULT 'private'
               CHECK (visibility IN ('private', 'workspace_shared')),
  item_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_collections_workspace ON vault_collections(workspace_id);

CREATE TABLE IF NOT EXISTS vault_items (
  id              TEXT PRIMARY KEY,
  collection_id   TEXT NOT NULL REFERENCES vault_collections(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL DEFAULT 'message'
                  CHECK (item_type IN ('message', 'file', 'link', 'decision', 'workflow')),
  source_conversation_id    TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  source_conversation_title TEXT,
  source_message_id         TEXT,
  author_name               TEXT,
  title           TEXT,
  content         TEXT NOT NULL,
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_note       TEXT,
  reminder_at     TIMESTAMPTZ,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_items_collection ON vault_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_workspace ON vault_items(workspace_id);

-- Workflow cards (Spec 03 G) — server-side state transitions only
CREATE TABLE IF NOT EXISTS workflow_cards (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  card_type       TEXT NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  state           TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      TEXT,
  due_at          TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_cards_conversation ON workflow_cards(conversation_id);

-- Realtime outbox (Spec 10: transaction + outbox so events are not lost between commit and fan-out)
CREATE TABLE IF NOT EXISTS realtime_outbox (
  cursor           BIGSERIAL PRIMARY KEY,
  event_id         TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL,
  schema_version   INTEGER NOT NULL DEFAULT 1,
  workspace_id     TEXT NOT NULL,
  conversation_id  TEXT,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_undelivered ON realtime_outbox(delivered_at, cursor);
`,
  },
  {
    id: '0002',
    name: 'wave2_expansion_tables',
    sql: `
-- Spec 21: contact requests (stranger discovery)
CREATE TABLE IF NOT EXISTS contact_requests (
  id                    TEXT PRIMARY KEY,
  requester_id          TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  requester_handle      TEXT NOT NULL,
  requester_display_name TEXT NOT NULL,
  recipient_id          TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  recipient_handle      TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending','accepted','ignored','blocked')),
  intro_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL
);

-- Spec 21: revocable invite links
CREATE TABLE IF NOT EXISTS invite_links (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  creator_id  TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  url         TEXT NOT NULL,
  max_uses    INTEGER NOT NULL CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL
);

-- Spec 22: per-workspace billing entitlements
CREATE TABLE IF NOT EXISTS billing_entitlements (
  workspace_id              TEXT PRIMARY KEY REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  plan                      TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('active','grace_period','past_due','cancelled')),
  billing_owner_user_id     TEXT NOT NULL,
  seats_allocated           INTEGER NOT NULL,
  seats_used                INTEGER NOT NULL,
  storage_quota_bytes       BIGINT NOT NULL,
  storage_used_bytes        BIGINT NOT NULL,
  max_file_size_mb          INTEGER NOT NULL,
  custom_themes_allowed     BOOLEAN NOT NULL,
  workflow_cards_allowed    BOOLEAN NOT NULL,
  audit_export_allowed      BOOLEAN NOT NULL,
  active_integrations_count INTEGER NOT NULL,
  max_integrations_allowed  INTEGER NOT NULL,
  renewal_date              TIMESTAMPTZ NOT NULL
);

-- Spec 22: invoice records
CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency       TEXT NOT NULL DEFAULT 'USD',
  date           TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('paid','open','refunded')),
  description    TEXT NOT NULL
);

-- Spec 22: billing events audit log
CREATE TABLE IF NOT EXISTS billing_events (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  plan_id      TEXT,
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  status       TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL
);

-- Spec 23: admin audit logs (append-only)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  justification TEXT NOT NULL,
  ip_hash      TEXT NOT NULL,
  timestamp    TIMESTAMPTZ NOT NULL
);

-- Spec 23: user abuse reports queue
CREATE TABLE IF NOT EXISTS user_reports (
  id                     TEXT PRIMARY KEY,
  reporter_id            TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  reporter_handle        TEXT NOT NULL,
  target_user_id         TEXT NOT NULL,
  target_handle          TEXT NOT NULL,
  target_conversation_id TEXT,
  reason                 TEXT NOT NULL,
  details                TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('pending','under_review','resolved','dismissed')),
  assigned_reviewer_id   TEXT,
  resolution_note        TEXT,
  action_taken           TEXT NOT NULL DEFAULT 'none',
  created_at             TIMESTAMPTZ NOT NULL,
  updated_at             TIMESTAMPTZ NOT NULL
);

-- Spec 28: abuse escalation path - support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id                      TEXT PRIMARY KEY,
  title                   TEXT NOT NULL,
  description             TEXT NOT NULL,
  priority                TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_by              TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL
);

-- Spec 28: abuse escalation path - escalation log
CREATE TABLE IF NOT EXISTS escalation_log (
  id                      TEXT PRIMARY KEY,
  reporter_id             TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  escalation_level        TEXT NOT NULL CHECK (escalation_level IN ('level1', 'level2', 'level3', 'level4')),
  assigned_to             TEXT,
  resolved_at             TIMESTAMPTZ,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spec 24: integration manifests (bots/connectors)
CREATE TABLE IF NOT EXISTS integrations (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  icon            TEXT NOT NULL,
  category        TEXT NOT NULL,
  scopes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  bot_identity    JSONB,
  webhook_url     TEXT,
  webhook_secret  TEXT,
  status          TEXT NOT NULL CHECK (status IN ('available','installed','revoked')),
  installed_at    TIMESTAMPTZ,
  data_policy_url TEXT NOT NULL
);

-- Spec 20: content-free privacy telemetry (no message bodies, no user IDs in queries)
CREATE TABLE IF NOT EXISTS privacy_telemetry_events (
  event_id           TEXT PRIMARY KEY,
  event_name         TEXT NOT NULL,
  occurred_at        TIMESTAMPTZ NOT NULL,
  actor_type         TEXT NOT NULL,
  anonymized_category TEXT NOT NULL,
  client_platform    TEXT NOT NULL
);

-- Spec 30: device sessions (WebAuthn-aware)
CREATE TABLE IF NOT EXISTS device_sessions (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  active_workspace_id     TEXT NOT NULL,
  device_label            TEXT NOT NULL,
  platform                TEXT NOT NULL,
  ip_address_masked       TEXT NOT NULL,
  is_current_session      BOOLEAN NOT NULL DEFAULT FALSE,
  is_passkey_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
  has_recent_step_up      BOOLEAN NOT NULL DEFAULT FALSE,
  step_up_expires_at      TIMESTAMPTZ,
  status                  TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  created_at              TIMESTAMPTZ NOT NULL,
  last_active_at          TIMESTAMPTZ NOT NULL
);

-- Spec 31: E2EE key bundles (server stores ONLY public material)
CREATE TABLE IF NOT EXISTS key_bundles (
  account_id         TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  device_id          TEXT NOT NULL,
  identity_key_pub   TEXT NOT NULL,
  signed_pre_key_pub TEXT NOT NULL,
  signed_pre_key_sig TEXT NOT NULL,
  one_time_pre_keys  JSONB NOT NULL DEFAULT '[]'::jsonb,
  registration_id    INTEGER NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL
);

-- Spec 31: safety-number verification records
CREATE TABLE IF NOT EXISTS key_verifications (
  contact_account_id        TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  contact_identity_key_pub  TEXT NOT NULL,
  safety_number             TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('verified','unverified','key_change_detected')),
  verified_at               TIMESTAMPTZ,
  previous_identity_key_pub TEXT
);
`,
  },
  {
    id: '0003',
    name: 'wave3_workflow_tombstone_tables',
    sql: `
-- Replace the legacy Spec-03 G workflow_cards table with the full Spec 25/26 shape.
-- (Pre-production schema evolution; no deployed data to migrate.)
DROP TABLE IF EXISTS workflow_cards;

-- Spec 25/26: workflow cards (approvals, tasks, polls) attached to conversations
CREATE TABLE IF NOT EXISTS workflow_cards (
  id                    TEXT PRIMARY KEY,
  conversation_id       TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  creator_workspace_id  TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  creator_name          TEXT NOT NULL,
  card_type             TEXT NOT NULL CHECK (card_type IN ('approval','task','agenda','checklist','poll')),
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL CHECK (status IN ('pending','in_progress','approved','rejected','completed')),
  assignee_workspace_id TEXT REFERENCES identity_workspaces(id) ON DELETE SET NULL,
  assignee_name         TEXT,
  due_date              TIMESTAMPTZ,
  options               JSONB NOT NULL DEFAULT '[]'::jsonb,
  history               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL
);

-- Spec 37/41: hashed deletion tombstones (GDPR erasure + restore suppression)
CREATE TABLE IF NOT EXISTS deletion_tombstones (
  tombstone_id   TEXT PRIMARY KEY,
  target_type    TEXT NOT NULL CHECK (target_type IN ('message','attachment','user','workspace','session')),
  target_id_hash TEXT NOT NULL UNIQUE,
  workspace_id   TEXT NOT NULL,
  deleted_at     TIMESTAMPTZ NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('user_delete','retention_expiry','gdpr_erasure')),
  tombstone_hash TEXT NOT NULL
);
`,
  },
  {
    id: '0004',
    name: 'wave_a_p0_messaging_tables',
    sql: `
-- Spec 02 P0: per-workspace conversation drafts
CREATE TABLE IF NOT EXISTS drafts (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  body            TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL,
  UNIQUE (workspace_id, conversation_id)
);

-- Spec 02 P0: in-app notification feed
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  conversation_id TEXT,
  type            TEXT NOT NULL CHECK (type IN ('message','mention','reaction','system')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id, is_read, created_at DESC);

-- Spec 02 P0: Web Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'web',
  created_at   TIMESTAMPTZ NOT NULL
);

-- Spec 02 P0: media attachment metadata (files stored on disk/S3)
CREATE TABLE IF NOT EXISTS media_attachments (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL CHECK (size_bytes > 0),
  stored_path  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL
);
`,
  },
  {
    id: '0005',
    name: 'wave_b_messaging_ops_tables',
    sql: `
-- Spec 02 P0: per-workspace chat folders (chat organization)
CREATE TABLE IF NOT EXISTS chat_folders (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  color            TEXT NOT NULL DEFAULT '#6366f1',
  conversation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL
);

-- Spec 02 P0: blocked workspaces (privacy/safety)
CREATE TABLE IF NOT EXISTS blocked_workspaces (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  blocked_workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL,
  UNIQUE (workspace_id, blocked_workspace_id)
);
`,
  },
  {
    id: '0006',
    name: 'wave_j_reports_evidence_appeals',
    sql: `
-- Spec 11/14: reports carry selected-message evidence and an appeal lifecycle
ALTER TABLE user_reports
  ADD COLUMN IF NOT EXISTS evidence_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS appeal_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS appeal_reason TEXT,
  ADD COLUMN IF NOT EXISTS appealed_at TIMESTAMPTZ;
`,
  },
  {
    id: '0007',
    name: 'wave_k_safety_settings_and_group_controls',
    sql: `
-- Spec 09/14: per-workspace persisted settings (privacy, messaging, etc.)
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL
);

-- Spec 14: group governance — slow mode and posting permissions
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS slow_mode_seconds   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posting_permission  TEXT NOT NULL DEFAULT 'everyone';
`,
  },
  {
    id: '0008',
    name: 'wave_4_membership_approval_and_group_invites',
    sql: `
-- Spec 14: group conversations may require admin approval for join requests
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS membership_approval_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Spec 14: group invites target a conversation; account invites leave this NULL
ALTER TABLE invite_links
  ADD COLUMN IF NOT EXISTS conversation_id TEXT NULL;

-- Spec 14: pending group join requests awaiting admin approval
CREATE TABLE IF NOT EXISTS group_join_requests (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  requester_workspace_id TEXT NOT NULL,
  invite_id       TEXT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL
);
`,
  },
  {
    id: '0009',
    name: 'wave_5_business_verification',
    sql: `
-- Spec 14: business verification applications. A workspace is only verified
-- after a trust & safety reviewer approves; payment never sets the badge.
CREATE TABLE IF NOT EXISTS business_verifications (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  legal_name             TEXT NOT NULL,
  registration_number    TEXT NOT NULL,
  website                TEXT NULL,
  contact_email          TEXT NOT NULL,
  evidence_document_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                 TEXT NOT NULL DEFAULT 'draft',
  submitted_at           TIMESTAMPTZ NULL,
  reviewer_id            TEXT NULL,
  decided_at             TIMESTAMPTZ NULL,
  decision_note          TEXT NULL,
  appeal_reason          TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL,
  updated_at             TIMESTAMPTZ NOT NULL
);
`,
  },
  {
    id: '0010',
    name: 'wave_b_api_part_2',
    sql: `
-- Wave B: per-conversation monotonic server sequence + delete-for-self scope
ALTER TABLE message_envelopes
  ADD COLUMN IF NOT EXISTS server_sequence BIGINT NULL,
  ADD COLUMN IF NOT EXISTS deleted_for JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Wave B: persisted shared-inbox assignment + conversation intent mode
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assignee_user_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS assigned_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS intent           TEXT NULL;

-- Wave B: workspace invitations (email + role, redeemed via single-use token)
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  email                TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'agent', 'analyst')),
  token                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by_account_id TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  accepted_at          TIMESTAMPTZ NULL,
  accepted_account_id  TEXT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_invitations_token ON workspace_invitations(token);

-- Wave B: workspace saved replies (canned responses)
CREATE TABLE IF NOT EXISTS saved_replies (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  shortcut     TEXT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  team_id      TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

-- Wave B: conversation vault (saved conversations) visibility settings
CREATE TABLE IF NOT EXISTS conversation_vault_settings (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  visibility      TEXT NOT NULL DEFAULT 'workspace'
                  CHECK (visibility IN ('participants', 'all', 'workspace')),
  member_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL
);
`,
  },
  {
    id: '0011',
    name: 'webhook_deliveries_and_conversation_grants',
    sql: `
-- Spec 24: webhook delivery tracking with HMAC signing + replay protection
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  integration_id  TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  signature       TEXT NOT NULL,
  timestamp       BIGINT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','delivered','failed','dead_letter')),
  delivery_status TEXT NOT NULL DEFAULT 'retrying' CHECK (delivery_status IN ('sent','failed','retrying')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  delivered_at    TIMESTAMPTZ,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_integration ON webhook_deliveries(integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status IN ('pending','failed');

-- Spec 24: per-conversation integration grants (scope narrowing)
CREATE TABLE IF NOT EXISTS conversation_module_grants (
  id                TEXT PRIMARY KEY,
  integration_id    TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  scopes            JSONB NOT NULL DEFAULT '[]'::jsonb,
  bot_permissions   JSONB NOT NULL DEFAULT '{"canJoin":true,"canReadHistory":false,"canSend":false}'::jsonb,
  granted_by        TEXT NOT NULL,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_module_grants_conversation ON conversation_module_grants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_module_grants_integration ON conversation_module_grants(integration_id);
`,
  },
  {
    id: '0013',
    name: 'portability_infrastructure',
    sql: `
-- Spec 26: import progress tracking
CREATE TABLE IF NOT EXISTS import_progress (
  id              TEXT PRIMARY KEY,
  table_name      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('importing','imported','failed')),
  error           TEXT,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spec 26: quarantined imports (malware scan failures)
CREATE TABLE IF NOT EXISTS quarantined_imports (
  id              TEXT PRIMARY KEY,
  import_id       TEXT NOT NULL REFERENCES import_progress(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  threat_type     TEXT NOT NULL,
  confidence      INTEGER NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spec 26/29: key rotation history
CREATE TABLE IF NOT EXISTS key_rotation_log (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES identity_workspaces(id) ON DELETE CASCADE,
  old_passphrase  TEXT NOT NULL,
  new_passphrase  TEXT NOT NULL,
  rotated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL CHECK (status IN ('rotating','rotated','failed')),
  notes           TEXT
);

-- Spec 29: loss key recovery events
CREATE TABLE IF NOT EXISTS loss_key_events (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovery_method     TEXT NOT NULL CHECK (recovery_method in ('identity_verification','token_usage')),
  success_flag        BOOLEAN NOT NULL,
  recovery_token_id   TEXT
);
`,
  },
  {
    id: '0012',
    name: 'event_registry_and_experiments',
    sql: `
-- Spec 25: event registry with governance
CREATE TABLE IF NOT EXISTS event_registry (
  name              TEXT PRIMARY KEY,
  definition        JSONB NOT NULL,
  event_count       BIGINT NOT NULL DEFAULT 0,
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spec 25: experiments framework
CREATE TABLE IF NOT EXISTS experiments (
  id                    TEXT PRIMARY KEY,
  hypothesis            TEXT NOT NULL,
  audience              TEXT NOT NULL CHECK (audience IN ('all','segment','percentage')),
  audience_config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  randomization_unit    TEXT NOT NULL CHECK (randomization_unit IN ('account','workspace')),
  primary_metric        TEXT NOT NULL,
  guardrail_metrics     JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner                 TEXT NOT NULL,
  rollback_threshold    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                TEXT NOT NULL CHECK (status IN ('draft','running','paused','completed')) DEFAULT 'draft',
  start_date            TIMESTAMPTZ,
  end_date              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_dates ON experiments(start_date, end_date);

-- Spec 25: experiment assignments (deterministic, stored for audit)
CREATE TABLE IF NOT EXISTS experiment_assignments (
  id              TEXT PRIMARY KEY,
  experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  unit_id         TEXT NOT NULL,
  unit_type       TEXT NOT NULL CHECK (unit_type IN ('account','workspace')),
  variant         TEXT NOT NULL CHECK (variant IN ('control','treatment')),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_experiment_assignments_experiment ON experiment_assignments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_assignments_unit ON experiment_assignments(unit_type, unit_id);

-- Spec 25: user research studies
CREATE TABLE IF NOT EXISTS research_studies (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  tasks               JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_audience     JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_minutes    INTEGER NOT NULL,
  compensation        TEXT,
  status              TEXT NOT NULL CHECK (status IN ('draft','recruiting','active','completed','archived')) DEFAULT 'draft',
  recording_consent   BOOLEAN NOT NULL DEFAULT TRUE,
  recording_retention_days INTEGER NOT NULL DEFAULT 90,
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spec 25: research study participants
CREATE TABLE IF NOT EXISTS research_participants (
  id              TEXT PRIMARY KEY,
  study_id        TEXT NOT NULL REFERENCES research_studies(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  consented_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('invited','consented','scheduled','completed','withdrawn')) DEFAULT 'invited',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_participants_study ON research_participants(study_id);
CREATE INDEX IF NOT EXISTS idx_research_participants_user ON research_participants(user_id);

-- Spec 25: research participant pools for diversity recruitment
CREATE TABLE IF NOT EXISTS research_pools (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  demographics    JSONB NOT NULL DEFAULT '{}'::jsonb,
  incentives      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  },
  {
    id: '0014',
    name: 'quarantined_files',
    sql: `CREATE TABLE IF NOT EXISTS quarantined_files (
  id              TEXT PRIMARY KEY,
  file_id         TEXT NOT NULL,
  filename        TEXT,
  mime_type       TEXT,
  size_bytes      BIGINT,
  stored_path     TEXT,
  workspace_id    TEXT,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS idx_quarantined_files_file ON quarantined_files(file_id);
`,

  },
  {
    id: '0015',
    name: 'webhook_delivery_guarantees',
    sql: `
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'retrying';
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_idempotency ON webhook_deliveries(idempotency_key) WHERE idempotency_key IS NOT NULL;
`,
  },
  {
    id: '0016',
    name: 'workflow_sla',
    sql: `
CREATE TABLE IF NOT EXISTS workflow_sla (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sla_type        TEXT NOT NULL CHECK (sla_type IN ('response','resolution','escalation')),
  deadline        TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  resolved_at     TIMESTAMPTZ,
  breach_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_sla_conversation ON workflow_sla(conversation_id);
`,
  },
  {
    id: '0017',
    name: 'trust_safety_legal_tables',
    sql: `
-- Spec 23: Trust & Safety persistence
CREATE TABLE IF NOT EXISTS spam_signals (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL,
  conversation_id  TEXT,
  signal_type      TEXT NOT NULL,
  confidence       DOUBLE PRECISION NOT NULL,
  evidence         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spam_signals_workspace ON spam_signals(workspace_id);

CREATE TABLE IF NOT EXISTS urgent_safety_cases (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  reporter_id        TEXT NOT NULL,
  severity           TEXT NOT NULL,
  description        TEXT NOT NULL,
  assigned_reviewer  TEXT,
  status             TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  resolved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_urgent_safety_cases_workspace ON urgent_safety_cases(workspace_id);

CREATE TABLE IF NOT EXISTS access_grants (
  id                  TEXT PRIMARY KEY,
  target_workspace_id TEXT NOT NULL,
  granted_by_user_id  TEXT NOT NULL,
  approver_user_id    TEXT NOT NULL,
  purpose             TEXT NOT NULL,
  capability          TEXT NOT NULL,
  duration_minutes    INTEGER NOT NULL,
  status              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revoked_by          TEXT,
  case_id             TEXT
);

-- Spec 23: Legal & Compliance persistence
CREATE TABLE IF NOT EXISTS legal_documents (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  version           TEXT NOT NULL,
  content_markdown  TEXT NOT NULL,
  effective_at      TIMESTAMPTZ NOT NULL,
  jurisdictions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_consent  BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL,
  created_by        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_legal_consents (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  document_id   TEXT NOT NULL,
  consented_at  TIMESTAMPTZ NOT NULL,
  version       TEXT NOT NULL,
  ip_hash       TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_legal_consents_user ON user_legal_consents(user_id);

CREATE TABLE IF NOT EXISTS data_requests (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  type                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  scope                TEXT,
  verification_method  TEXT,
  verified_at          TIMESTAMPTZ,
  deadline_at          TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  rejection_reason     TEXT,
  notes                TEXT,
  exceptions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_notified_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_requests_user ON data_requests(user_id);

CREATE TABLE IF NOT EXISTS legal_holds (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  conversation_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  authorized_by     TEXT NOT NULL,
  reason            TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ,
  released_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_legal_holds_workspace ON legal_holds(workspace_id);
`,
  },
];