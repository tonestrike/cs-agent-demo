INSERT INTO customers_cache (id, phone_e164, crm_customer_id, display_name, address_summary)
VALUES
  ('cache_cust_001', '+14155552671', 'cust_001', 'Alex Rivera', '742 Evergreen Terrace'),
  ('cache_cust_002', '+14155550987', 'cust_002', 'Morgan Lee', '123 Harbor Drive');

INSERT INTO call_sessions (id, started_at, ended_at, phone_e164, customer_cache_id, status, transport, summary)
VALUES
  ('call_001', '2025-02-01T15:00:00Z', '2025-02-01T15:04:00Z', '+14155552671', 'cache_cust_001', 'completed', 'web', 'Appointment inquiry handled.'),
  ('call_002', '2025-02-03T19:30:00Z', NULL, '+14155550987', 'cache_cust_002', 'active', 'web', NULL);

INSERT INTO call_turns (id, call_session_id, ts, speaker, text, meta_json)
VALUES
  ('turn_001', 'call_001', '2025-02-01T15:00:10Z', 'caller', 'When is my next appointment?', '{}'),
  ('turn_002', 'call_001', '2025-02-01T15:00:12Z', 'agent', 'Your next appointment is Feb 10, 10-12.', '{}');

INSERT INTO tickets (id, created_at, updated_at, status, priority, category, customer_cache_id, phone_e164, subject, description, assignee, source)
VALUES
  ('ticket_seed_001', '2025-02-02T12:00:00Z', '2025-02-02T12:00:00Z', 'open', 'normal', 'billing', 'cache_cust_001', '+14155552671', 'Billing question', 'Customer asked about balance.', NULL, 'agent');

INSERT INTO ticket_events (id, ticket_id, ts, type, payload_json)
VALUES
  ('event_seed_001', 'ticket_seed_001', '2025-02-02T12:00:00Z', 'created', '{}');
