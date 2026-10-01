import path from 'node:path';

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

export const config = {
  port: parsePort(process.env.PORT, 3000),
  // Relative paths resolve against the API package directory, where npm runs the script.
  dbPath: path.resolve(process.env.DB_PATH ?? 'data/portfolio.db'),
};
