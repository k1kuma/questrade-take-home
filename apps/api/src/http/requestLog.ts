import type { RequestHandler } from 'express';

/** One line per request once it ends: method, URL, status (or "aborted"), duration. */
export const requestLog: RequestHandler = (req, res, next) => {
  const start = performance.now();
  // 'close' fires for every request; 'finish' would miss ones the client cancelled (TanStack aborts stale queries).
  res.on('close', () => {
    const outcome = res.writableFinished ? String(res.statusCode) : 'aborted';
    console.info(`[http] ${req.method} ${req.originalUrl} ${outcome} ${Math.round(performance.now() - start)}ms`);
  });
  next();
};
