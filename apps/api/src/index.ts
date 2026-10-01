import { createApp } from './app';
import { config } from './config';
import { openDatabase } from './db/connection';
import { PortfolioRepository } from './portfolios/repository';

const db = openDatabase(config.dbPath);
const app = createApp({ portfolios: new PortfolioRepository(db) });

app.listen(config.port, (error) => {
  if (error) throw error;
  console.log(`API listening on http://localhost:${config.port}`);
});
