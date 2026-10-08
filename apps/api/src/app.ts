import express from 'express';
import { errorHandler, notFound } from './http/errors';
import { requestLog } from './http/requestLog';
import type { PortfolioRepository } from './portfolios/repository';
import { portfolioRoutes } from './portfolios/routes';
import { valuationRoutes } from './valuation/routes';
import type { ValuationService } from './valuation/valuationService';

export type AppDeps = {
  portfolios: PortfolioRepository;
  valuations: ValuationService;
};

export function createApp({ portfolios, valuations }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog);
  app.use(express.json());

  app.use('/portfolios', portfolioRoutes(portfolios));
  app.use('/portfolios', valuationRoutes(portfolios, valuations));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
