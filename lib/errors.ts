/**
 * Application error with a stable machine-readable code and an HTTP status.
 * Codes are part of the API contract (see docs/api.md).
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Generic error factory helpers. */
export const errors = {
  badRequest: (code: string, message: string, details?: unknown) =>
    new AppError(code, message, 400, details),
  unauthorized: (message = "Authentication required.") =>
    new AppError("UNAUTHORIZED", message, 401),
  forbidden: (message = "You are not allowed to perform this action.") =>
    new AppError("FORBIDDEN", message, 403),
  notFound: (code: string, message: string) => new AppError(code, message, 404),
  conflict: (code: string, message: string) => new AppError(code, message, 409),
  validation: (message: string, details?: unknown) =>
    new AppError("VALIDATION_ERROR", message, 422, details),
  tooManyRequests: (message = "Too many requests. Please try again later.") =>
    new AppError("RATE_LIMITED", message, 429),
  internal: (message = "An unexpected error occurred.") =>
    new AppError("INTERNAL_ERROR", message, 500),
};

/** Stable error codes used across the API (documented in docs/api.md). */
export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_UNAVAILABLE: "AGENT_UNAVAILABLE",
  AGENT_ENDPOINT_UNAVAILABLE: "AGENT_ENDPOINT_UNAVAILABLE",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  NONCE_EXPIRED: "NONCE_EXPIRED",
  NONCE_REUSED: "NONCE_REUSED",
  WALLET_NOT_CONNECTED: "WALLET_NOT_CONNECTED",
  WRONG_NETWORK: "WRONG_NETWORK",
  SIGNATURE_REJECTED: "SIGNATURE_REJECTED",
  TRANSACTION_REJECTED: "TRANSACTION_REJECTED",
  TRANSACTION_PENDING: "TRANSACTION_PENDING",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  AGENT_EXECUTION_FAILED: "AGENT_EXECUTION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
