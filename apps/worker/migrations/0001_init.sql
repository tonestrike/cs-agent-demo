CREATE TABLE IF NOT EXISTS customers_cache (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  crm_customer_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  address_summary TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS customers_cache_phone_idx ON customers_cache(phone_e164);

CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  phone_e164 TEXT NOT NULL,
  customer_cache_id TEXT,
  status TEXT NOT NULL,
  transport TEXT NOT NULL,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS call_sessions_phone_idx ON call_sessions(phone_e164);
CREATE INDEX IF NOT EXISTS call_sessions_status_idx ON call_sessions(status);

CREATE TABLE IF NOT EXISTS call_turns (
  id TEXT PRIMARY KEY,
  call_session_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  meta_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS call_turns_session_idx ON call_turns(call_session_id);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  category TEXT NOT NULL,
  customer_cache_id TEXT,
  phone_e164 TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee TEXT,
  source TEXT NOT NULL,
  external_ref TEXT
);

CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_priority_idx ON tickets(priority);
CREATE INDEX IF NOT EXISTS tickets_customer_idx ON tickets(customer_cache_id);
CREATE INDEX IF NOT EXISTS tickets_phone_idx ON tickets(phone_e164);

CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events(ticket_id);
