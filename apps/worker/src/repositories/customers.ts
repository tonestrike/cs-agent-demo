import type { CustomerCache, CustomerMatch } from "@pestcall/core";

import { type CustomerCacheRow, mapCustomerCacheRow } from "../db/mappers";

/**
 * Map CustomerCache to CustomerMatch for CRM adapter compatibility.
 */
const toCustomerMatch = (customer: CustomerCache): CustomerMatch => ({
  id: customer.id,
  displayName: customer.displayName,
  phoneE164: customer.phoneE164,
  addressSummary: customer.addressSummary ?? "",
  zipCode: customer.zipCode ?? undefined,
});

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
          "INSERT INTO customers_cache (id, phone_e164, crm_customer_id, display_name, address_summary, zip_code, participant_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET phone_e164 = excluded.phone_e164, crm_customer_id = excluded.crm_customer_id, display_name = excluded.display_name, address_summary = excluded.address_summary, zip_code = excluded.zip_code, participant_id = excluded.participant_id, updated_at = excluded.updated_at",
        )
        .bind(
          customer.id,
          customer.phoneE164,
          customer.crmCustomerId,
          customer.displayName,
          customer.addressSummary ?? null,
          customer.zipCode ?? null,
          customer.participantId ?? null,
          customer.updatedAt,
        )
        .run();
    },

    /**
     * Look up customers by phone number (E.164 format).
     */
    async lookupByPhone(phoneE164: string): Promise<CustomerMatch[]> {
      const result = await db
        .prepare("SELECT * FROM customers_cache WHERE phone_e164 = ?")
        .bind(phoneE164)
        .all<CustomerCacheRow>();

      return (result.results ?? []).map((row) =>
        toCustomerMatch(mapCustomerCacheRow(row)),
      );
    },

    /**
     * Look up customers by name and ZIP code.
     */
    async lookupByNameAndZip(
      fullName: string,
      zipCode: string,
    ): Promise<CustomerMatch[]> {
      const result = await db
        .prepare(
          "SELECT * FROM customers_cache WHERE display_name LIKE ? AND zip_code = ?",
        )
        .bind(`%${fullName}%`, zipCode)
        .all<CustomerCacheRow>();

      return (result.results ?? []).map((row) =>
        toCustomerMatch(mapCustomerCacheRow(row)),
      );
    },

    /**
     * Verify a customer's ZIP code matches.
     */
    async verifyZip(customerId: string, zipCode: string): Promise<boolean> {
      const row = await db
        .prepare("SELECT zip_code FROM customers_cache WHERE id = ?")
        .bind(customerId)
        .first<{ zip_code: string | null }>();

      return row?.zip_code === zipCode;
    },
  };
};
