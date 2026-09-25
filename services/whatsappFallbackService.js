// Lightweight WhatsApp fallback service (no external provider)
// This DOES NOT send WhatsApp messages automatically (WhatsApp requires approved providers / Business API).
// Instead it generates "click to chat" links that an automation, dashboard widget, or human can use
// to notify admins manually when push notifications are not available.
//
// Limitations:
// - No guarantee of delivery (requires someone to click the link on a device with WhatsApp installed)
// - Do NOT expose generated links (which include admin phone numbers) to public/guest APIs.
// - Intended as an internal fallback until a proper provider (e.g. WhatsApp Business Cloud API) is integrated.
//
// Environment toggles:
//   WHATSAPP_FALLBACK_ENABLED=true|false (default true)
//   WHATSAPP_FALLBACK_MAX_ADMINS= number (limit links to first N admins to avoid noise)

import User from '../models/User.js';
import Settings from '../models/Settings.js';

function sanitizePhone(number) {
  if (!number) return null;
  // Remove spaces, dashes, parentheses; keep leading + then digits
  const trimmed = number.trim();
  // Extract + then digits
  const match = trimmed.match(/^\+?[0-9]{7,16}$/);
  if (!match) return null;
  // For wa.me we must remove the leading +
  return trimmed.replace(/^[+]/, '');
}

export async function generateAdminWhatsAppLinks(orderDoc) {
  const enabled = String(process.env.WHATSAPP_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return { enabled: false, links: [] };

  if (!orderDoc) return { enabled: true, links: [] };
  const maxAdmins = Number(process.env.WHATSAPP_FALLBACK_MAX_ADMINS || 5);

  // Fetch store name (best effort)
  let storeName = '';
  try {
    const s = await Settings.findOne().select('storeName name');
    storeName = s?.storeName || s?.name || '';
  } catch {}

  // Fetch admins who opted in (if whatsappOptIn flag present) OR fallback to any admin with phoneNumber
  const admins = await User.find({ role: 'admin' }).select('_id name phoneNumber whatsappOptIn').lean();

  // Build base message (include store name prefix if available)
  const prefix = storeName ? `[${storeName}] ` : '';
  const baseMessage = `${prefix}New order ${orderDoc.orderNumber} - ${orderDoc.items?.length || 0} item(s) - Total: ${orderDoc.totalAmount} ${orderDoc.currency}`;
  const more = `Open Admin: /admin/orders?focus=${orderDoc._id}`;
  const fullMessage = `${baseMessage}\n${more}`;
  const encoded = encodeURIComponent(fullMessage);

  const links = [];
  const anyOptIn = admins.some(a => a.whatsappOptIn);

  for (const admin of admins) {
    if (links.length >= maxAdmins) break;
    const raw = admin.phoneNumber;
    const sanitized = sanitizePhone(raw);
    if (!sanitized) continue;
    if (anyOptIn && !admin.whatsappOptIn) continue;
    const url = `https://wa.me/${sanitized}?text=${encoded}`;
    links.push({ userId: admin._id, name: admin.name, phone: raw, url, preview: fullMessage, source: 'admin' });
  }

  // Extra override numbers (comma separated, may not belong to users) e.g. +15551234567,+201234567890
  const extraRaw = process.env.WHATSAPP_FALLBACK_EXTRA_NUMBERS || '';
  if (links.length < maxAdmins && extraRaw.trim()) {
    const parts = extraRaw.split(/[,;]/).map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (links.length >= maxAdmins) break;
      const sanitized = sanitizePhone(p);
      if (!sanitized) continue;
      // Avoid duplicates
      if (links.some(l => l.phone === p)) continue;
      const url = `https://wa.me/${sanitized}?text=${encoded}`;
      links.push({ userId: null, name: 'Extra', phone: p, url, preview: fullMessage, source: 'extra' });
    }
  }

  if (!admins.length && !links.length) {
    return { enabled: true, links: [] };
  }

  return { enabled: true, links };
}

// Convenience wrapper used by orderController
export async function whatsappFallbackForNewOrder(orderDoc) {
  try {
    const result = await generateAdminWhatsAppLinks(orderDoc);
    if (!result.enabled) return result;
    if (!result.links.length) {
      console.log('[WhatsAppFallback] No admin links generated (no phones / not opted in).');
    } else {
      console.log('[WhatsAppFallback] Generated links for manual notification:', result.links.map(l => ({ userId: l.userId, phone: l.phone, url: l.url })));
    }
    return result;
  } catch (e) {
    console.warn('[WhatsAppFallback] Error generating links', e);
    return { enabled: true, links: [], error: e.message };
  }
}
