import { Router } from 'express';
import Decimal from 'decimal.js';
import {
  HoldingsOnlyInputSchema,
  ListPortfoliosQuerySchema,
  PortfolioInputSchema,
  type Holding,
  type PortfolioInput,
  type PortfolioList,
} from '@portfolio/contracts';
import { HttpError, validationError } from '../http/errors';
import type { PortfolioRepository } from './repository';

type ParsedInput = { name: string | undefined; holdings: Holding[] };

/** `{ name, holdings }` requires a name; the brief's bare array is holdings only (name undefined). */
function parseInput(body: unknown): ParsedInput {
  if (Array.isArray(body)) {
    const result = HoldingsOnlyInputSchema.safeParse({ holdings: body });
    if (!result.success) throw validationError(result.error);
    return { name: undefined, holdings: canonicalHoldings(result.data.holdings) };
  }
  const result = PortfolioInputSchema.safeParse(body);
  if (!result.success) throw validationError(result.error);
  return { name: result.data.name, holdings: canonicalHoldings(result.data.holdings) };
}

// Canonical plain-notation string: 1e-7 -> "0.0000001", "007.50" -> "7.5".
function canonicalHoldings(holdings: PortfolioInput['holdings']): Holding[] {
  return holdings.map(({ asset, amount }) => ({ asset, amount: new Decimal(amount).toFixed() }));
}

export function portfolioNotFound(id: string): HttpError {
  return new HttpError(404, 'PORTFOLIO_NOT_FOUND', `Portfolio ${id} not found`);
}

export function portfolioRoutes(portfolios: PortfolioRepository): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const query = ListPortfoliosQuerySchema.safeParse(req.query);
    if (!query.success) throw validationError(query.error, 'Query parameters are invalid');
    const body: PortfolioList = { portfolios: portfolios.listRecent(query.data.limit) };
    res.json(body);
  });

  router.post('/', (req, res) => {
    const { name, holdings } = parseInput(req.body);
    const portfolio = portfolios.create(name, holdings);
    res.status(201).location(`/portfolios/${portfolio.id}`).json(portfolio);
  });

  router.get('/:id', (req, res) => {
    const portfolio = portfolios.findById(req.params.id);
    if (!portfolio) throw portfolioNotFound(req.params.id);
    res.json(portfolio);
  });

  router.put('/:id', (req, res) => {
    const { name, holdings } = parseInput(req.body);
    const portfolio = portfolios.replace(req.params.id, name, holdings);
    if (!portfolio) throw portfolioNotFound(req.params.id);
    res.json(portfolio);
  });

  return router;
}
