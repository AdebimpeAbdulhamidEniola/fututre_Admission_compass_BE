/**
 * Mirrors the Nest-style envelope the frontend's http.ts already expects:
 * { statusCode, message, error }, where message may be a string or string[].
 */
export class ApiError extends Error {
  statusCode: number;
  error: string;
  details?: unknown;
  /** The original message shape (string or string[]) as sent to the client. */
  messagePayload: string | string[];

  constructor(statusCode: number, message: string | string[], error: string, details?: unknown) {
    super(Array.isArray(message) ? message.join(", ") : message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.error = error;
    this.details = details;
    this.messagePayload = message;
  }

  toJSON() {
    return {
      statusCode: this.statusCode,
      message: this.messagePayload,
      error: this.error,
    };
  }
}

export const notFound = (resource: string) => new ApiError(404, `${resource} not found`, "Not Found");

export const badRequest = (message: string | string[]) => new ApiError(400, message, "Bad Request");

export const unauthorized = (message = "Authentication required") =>
  new ApiError(401, message, "Unauthorized");

export const forbidden = (message = "You do not have access to this resource") =>
  new ApiError(403, message, "Forbidden");
