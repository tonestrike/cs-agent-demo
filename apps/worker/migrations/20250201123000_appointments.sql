CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  address_summary TEXT NOT NULL,
  date TEXT NOT NULL,
  time_window TEXT NOT NULL,
  status TEXT NOT NULL,
  rescheduled_from_id TEXT,
  rescheduled_to_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS appointments_customer_idx ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS appointments_phone_idx ON appointments(phone_e164);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON appointments(status);
CREATE INDEX IF NOT EXISTS appointments_rescheduled_from_idx ON appointments(rescheduled_from_id);
CREATE INDEX IF NOT EXISTS appointments_rescheduled_to_idx ON appointments(rescheduled_to_id);
