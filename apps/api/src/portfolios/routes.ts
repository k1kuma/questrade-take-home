import { Router } from 'express';
import Decimal from 'decimal.js';
import { PortfolioInputSchema, type Holding } from '@portfolio/contracts';
import { HttpError, validationError } from '../http/errors';
import type { PortfolioRepository } from './repository';

function parseHoldings(body: unknown): Holding[] {
  const result = PortfolioInputSchema.safeParse(body);
  if (!result.success) throw validationError(result.error);
  // Canonical plain-notation string: 1e-7 -> "0.0000001", "007.50" -> "7.5".
  return result.data.holdings.map(({ asset, amount }) => ({
    asset,
    amount: new Decimal(amount).toFixed(),
  }));
}

function portfolioNotFound(id: string): HttpError {
  return new HttpError(404, 'PORTFOLIO_NOT_FOUND', `Portfolio ${id} not found`);
}

export function portfolioRoutes(portfolios: PortfolioRepository): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const portfolio = portfolios.create(parseHoldings(req.body));
    res.status(201).location(`/portfolios/${portfolio.id}`).json(portfolio);
  });

  router.get('/:id', (req, res) => {
    const portfolio = portfolios.findById(req.params.id);
    if (!portfolio) throw portfolioNotFound(req.params.id);
    res.json(portfolio);
  });

  router.put('/:id', (req, res) => {
    const portfolio = portfolios.replaceHoldings(req.params.id, parseHoldings(req.body));
    if (!portfolio) throw portfolioNotFound(req.params.id);
    res.json(portfolio);
  });

  return router;
}
