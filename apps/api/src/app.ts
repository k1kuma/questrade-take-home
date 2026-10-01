import express from 'express';
import { errorHandler, notFound } from './http/errors';
import type { PortfolioRepository } from './portfolios/repository';
import { portfolioRoutes } from './portfolios/routes';

export type AppDeps = {
  portfolios: PortfolioRepository;
};

export function createApp({ portfolios }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use('/portfolios', portfolioRoutes(portfolios));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
