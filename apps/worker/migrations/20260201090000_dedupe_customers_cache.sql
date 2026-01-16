CREATE TABLE IF NOT EXISTS customers_cache_dedupe (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  crm_customer_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  address_summary TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO customers_cache_dedupe (id, phone_e164, crm_customer_id, display_name, address_summary, updated_at)
SELECT
  id,
  phone_e164,
  crm_customer_id,
  display_name,
  address_summary,
  updated_at
FROM customers_cache
WHERE rowid IN (
  SELECT rowid
  FROM (
    SELECT
      rowid,
      phone_e164,
      updated_at,
      ROW_NUMBER() OVER (
        PARTITION BY phone_e164
        ORDER BY updated_at DESC, rowid DESC
      ) AS rn
    FROM customers_cache
  )
  WHERE rn = 1
);

UPDATE call_sessions
SET customer_cache_id = (
  SELECT id
  FROM (
    SELECT
      id,
      phone_e164,
      ROW_NUMBER() OVER (
        PARTITION BY phone_e164
        ORDER BY updated_at DESC, rowid DESC
      ) AS rn
    FROM customers_cache
  )
  WHERE rn = 1 AND phone_e164 = call_sessions.phone_e164
)
WHERE phone_e164 IN (SELECT phone_e164 FROM customers_cache);

UPDATE tickets
SET customer_cache_id = (
  SELECT id
  FROM (
    SELECT
      id,
      phone_e164,
      ROW_NUMBER() OVER (
        PARTITION BY phone_e164
        ORDER BY updated_at DESC, rowid DESC
      ) AS rn
    FROM customers_cache
  )
  WHERE rn = 1 AND phone_e164 = tickets.phone_e164
)
WHERE phone_e164 IN (SELECT phone_e164 FROM customers_cache);

DROP TABLE customers_cache;
ALTER TABLE customers_cache_dedupe RENAME TO customers_cache;
CREATE INDEX IF NOT EXISTS customers_cache_phone_idx ON customers_cache(phone_e164);
