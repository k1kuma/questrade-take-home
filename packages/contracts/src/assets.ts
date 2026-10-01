export const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LTC', 'USDT', 'USDC'] as const;

// Currencies the ECB publishes, as listed by Frankfurter's GET /v1/currencies.
export const FIAT_ASSETS = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
] as const;

export const ASSETS = [...CRYPTO_ASSETS, ...FIAT_ASSETS] as const;

export type CryptoAsset = (typeof CRYPTO_ASSETS)[number];
export type FiatAsset = (typeof FIAT_ASSETS)[number];
export type Asset = (typeof ASSETS)[number];

export function isCryptoAsset(asset: Asset): asset is CryptoAsset {
  return (CRYPTO_ASSETS as readonly string[]).includes(asset);
}
