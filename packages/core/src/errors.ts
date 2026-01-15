export type ErrorMetadata = Record<string, unknown>;

type AppErrorOptions = {
  code?: string;
  status?: number;
  meta?: ErrorMetadata;
  cause?: unknown;
};

export class AppError extends Error {
  code: string;
  status?: number;
  meta?: ErrorMetadata;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.status = options.status;
    this.meta = options.meta;
    if (options.cause) {
      try {
        this.cause = options.cause;
      } catch {
        // ignore if runtime does not support cause
      }
    }
  }
}
