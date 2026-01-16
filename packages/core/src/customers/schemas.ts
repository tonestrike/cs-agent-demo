import { z } from "zod";

import { phoneE164Schema } from "../crm/schemas";

export const customerCacheSchema = z.object({
  id: z.string(),
  crmCustomerId: z.string(),
  displayName: z.string(),
  phoneE164: phoneE164Schema,
  addressSummary: z.string().nullable(),
  zipCode: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
  updatedAt: z.string(),
});

export type CustomerCache = z.infer<typeof customerCacheSchema>;

export const customerCacheListInputSchema = z.object({
  q: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const customerCacheListOutputSchema = z.object({
  items: z.array(customerCacheSchema),
  nextCursor: z.string().nullable(),
});

export const customerCacheIdInputSchema = z.object({
  customerId: z.string().min(1),
});

export type CustomerCacheListInput = z.infer<
  typeof customerCacheListInputSchema
>;
export type CustomerCacheListOutput = z.infer<
  typeof customerCacheListOutputSchema
>;
export type CustomerCacheIdInput = z.infer<typeof customerCacheIdInputSchema>;
