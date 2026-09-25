const FINAL_PRICE_KEYS = ['item_final_price', 'itemFinalPrice', 'ItemFinalPrice', 'FinalPrice', 'finalPrice'];

export function extractFinalPrice(item) {
  if (!item || typeof item !== 'object') return null;
  for (const key of FINAL_PRICE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      const value = Number(item[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

export function hasFinalPrice(item) {
  return extractFinalPrice(item) !== null;
}
