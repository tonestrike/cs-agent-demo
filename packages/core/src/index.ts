export const CORE_VERSION = "0.0.0";

export * from "./tickets";
export * from "./calls";
export * from "./crm";
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
