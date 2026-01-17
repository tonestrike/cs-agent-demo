-- Seed customers matching the fixtures
INSERT OR REPLACE INTO customers_cache (id, phone_e164, crm_customer_id, display_name, address_summary, zip_code, participant_id, updated_at)
VALUES
  ('cust_001', '+14155552671', 'cust_001', 'Alex Rivera', '742 Evergreen Terrace', '94107', NULL, '2025-01-01T00:00:00Z'),
  ('cust_002', '+14155550987', 'cust_002', 'Morgan Lee', '123 Harbor Drive', '98109', NULL, '2025-01-01T00:00:00Z'),
  ('cust_003', '+14155551234', 'cust_003', 'Pat Quinn', '88 Market Street', '60601', NULL, '2025-01-01T00:00:00Z'),
  ('cust_004', '+14155551234', 'cust_004', 'Riley Hart', '55 Pine Avenue', '60602', NULL, '2025-01-01T00:00:00Z');

-- Seed appointments with future dates (relative to 2026)
INSERT OR REPLACE INTO appointments (
  id,
  customer_id,
  phone_e164,
  address_summary,
  date,
  time_window,
  status,
  rescheduled_from_id,
  rescheduled_to_id,
  created_at,
  updated_at
)
VALUES
  (
    'appt_seed_001',
    'cust_001',
    '+14155552671',
    '742 Evergreen Terrace',
    '2026-02-10',
    '10:00-12:00',
    'scheduled',
    NULL,
    NULL,
    '2026-01-01T10:00:00Z',
    '2026-01-01T10:00:00Z'
  ),
  (
    'appt_seed_002',
    'cust_002',
    '+14155550987',
    '123 Harbor Drive',
    '2026-02-12',
    '14:00-16:00',
    'scheduled',
    NULL,
    NULL,
    '2026-01-01T11:00:00Z',
    '2026-01-01T11:00:00Z'
  ),
  (
    'appt_seed_003',
    'cust_002',
    '+14155550987',
    '123 Harbor Drive',
    '2026-03-05',
    '09:00-11:00',
    'scheduled',
    NULL,
    NULL,
    '2026-01-01T12:00:00Z',
    '2026-01-01T12:00:00Z'
  ),
  (
    'appt_seed_004',
    'cust_003',
    '+14155551234',
    '88 Market Street',
    '2026-02-18',
    '08:00-10:00',
    'scheduled',
    NULL,
    NULL,
    '2026-01-01T13:00:00Z',
    '2026-01-01T13:00:00Z'
  ),
  (
    'appt_seed_005',
    'cust_004',
    '+14155551234',
    '55 Pine Avenue',
    '2026-02-19',
    '15:00-17:00',
    'scheduled',
    NULL,
    NULL,
    '2026-01-01T14:00:00Z',
    '2026-01-01T14:00:00Z'
  );

-- Sample call session
INSERT OR REPLACE INTO call_sessions (id, started_at, ended_at, phone_e164, customer_cache_id, status, transport, summary)
VALUES
  ('call_seed_001', '2026-01-01T15:00:00Z', '2026-01-01T15:04:00Z', '+14155552671', 'cust_001', 'completed', 'web', '{"identityStatus":"verified","verifiedCustomerId":"cust_001"}');

-- Sample call turn
INSERT OR REPLACE INTO call_turns (id, call_session_id, ts, speaker, text, meta_json)
VALUES
  ('turn_seed_001', 'call_seed_001', '2026-01-01T15:00:10Z', 'caller', 'When is my next appointment?', '{}'),
  ('turn_seed_002', 'call_seed_001', '2026-01-01T15:00:12Z', 'agent', 'Your next appointment is Feb 10, 10:00-12:00.', '{}');

-- Sample ticket
INSERT OR REPLACE INTO tickets (id, created_at, updated_at, status, priority, category, customer_cache_id, phone_e164, subject, description, assignee, source)
VALUES
  ('ticket_seed_001', '2026-01-02T12:00:00Z', '2026-01-02T12:00:00Z', 'open', 'normal', 'billing', 'cust_001', '+14155552671', 'Billing question', 'Customer asked about balance.', NULL, 'agent');

INSERT OR REPLACE INTO ticket_events (id, ticket_id, ts, type, payload_json)
VALUES
  ('event_seed_001', 'ticket_seed_001', '2026-01-02T12:00:00Z', 'created', '{}');
