export const CORE_VERSION = "0.0.0";

export * from "./tickets";
export * from "./agent-config";
export * from "./calls";
export {
  callContextOutputSchema,
  type CallContextOutput,
} from "./calls/schemas";
export * from "./crm";
export {
  customerCacheIdInputSchema,
  customerCacheListInputSchema,
  customerCacheListOutputSchema,
  customerCacheSchema,
  type CustomerCache,
  type CustomerCacheIdInput,
  type CustomerCacheListInput,
  type CustomerCacheListOutput,
} from "./customers/schemas";
export {
  serviceAppointmentIdInputSchema,
  serviceAppointmentListInputSchema,
  serviceAppointmentListOutputSchema,
  serviceAppointmentSchema,
  serviceAppointmentStatusSchema,
  type ServiceAppointment,
  type ServiceAppointmentIdInput,
  type ServiceAppointmentListInput,
  type ServiceAppointmentListOutput,
} from "./appointments/schemas";
export * from "./errors";
export * from "./utils/phone";
