import type { createCustomerRepository } from "../repositories/customers";

export const listCustomers = (
  repo: ReturnType<typeof createCustomerRepository>,
  params: { q?: string; limit?: number; cursor?: string },
) => repo.list(params);

export const getCustomer = (
  repo: ReturnType<typeof createCustomerRepository>,
  customerId: string,
) => repo.get(customerId);
