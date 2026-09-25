import Settings from '../models/Settings.js';

let cached = { value: 'USD', ts: 0 };
const TTL_MS = 60 * 1000; // 1 minute cache

export async function getStoreCurrency() {
  const now = Date.now();
  if (cached.ts && now - cached.ts < TTL_MS && cached.value) return cached.value;
  try {
    const s = await Settings.findOne().select('currency').lean();
    const cur = s?.currency || process.env.STORE_CURRENCY || 'USD';
    cached = { value: cur, ts: now };
    return cur;
  } catch {
    return cached.value || 'USD';
  }
}
