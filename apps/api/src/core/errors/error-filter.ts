import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

/** The one error body every endpoint returns (docs/api-contract.md, Conventions). */
export interface ErrorBody {
  /** Stable and machine-readable, such as `not_found` or `forbidden`. */
  code: string;
  /** Written for the person using the app; the web client shows it as it is. */
  message: string;
  details?: unknown;
}

const CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "invalid_request",
  [HttpStatus.UNAUTHORIZED]: "unauthenticated",
  [HttpStatus.FORBIDDEN]: "forbidden",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "rule_broken",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
};

/** Turns an HTTP exception into an ErrorBody with its own code, or keeps the one it already has. */
function bodyFor(exception: HttpException): ErrorBody {
  const response = exception.getResponse();
  const given = typeof response === "object" && response !== null ? (response as Partial<ErrorBody>) : {};
  return {
    code: typeof given.code === "string" ? given.code : (CODES[exception.getStatus()] ?? "error"),
    message: typeof given.message === "string" ? given.message : exception.message,
    ...(given.details === undefined ? {} : { details: given.details }),
  };
}

/**
 * Every failure leaves the API as an ErrorBody. Unexpected errors are logged and answered with a
 * plain 500, so stack traces and SQL never reach the browser (blueprint "Security": monitoring).
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(bodyFor(exception));
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const body: ErrorBody = { code: "internal_error", message: "Something went wrong. Please try again." };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
