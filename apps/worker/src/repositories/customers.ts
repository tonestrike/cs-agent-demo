import type { CustomerCache } from "@pestcall/core";

import { type CustomerCacheRow, mapCustomerCacheRow } from "../db/mappers";

export const createCustomerRepository = (db: D1Database) => {
  return {
    async list(params: { q?: string; limit?: number; cursor?: string }) {
      const limit = params.limit ?? 50;
      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (params.q) {
        conditions.push(
          "(display_name LIKE ? OR phone_e164 LIKE ? OR address_summary LIKE ?)",
        );
        const search = `%${params.q}%`;
        queryParams.push(search, search, search);
      }

      if (params.cursor) {
        conditions.push("updated_at < ?");
        queryParams.push(params.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const cursorClause = params.cursor ? "AND updated_at < ?" : "";
      if (params.cursor) {
        queryParams.push(params.cursor);
      }
      const sql = `
        WITH ranked AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY phone_e164
              ORDER BY updated_at DESC, rowid DESC
            ) AS rn
          FROM customers_cache
          ${whereClause}
        )
        SELECT *
        FROM ranked
        WHERE rn = 1 ${cursorClause}
        ORDER BY updated_at DESC
        LIMIT ?
      `;

      const result = await db
        .prepare(sql)
        .bind(...queryParams, limit + 1)
        .all<CustomerCacheRow & { rn: number }>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.updated_at ?? null) : null;

      return {
        items: trimmed.map(mapCustomerCacheRow),
        nextCursor,
      };
    },
    async get(customerId: string) {
      const row = await db
        .prepare("SELECT * FROM customers_cache WHERE id = ?")
        .bind(customerId)
        .first<CustomerCacheRow>();

      return row ? mapCustomerCacheRow(row) : null;
    },
    async upsert(customer: CustomerCache) {
      await db
        .prepare(
          "INSERT INTO customers_cache (id, phone_e164, crm_customer_id, display_name, address_summary, zip_code, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET phone_e164 = excluded.phone_e164, crm_customer_id = excluded.crm_customer_id, display_name = excluded.display_name, address_summary = excluded.address_summary, zip_code = excluded.zip_code, updated_at = excluded.updated_at",
        )
        .bind(
          customer.id,
          customer.phoneE164,
          customer.crmCustomerId,
          customer.displayName,
          customer.addressSummary ?? null,
          customer.zipCode ?? null,
          customer.updatedAt,
        )
        .run();
    },
  };
};
