import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { ApiError } from '@portfolio/contracts';

type ErrorDetail = { path: string; message: string };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

export function validationError(error: z.ZodError, message = 'Request body is invalid'): HttpError {
  const details = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  return new HttpError(400, 'VALIDATION_FAILED', message, details);
}

function sendError(res: Response, status: number, body: ApiError): void {
  res.status(status).json(body);
}

function isClientError(err: unknown): err is { status: number; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}

export const notFound: RequestHandler = (req, res) => {
  sendError(res, 404, {
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    sendError(res, err.status, {
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
    return;
  }
  // body-parser errors (malformed JSON, oversized payload) arrive with a 4xx status.
  if (isClientError(err)) {
    sendError(res, err.status, { error: { code: 'BAD_REQUEST', message: err.message } });
    return;
  }
  console.error(err);
  sendError(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
