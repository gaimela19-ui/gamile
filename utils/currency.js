// Exchange rates and currency configurations
export const SUPPORTED_CURRENCIES = {
  // Global Currencies
  USD: { name: 'US Dollar', symbol: '$', exchangeRate: 1 },
  EUR: { name: 'Euro', symbol: '€', exchangeRate: 0.85 },
  GBP: { name: 'British Pound', symbol: '£', exchangeRate: 0.73 },
  
  // Gulf Currencies
  AED: { name: 'UAE Dirham', symbol: 'د.إ', exchangeRate: 3.67 },
  SAR: { name: 'Saudi Riyal', symbol: 'ر.س', exchangeRate: 3.75 },
  QAR: { name: 'Qatari Riyal', symbol: 'ر.ق', exchangeRate: 3.64 },
  KWD: { name: 'Kuwaiti Dinar', symbol: 'د.ك', exchangeRate: 0.31 },
  BHD: { name: 'Bahraini Dinar', symbol: 'د.ب', exchangeRate: 0.38 },
  OMR: { name: 'Omani Rial', symbol: 'ر.ع', exchangeRate: 0.38 },
  
  // Levant & North Africa
  JOD: { name: 'Jordanian Dinar', symbol: 'د.ا', exchangeRate: 0.71 },
  LBP: { name: 'Lebanese Pound', symbol: 'ل.ل', exchangeRate: 15000 },
  EGP: { name: 'Egyptian Pound', symbol: 'ج.م', exchangeRate: 30.90 },
  
  // Other Middle East
  IQD: { name: 'Iraqi Dinar', symbol: 'ع.د', exchangeRate: 1309 },
  ILS: { name: 'Israeli Shekel', symbol: '₪', exchangeRate: 3.60 }
};

export function convertPrice(amount, fromCurrency, toCurrency) {
  if (!amount || isNaN(amount)) return 0;
  if (fromCurrency === toCurrency) return amount;

  const fromRate = SUPPORTED_CURRENCIES[fromCurrency]?.exchangeRate;
  const toRate = SUPPORTED_CURRENCIES[toCurrency]?.exchangeRate;

  if (!fromRate || !toRate) {
    throw new Error('Invalid currency');
  }

  // Convert to USD first, then to target currency
  const inUSD = amount / fromRate;
  const converted = inUSD * toRate;

  // Round based on currency
  return Number(converted.toFixed(2));
}

export function formatPrice(amount, currency) {
  if (!amount || isNaN(amount)) return `${SUPPORTED_CURRENCIES[currency].symbol}0`;

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return formatter.format(amount);
}

export function validateCurrency(currency) {
  return currency in SUPPORTED_CURRENCIES;
}