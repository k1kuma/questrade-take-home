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

const HoldingsInputSchema = z
  .array(HoldingInputSchema)
  .max(100)
  .superRefine((holdings, ctx) => {
    const seen = new Set<Asset>();
    holdings.forEach((holding, index) => {
      if (seen.has(holding.asset)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate asset ${holding.asset}`, path: [index, 'asset'] });
      }
      seen.add(holding.asset);
    });
  });

export const PortfolioNameSchema = z.string().trim().min(1, 'Name is required').max(100);

/** The full form for POST and PUT: a name is required. */
export const PortfolioInputSchema = z.object({
  name: PortfolioNameSchema,
  holdings: HoldingsInputSchema,
});

/** The brief's bare-array body, wrapped as { holdings }: POST auto-names it, PUT keeps the current name. */
export const HoldingsOnlyInputSchema = z.object({ holdings: HoldingsInputSchema });

export type PortfolioInput = z.output<typeof PortfolioInputSchema>;
/** What a client sends for `{ name, holdings }`, before the schema's trimming and normalising. */
export type PortfolioRequest = z.input<typeof PortfolioInputSchema>;

export const ListPortfoliosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PortfolioSummary = {
  id: string;
  name: string;
  assets: Asset[];
  createdAt: string;
  updatedAt: string;
};

export type PortfolioList = {
  portfolios: PortfolioSummary[];
};

export type Holding = {
  asset: Asset;
  amount: string;
};

export type Portfolio = {
  id: string;
  name: string;
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
