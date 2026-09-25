// Simple WhatsApp link generation (no external provider/API send)
// We cannot auto-send messages without using the official WhatsApp Business API (Meta Cloud or BSP).
// This service only builds wa.me / api.whatsapp.com deep links that the admin can click to open chats manually.
// Bulk "sending" becomes opening each link (user interaction required).

import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import crypto from 'crypto';
import WhatsAppAudit from '../models/WhatsAppAudit.js';

export function normalizePhone(raw){
  if (!raw) return null;
  const stripped = raw.toString().trim().replace(/[^+\d]/g, '');
  if (!/^\+?[1-9]\d{6,15}$/.test(stripped)) return null;
  return stripped.startsWith('+') ? stripped : '+' + stripped;
}

export function buildWhatsAppLink(phoneNumber, message){
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) throw new ApiError(400, 'Invalid phone number');
  const digits = normalized.substring(1); // remove +
  const encodedMsg = encodeURIComponent(message || '');
  return { url: `https://wa.me/${digits}${encodedMsg ? `?text=${encodedMsg}` : ''}`, normalized };
}

export async function buildLinksForUsers({ userIds, message, onlyOptIn = true, adminId, audit = true }) {
  if (!Array.isArray(userIds) || userIds.length === 0) throw new ApiError(400, 'userIds array required');
  const query = { _id: { $in: userIds } };
  if (onlyOptIn) query.whatsappOptIn = true;
  const users = await User.find(query).select('_id name phoneNumber whatsappOptIn').lean();
  const links = users.map(u => {
    if (!u.phoneNumber) return { userId: u._id, name: u.name, skipped: true, reason: 'no-phone' };
    try {
      const { url, normalized } = buildWhatsAppLink(u.phoneNumber, message);
      return { userId: u._id, name: u.name, phoneNumber: normalized, url };
    } catch (e) {
      return { userId: u._id, name: u.name, phoneNumber: u.phoneNumber, skipped: true, reason: e.message };
    }
  });
  const result = { count: links.filter(l => l.url).length, total: links.length, links };
  if (audit && adminId) {
    await WhatsAppAudit.create({
      admin: adminId,
      userIds: users.map(u=>u._id),
      message,
      messageHash: crypto.createHash('sha256').update(message || '').digest('hex'),
      generatedLinks: result.count,
      skipped: result.total - result.count,
      context: { onlyOptIn }
    });
    // update user last contact (preview first 160 chars)
    const preview = (message || '').slice(0,160);
    await User.updateMany({ _id: { $in: links.filter(l=>l.url).map(l=>l.userId) } }, { $set: { lastWhatsAppContactAt: new Date(), lastWhatsAppMessagePreview: preview } });
  }
  return result;
}

export async function buildLinksByFilter({ message, onlyOptIn = true, limit, adminId, audit = true }) {
  const query = { phoneNumber: { $exists: true, $ne: null } };
  if (onlyOptIn) query.whatsappOptIn = true;
  const cursor = User.find(query).select('_id name phoneNumber whatsappOptIn').limit(limit || 0).lean();
  const users = await cursor;
  const links = users.map(u => {
    try {
      const { url, normalized } = buildWhatsAppLink(u.phoneNumber, message);
      return { userId: u._id, name: u.name, phoneNumber: normalized, url };
    } catch (e) {
      return { userId: u._id, name: u.name, phoneNumber: u.phoneNumber, skipped: true, reason: e.message };
    }
  });
  const result = { count: links.filter(l => l.url).length, total: links.length, links };
  if (audit && adminId) {
    await WhatsAppAudit.create({
      admin: adminId,
      userIds: users.map(u=>u._id),
      message,
      messageHash: crypto.createHash('sha256').update(message || '').digest('hex'),
      generatedLinks: result.count,
      skipped: result.total - result.count,
      context: { onlyOptIn, limit }
    });
    const preview = (message || '').slice(0,160);
    await User.updateMany({ _id: { $in: links.filter(l=>l.url).map(l=>l.userId) } }, { $set: { lastWhatsAppContactAt: new Date(), lastWhatsAppMessagePreview: preview } });
  }
  return result;
}
