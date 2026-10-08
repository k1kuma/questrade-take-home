import { Router } from 'express';
import { HistoryQuerySchema, type PricesUnavailableError } from '@portfolio/contracts';
import { validationError } from '../http/errors';
import type { PortfolioRepository } from '../portfolios/repository';
import { portfolioNotFound } from '../portfolios/routes';
import type { ValuationService } from './valuationService';

export function valuationRoutes(portfolios: PortfolioRepository, valuations: ValuationService): Router {
  const router = Router();

  router.get('/:id/value', async (req, res) => {
    const portfolio = portfolios.findById(req.params.id);
    if (!portfolio) throw portfolioNotFound(req.params.id);

    const outcome = await valuations.value(portfolio);
    if (outcome.kind === 'unavailable') {
      const body: PricesUnavailableError = {
        error: {
          code: 'PRICES_UNAVAILABLE',
          message: 'Some holdings have no usable price, so no total is returned rather than a partial one.',
          assets: outcome.assets,
          retryAfterSeconds: outcome.retryAfterSeconds,
        },
      };
      res.status(503).set('Retry-After', String(outcome.retryAfterSeconds)).json(body);
      return;
    }
    res.json(outcome.valuation);
  });

  router.get('/:id/history', (req, res) => {
    const query = HistoryQuerySchema.safeParse(req.query);
    if (!query.success) throw validationError(query.error, 'Query parameters are invalid');
    if (!portfolios.findById(req.params.id)) throw portfolioNotFound(req.params.id);
    res.json(valuations.history(req.params.id, query.data));
  });

  return router;
}
