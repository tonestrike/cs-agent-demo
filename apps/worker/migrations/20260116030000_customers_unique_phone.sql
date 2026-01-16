CREATE TABLE IF NOT EXISTS customers_cache_new (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  crm_customer_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  address_summary TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO customers_cache_new (id, phone_e164, crm_customer_id, display_name, address_summary, updated_at)
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

DROP TABLE customers_cache;
ALTER TABLE customers_cache_new RENAME TO customers_cache;
CREATE INDEX IF NOT EXISTS customers_cache_phone_idx ON customers_cache(phone_e164);
