import type { ServiceAppointment } from "@pestcall/core";

import { type AppointmentRow, mapAppointmentRow } from "../db/mappers";

type AppointmentRowResult = AppointmentRow & {
  status: ServiceAppointment["status"];
};

export const createAppointmentRepository = (db: D1Database) => {
  return {
    async list(params: {
      customerId?: string;
      phoneE164?: string;
      limit?: number;
      cursor?: string;
    }) {
      const limit = params.limit ?? 50;
      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (params.customerId) {
        conditions.push("appointments.customer_id = ?");
        queryParams.push(params.customerId);
      }

      if (params.phoneE164) {
        conditions.push("appointments.phone_e164 = ?");
        queryParams.push(params.phoneE164);
      }

      if (params.cursor) {
        conditions.push("appointments.created_at < ?");
        queryParams.push(params.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `
        SELECT
          appointments.*,
          customers_cache.id AS customer_join_id,
          customers_cache.phone_e164 AS customer_phone_e164,
          customers_cache.crm_customer_id AS customer_crm_id,
          customers_cache.display_name AS customer_display_name,
          customers_cache.address_summary AS customer_address_summary,
          customers_cache.updated_at AS customer_updated_at
        FROM appointments
        LEFT JOIN customers_cache
          ON customers_cache.id = appointments.customer_id
        ${whereClause}
        ORDER BY appointments.created_at DESC
        LIMIT ?
      `;

      const result = await db
        .prepare(sql)
        .bind(...queryParams, limit + 1)
        .all<AppointmentRowResult>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.created_at ?? null) : null;

      return {
        items: trimmed.map(mapAppointmentRow),
        nextCursor,
      };
    },
    async get(appointmentId: string) {
      const row = await db
        .prepare(
          `
          SELECT
            appointments.*,
            customers_cache.id AS customer_join_id,
            customers_cache.phone_e164 AS customer_phone_e164,
            customers_cache.crm_customer_id AS customer_crm_id,
            customers_cache.display_name AS customer_display_name,
            customers_cache.address_summary AS customer_address_summary,
            customers_cache.updated_at AS customer_updated_at
          FROM appointments
          LEFT JOIN customers_cache
            ON customers_cache.id = appointments.customer_id
          WHERE appointments.id = ?
          `,
        )
        .bind(appointmentId)
        .first<AppointmentRowResult>();

      return row ? mapAppointmentRow(row) : null;
    },
    async getLatestForCustomer(customerId: string) {
      const row = await db
        .prepare(
          `
          SELECT
            appointments.*,
            customers_cache.id AS customer_join_id,
            customers_cache.phone_e164 AS customer_phone_e164,
            customers_cache.crm_customer_id AS customer_crm_id,
            customers_cache.display_name AS customer_display_name,
            customers_cache.address_summary AS customer_address_summary,
            customers_cache.updated_at AS customer_updated_at
          FROM appointments
          LEFT JOIN customers_cache
            ON customers_cache.id = appointments.customer_id
          WHERE appointments.customer_id = ? AND appointments.status = 'scheduled'
          ORDER BY appointments.date DESC
          LIMIT 1
          `,
        )
        .bind(customerId)
        .first<AppointmentRowResult>();

      return row ? mapAppointmentRow(row) : null;
    },
    async insert(appointment: ServiceAppointment) {
      await db
        .prepare(
          "INSERT INTO appointments (id, customer_id, phone_e164, address_summary, date, time_window, status, rescheduled_from_id, rescheduled_to_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          appointment.id,
          appointment.customerId,
          appointment.phoneE164,
          appointment.addressSummary,
          appointment.date,
          appointment.timeWindow,
          appointment.status,
          appointment.rescheduledFromId ?? null,
          appointment.rescheduledToId ?? null,
          appointment.createdAt,
          appointment.updatedAt,
        )
        .run();
    },
    async upsert(appointment: ServiceAppointment) {
      await db
        .prepare(
          "INSERT INTO appointments (id, customer_id, phone_e164, address_summary, date, time_window, status, rescheduled_from_id, rescheduled_to_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, phone_e164 = excluded.phone_e164, address_summary = excluded.address_summary, date = excluded.date, time_window = excluded.time_window, status = excluded.status, rescheduled_from_id = excluded.rescheduled_from_id, rescheduled_to_id = excluded.rescheduled_to_id, updated_at = excluded.updated_at",
        )
        .bind(
          appointment.id,
          appointment.customerId,
          appointment.phoneE164,
          appointment.addressSummary,
          appointment.date,
          appointment.timeWindow,
          appointment.status,
          appointment.rescheduledFromId ?? null,
          appointment.rescheduledToId ?? null,
          appointment.createdAt,
          appointment.updatedAt,
        )
        .run();
    },
    async markRescheduled(input: {
      appointmentId: string;
      rescheduledToId: string;
      updatedAt: string;
    }) {
      await db
        .prepare(
          "UPDATE appointments SET status = 'rescheduled', rescheduled_to_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(input.rescheduledToId, input.updatedAt, input.appointmentId)
        .run();
    },
    async linkReschedule(input: {
      appointmentId: string;
      rescheduledFromId: string;
      updatedAt: string;
    }) {
      await db
        .prepare(
          "UPDATE appointments SET rescheduled_from_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(input.rescheduledFromId, input.updatedAt, input.appointmentId)
        .run();
    },
  };
};
