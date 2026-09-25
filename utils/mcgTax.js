const DEFAULT_TAX_MULTIPLIER = 1.18;

function toFixedNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_TAX_MULTIPLIER;
  return Number(num.toFixed(digits));
}

export function normalizeTaxMultiplier(value, fallback = DEFAULT_TAX_MULTIPLIER) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  let normalized = fallback;
  if (raw >= 1 && raw < 5) {
    normalized = raw;
  } else if (raw >= 5 && raw < 50) {
    normalized = 1 + raw / 100;
  } else if (raw >= 50) {
    normalized = raw / 100;
  } else {
    normalized = fallback;
  }
  if (!Number.isFinite(normalized) || normalized < 1) normalized = fallback;
  return toFixedNumber(normalized);
}

export function percentToMultiplier(percent, fallback = DEFAULT_TAX_MULTIPLIER) {
  const raw = Number(percent);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  const normalized = 1 + raw / 100;
  return toFixedNumber(Math.max(1, normalized));
}

export function multiplierToPercent(multiplier) {
  const raw = Number(multiplier);
  if (!Number.isFinite(raw) || raw < 1) return 0;
  const pct = (raw - 1) * 100;
  return Number(Math.max(0, pct).toFixed(2));
}

export { DEFAULT_TAX_MULTIPLIER };
