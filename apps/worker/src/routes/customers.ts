import { ORPCError } from "@orpc/server";
import {
  customerCacheIdInputSchema,
  customerCacheListInputSchema,
  customerCacheListOutputSchema,
  customerCacheSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import { getCustomer, listCustomers } from "../use-cases/customers";

export const customerProcedures = {
  list: authedProcedure
    .input(customerCacheListInputSchema)
    .output(customerCacheListOutputSchema)
    .handler(async ({ input, context }) => {
      return listCustomers(context.deps.customers, input);
    }),
  get: authedProcedure
    .input(customerCacheIdInputSchema)
    .output(customerCacheSchema)
    .handler(async ({ input, context }) => {
      const customer = await getCustomer(
        context.deps.customers,
        input.customerId,
      );
      if (!customer) {
        throw new ORPCError("NOT_FOUND", { message: "Customer not found" });
      }
      return customer;
    }),
};
