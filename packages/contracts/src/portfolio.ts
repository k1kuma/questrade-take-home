import { z } from 'zod';
import { ASSETS, type Asset } from './assets';

const DECIMAL = /^\d+(\.\d+)?$/;

const AssetSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(ASSETS, { error: `Unsupported asset; expected one of ${ASSETS.join(', ')}` }));

// Decimal strings let clients send amounts beyond float precision.
const AmountSchema = z
  .union([z.number(), z.string()], { error: 'Amount must be a number or a decimal string' })
  .refine(
    (value) =>
      typeof value === 'number'
        ? value > 0
        : value.length <= 40 && DECIMAL.test(value) && /[1-9]/.test(value),
    'Amount must be a positive decimal, e.g. 0.5 or "0.5"',
  );

const HoldingInputSchema = z.object({ asset: AssetSchema, amount: AmountSchema });

export const PortfolioInputSchema = z.preprocess(
  // Accept the brief's bare-array body as well as { holdings: [...] }.
  (body) => (Array.isArray(body) ? { holdings: body } : body),
  z
    .object({ holdings: z.array(HoldingInputSchema).max(100) })
    .superRefine(({ holdings }, ctx) => {
      const seen = new Set<Asset>();
      holdings.forEach((holding, index) => {
        if (seen.has(holding.asset)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate asset ${holding.asset}`,
            path: ['holdings', index, 'asset'],
          });
        }
        seen.add(holding.asset);
      });
    }),
);

export type PortfolioInput = z.output<typeof PortfolioInputSchema>;

export type Holding = {
  asset: Asset;
  amount: string;
};

export type Portfolio = {
  id: string;
  holdings: Holding[];
  createdAt: string;
  updatedAt: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
};
