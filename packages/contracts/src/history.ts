import { z } from 'zod';

export const HistoryQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    maxPoints: z.coerce.number().int().min(2).max(2000).default(500),
  })
  .refine(({ from, to }) => !from || !to || Date.parse(from) <= Date.parse(to), {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type HistoryQuery = z.output<typeof HistoryQuerySchema>;

export type HistoryPoint = {
  at: string;
  totalCad: string;
  /** 'degraded' if this snapshot, or any snapshot it stands in for after downsampling, was degraded. */
  status: 'complete' | 'degraded';
};

export type ValuationHistory = {
  portfolioId: string;
  /** Defaults to the first snapshot; equals `to` when there is no history. */
  from: string;
  /** Defaults to now. */
  to: string;
  /** True when the range held more than maxPoints snapshots and each point is the latest of a time bucket. */
  downsampled: boolean;
  points: HistoryPoint[];
};
