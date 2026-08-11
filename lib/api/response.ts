import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "../errors";
import { logger } from "../logger";

/**
 * Consistent API envelope:
 *   { data, error: { code, message } | null, meta }
 * Errors: { data: null, error: { code, message }, meta: {} }
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export function ok<T>(data: T, meta: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ data, error: null, meta }, { status });
}

export function fail(error: AppError, meta: Record<string, unknown> = {}) {
  return NextResponse.json(
    { data: null, error: { code: error.code, message: error.message, details: error.details } satisfies ApiErrorBody, meta },
    { status: error.status },
  );
}

export function failWith(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { data: null, error: { code, message, details } satisfies ApiErrorBody, meta: {} },
    { status },
  );
}

/** Parse and validate a JSON request body. Throws AppError on failure. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new AppError("VALIDATION_ERROR", "Invalid request parameters.", 422, issues);
  }
  return result.data;
}

/** Parse and validate a query string (URLSearchParams) against a zod schema. */
export function parseQuery<T extends z.ZodTypeAny>(url: URL, schema: T): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new AppError("VALIDATION_ERROR", "Invalid query parameters.", 422, issues);
  }
  return result.data;
}

/**
 * Wrap a route handler: converts AppError into the error envelope,
 * logs unexpected errors, never leaks stack traces to the client.
 */
export function handle<T extends (...args: never[]) => Promise<NextResponse>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AppError) {
        return fail(err);
      }
      logger.error({ err }, "unhandled API error");
      return failWith("INTERNAL_ERROR", "An unexpected error occurred.", 500);
    }
  }) as T;
}
