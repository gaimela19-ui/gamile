import MobilePushToken from '../models/MobilePushToken.js';
import { sendExpoPush } from './expoPushService.js';
import { computeBadgesForTokens } from './badgeService.js';

function formatTitleBody(sale) {
  const lightning = '⚡';
  const titleBase = (sale?.name && String(sale.name).trim()) || 'Flash Sale';
  const title = `${titleBase.toUpperCase()} ${lightning}${lightning}`.slice(0, 80);
  let body;
  if (sale?.pricingMode === 'percent' && sale?.discountPercent) {
    body = `המבצע התחיל! מחכות לך הנחות עד ${Number(sale.discountPercent).toFixed(0)}% 🛒✨`;
  } else {
    body = 'הנחות גדולות התחילו! בחר את המועדפים שלך עכשיו! 🛒✨';
  }
  return { title, body };
}

export async function autoNotifyFlashSale(sale, createdBy) {
  try {
    if (!sale) return { ok: false, skipped: true };
    // Only notify if sale is active now
    const now = new Date();
    if (!sale.active) return { ok: true, skipped: 'inactive' };
    if (new Date(sale.startDate) > now) return { ok: true, skipped: 'not_started' };
    if (new Date(sale.endDate) <= now) return { ok: true, skipped: 'ended' };

    const docs = await MobilePushToken.find({}).lean().select('expoPushToken user');
    const tokens = docs.map(d => d.expoPushToken);
    if (!tokens.length) return { ok: true, delivered: 0, skipped: 'no_tokens' };

    const { title, body } = formatTitleBody(sale);
    const nid = 'nid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const badges = await computeBadgesForTokens(docs);
    const data = { type: 'flash-sale', saleId: String(sale._id), deepLink: `/flash-sale/${sale._id}`, nid };
    const result = await sendExpoPush({ tokens, title, body, data, badges });
    return { ok: true, delivered: tokens.length, result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
