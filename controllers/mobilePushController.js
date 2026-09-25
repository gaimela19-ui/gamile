import MobilePushToken from '../models/MobilePushToken.js';
import { sendExpoPush } from '../services/expoPushService.js';
import { computeBadgesForTokens, computeUnreadBadgeForUser } from '../services/badgeService.js';
import PushLog from '../models/PushLog.js';
import PushOpen from '../models/PushOpen.js';
import ScheduledPush from '../models/ScheduledPush.js';

const LOOPBACK_HOST_RX = /^(localhost|127(?:\.\d+){0,2}|0\.0\.0\.0|\[?::1\]?)/i;
const ENV_ASSET_BASE = (() => {
  const candidate = (process.env.PUBLIC_ASSETS_BASE_URL
    || process.env.PUBLIC_WEB_URL
    || process.env.PUBLIC_API_URL
    || process.env.FRONTEND_BASE_URL
    || process.env.STORE_BASE_URL
    || '').trim();
  if (!candidate) return '';
  return candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
})();

function joinWithBase(base, relative) {
  if (!base) return null;
  try {
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return new URL(relative, normalizedBase).toString();
  } catch {
    const path = relative.startsWith('/') ? relative : `/${relative}`;
    return `${base}${path}`;
  }
}

function extractHostMeta(req) {
  if (!req) return null;
  const headers = req.headers || {};
  const protoHeader = (headers['x-forwarded-proto'] || '').toString();
  const proto = protoHeader.split(',')[0] || req.protocol || 'http';
  const hostHeader = (headers['x-forwarded-host'] || headers.host || '').toString();
  const derivedHost = typeof req.get === 'function' ? req.get('host') : req.host;
  const host = (hostHeader || derivedHost || '').split(',')[0];
  if (!host) return null;
  return { proto, host };
}

function ensureAbsoluteUrl(req, url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) {
    try { return new URL(url).toString(); } catch { return url; }
  }
  const hostMeta = extractHostMeta(req);
  if (hostMeta && !LOOPBACK_HOST_RX.test(hostMeta.host)) {
    return joinWithBase(`${hostMeta.proto}://${hostMeta.host}`, url);
  }
  if (ENV_ASSET_BASE) return joinWithBase(ENV_ASSET_BASE, url);
  return url.startsWith('/') ? url : `/${url}`;
}

function resolveImageUrl(req, rawUrl) {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  return ensureAbsoluteUrl(req, trimmed);
}

function shapePayloadData(data, nid, imageUrl) {
  const isObject = Object.prototype.toString.call(data) === '[object Object]';
  const base = isObject ? { ...data, nid } : { value: data != null ? String(data) : '', nid };
  if (imageUrl) {
    if (!base.imageUrl) base.imageUrl = imageUrl;
    base.richImageUrl = imageUrl;
  }
  return base;
}

export async function registerToken(req, res) {
  try {
    const userId = req.user?._id || null;
    const { expoPushToken, device } = req.body || {};
    if (!expoPushToken) return res.status(400).json({ message: 'expoPushToken required' });

    const upsert = await MobilePushToken.findOneAndUpdate(
      { expoPushToken },
      { $set: { user: userId, device, lastSeenAt: new Date() } },
      { upsert: true, new: true }
    );
    return res.json({ ok: true, tokenId: upsert._id });
  } catch (e) {
    console.error('[mobilePush][register] error', e);
    return res.status(500).json({ message: 'register_failed' });
  }
}

export async function deregisterToken(req, res) {
  try {
    const { expoPushToken } = req.body || {};
    if (!expoPushToken) return res.status(400).json({ message: 'expoPushToken required' });
    await MobilePushToken.deleteOne({ expoPushToken });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[mobilePush][deregister] error', e);
    return res.status(500).json({ message: 'deregister_failed' });
  }
}

export async function sendTestToMe(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: 'auth_required' });
    const tokens = await MobilePushToken.find({ user: userId }).lean();
    const expoTokens = tokens.map(t => t.expoPushToken);
    if (!expoTokens.length) return res.status(404).json({ message: 'no_tokens' });
    const nid = 'nid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const { badge, sound, channelId, imageUrl } = req.body || {};
    const resolvedImage = resolveImageUrl(req, imageUrl);
    const payloadData = shapePayloadData({ type: 'test', at: Date.now() }, nid, resolvedImage);
    let badges;
    if (typeof badge !== 'number') {
      // auto-compute per-user unread + 1 for each token
      const docs = await MobilePushToken.find({ user: userId }).lean().select('expoPushToken user');
      badges = await computeBadgesForTokens(docs);
    }
    const result = await sendExpoPush({
      tokens: expoTokens,
      title: 'Hello from My Pet',
      body: 'This is a test push notification',
      data: payloadData,
      badge: typeof badge === 'number' ? badge : undefined,
      badges,
      sound: sound || undefined,
      channelId: channelId || undefined,
      imageUrl: resolvedImage
    });
    try {
      await PushLog.create({
        title: 'Test to me',
        body: 'Test push',
        data: payloadData,
        imageUrl: resolvedImage,
        audience: { type: 'user', userId: userId?.toString() },
        tokensCount: expoTokens.length,
        nid,
        result,
        sentAt: new Date(),
        createdBy: userId
      });
    } catch {}
    return res.json({ ok: true, result });
  } catch (e) {
    console.error('[mobilePush][test] error', e);
    return res.status(500).json({ message: 'send_failed' });
  }
}

export async function broadcastToAdmins(req, res) {
  try {
    const { title, body, data, badge, sound, channelId, imageUrl } = req.body || {};
    const resolvedImage = resolveImageUrl(req, imageUrl);
    if (!title || !body) return res.status(400).json({ message: 'title_and_body_required' });
    // Fetch tokens for users with admin role
    const q = await MobilePushToken.aggregate([
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' },
      { $match: { 'u.role': 'admin' } },
      { $project: { expoPushToken: 1 } }
    ]);
    const tokens = q.map(d => d.expoPushToken);
    if (!tokens.length) return res.json({ ok: true, delivered: 0 });
    const nid = 'nid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const payloadData = shapePayloadData(data || {}, nid, resolvedImage);
    let badges;
    if (typeof badge !== 'number') {
      const tokenDocs = await MobilePushToken.find({ expoPushToken: { $in: tokens } }).lean().select('expoPushToken user');
      badges = await computeBadgesForTokens(tokenDocs);
    }
    const result = await sendExpoPush({ tokens, title, body, data: payloadData, badge: typeof badge === 'number' ? badge : undefined, badges, sound: sound || undefined, channelId: channelId || undefined, imageUrl: resolvedImage });
    try {
      await PushLog.create({
        title,
        body,
        data: payloadData,
        imageUrl: resolvedImage,
        audience: { type: 'admins' },
        tokensCount: tokens.length,
        nid,
        result,
        sentAt: new Date(),
        createdBy: req.user?._id,
        ...(sound ? { sound } : {}),
        ...(channelId ? { channelId } : {})
      });
    } catch {}
    return res.json({ ok: true, delivered: tokens.length, result });
  } catch (e) {
    console.error('[mobilePush][broadcastAdmins] error', e);
    return res.status(500).json({ message: 'broadcast_failed' });
  }
}

export async function broadcastAll(req, res) {
  try {
    const { title, body, data, badge, sound, channelId, imageUrl } = req.body || {};
    const resolvedImage = resolveImageUrl(req, imageUrl);
    if (!title || !body) return res.status(400).json({ message: 'title_and_body_required' });
    const docs = await MobilePushToken.find({}).lean().select('expoPushToken user');
    const tokens = docs.map(d => d.expoPushToken);
    if (!tokens.length) return res.json({ ok: true, delivered: 0 });
    const nid = 'nid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const payloadData = shapePayloadData(data || {}, nid, resolvedImage);
    let badges;
    if (typeof badge !== 'number') badges = await computeBadgesForTokens(docs);
    const result = await sendExpoPush({ tokens, title, body, data: payloadData, badge: typeof badge === 'number' ? badge : undefined, badges, sound: sound || undefined, channelId: channelId || undefined, imageUrl: resolvedImage });
    try {
      await PushLog.create({
        title,
        body,
        data: payloadData,
        imageUrl: resolvedImage,
        audience: { type: 'all' },
        tokensCount: tokens.length,
        nid,
        result,
        sentAt: new Date(),
        createdBy: req.user?._id,
        ...(sound ? { sound } : {}),
        ...(channelId ? { channelId } : {})
      });
    } catch {}
    return res.json({ ok: true, delivered: tokens.length, result });
  } catch (e) {
    console.error('[mobilePush][broadcastAll] error', e);
    return res.status(500).json({ message: 'broadcast_failed' });
  }
}

export async function sendToUser(req, res) {
  try {
    const { title, body, data, userId, email, badge, sound, channelId, imageUrl } = req.body || {};
    if (!title || !body) return res.status(400).json({ message: 'title_and_body_required' });
    if (!userId && !email) return res.status(400).json({ message: 'userId_or_email_required' });
    const resolvedImage = resolveImageUrl(req, imageUrl);

    if (email) {
      const q = await MobilePushToken.aggregate([
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $match: { 'u.email': email } },
        { $project: { expoPushToken: 1 } }
      ]);
      const tokens = q.map(d => d.expoPushToken);
      if (!tokens.length) return res.status(404).json({ message: 'no_tokens_for_user' });
      const nid = 'nid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      let badges;
      if (typeof badge !== 'number') {
        const tokenDocs = await MobilePushToken.find({ expoPushToken: { $in: tokens } }).lean().select('expoPushToken user');
        badges = await computeBadgesForTokens(tokenDocs);
      }
      const payloadData = shapePayloadData(data || {}, nid, resolvedImage);
      const result = await sendExpoPush({ tokens, title, body, data: payloadData, badge: typeof badge === 'number' ? badge : undefined, badges, sound: sound || undefined, channelId: channelId || undefined, imageUrl: resolvedImage });
      try {
        await PushLog.create({
          title,
          body,
          data: payloadData,
          imageUrl: resolvedImage,
          audience: { type: 'user', email },
          tokensCount: tokens.length,
          nid,
          result,
          sentAt: new Date(),
          createdBy: req.user?._id,
          ...(sound ? { sound } : {}),
          ...(channelId ? { channelId } : {})
        });
      } catch {}
      return res.json({ ok: true, delivered: tokens.length, result });
    }

    const docs = await MobilePushToken.find({ user: userId }).lean().select('expoPushToken');
    const tokens = docs.map(d => d.expoPushToken);
    if (!tokens.length) return res.status(404).json({ message: 'no_tokens_for_user' });
    const nid = 'nid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    let badges;
    if (typeof badge !== 'number') {
      const tokenDocs = await MobilePushToken.find({ expoPushToken: { $in: tokens } }).lean().select('expoPushToken user');
      badges = await computeBadgesForTokens(tokenDocs);
    }
    const payloadData = shapePayloadData(data || {}, nid, resolvedImage);
    const result = await sendExpoPush({ tokens, title, body, data: payloadData, badge: typeof badge === 'number' ? badge : undefined, badges, sound: sound || undefined, channelId: channelId || undefined, imageUrl: resolvedImage });
    try {
      await PushLog.create({
        title,
        body,
        data: payloadData,
        imageUrl: resolvedImage,
        audience: { type: 'user', userId },
        tokensCount: tokens.length,
        nid,
        result,
        sentAt: new Date(),
        createdBy: req.user?._id,
        ...(sound ? { sound } : {}),
        ...(channelId ? { channelId } : {})
      });
    } catch {}
    return res.json({ ok: true, delivered: tokens.length, result });
  } catch (e) {
    console.error('[mobilePush][sendToUser] error', e);
    return res.status(500).json({ message: 'send_failed' });
  }
}

export async function listTokens(req, res) {
  try {
    const { q = '', page = 1, limit = 50 } = req.query;
    const lim = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Math.max(1, Number(page)) - 1) * lim;
    const pipeline = [];
    pipeline.push({ $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u' } });
    pipeline.push({ $unwind: { path: '$u', preserveNullAndEmptyArrays: true } });
    if (q) {
      const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      pipeline.push({ $match: { $or: [ { 'u.email': regex }, { 'u.name': regex }, { expoPushToken: regex } ] } });
    }
    pipeline.push({ $sort: { updatedAt: -1 } });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: lim });
    pipeline.push({ $project: {
      expoPushToken: 1,
      lastSeenAt: 1,
      updatedAt: 1,
      createdAt: 1,
      device: 1,
      user: { _id: '$u._id', email: '$u.email', name: '$u.name', role: '$u.role' }
    }});
    const [rows, totalAgg] = await Promise.all([
      MobilePushToken.aggregate(pipeline),
      MobilePushToken.countDocuments({})
    ]);
    return res.json({ page: Number(page), limit: lim, total: totalAgg, rows });
  } catch (e) {
    console.error('[mobilePush][listTokens] error', e);
    return res.status(500).json({ message: 'list_failed' });
  }
}

export async function recordOpen(req, res) {
  try {
    const { nid, expoPushToken } = req.body || {};
    if (!nid) return res.status(400).json({ message: 'nid_required' });
    const userId = req.user?._id || null;
    await PushOpen.create({ nid, expoPushToken, user: userId || undefined, openedAt: new Date() });
    // After recording open, compute updated unread count for user (exclude +1 increment)
    let unread = 0;
    try {
      if (userId) unread = await computeUnreadBadgeForUser(userId.toString());
    } catch {}
    return res.json({ ok: true, unread });
  } catch (e) {
    console.error('[mobilePush][recordOpen] error', e);
    return res.status(500).json({ message: 'open_failed' });
  }
}

export async function getStats(req, res) {
  try {
    const now = Date.now();
    const windowMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    const since = new Date(now - windowMs);
    // total sent (sum of tokensCount)
    const sentAgg = await PushLog.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$tokensCount', 0] } } } }
    ]);
    const totalSent = sentAgg[0]?.total || 0;
    // active users (tokens last seen within 30d)
    const activeUsers = await MobilePushToken.countDocuments({ lastSeenAt: { $gte: since } });
    // last 30d sent sum and opens sum
    const sent30Agg = await PushLog.aggregate([
      { $match: { sentAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$tokensCount', 0] } } } }
    ]);
    const opens30 = await PushOpen.countDocuments({ openedAt: { $gte: since } });
    const sent30 = sent30Agg[0]?.total || 0;
    const openRate = sent30 ? Math.min(1, opens30 / sent30) : 0;
    // scheduled
    const scheduledCount = await ScheduledPush.countDocuments({ status: 'scheduled' });
    return res.json({ totalSent, activeUsers, openRate, scheduledCount });
  } catch (e) {
    console.error('[mobilePush][stats] error', e);
    return res.status(500).json({ message: 'stats_failed' });
  }
}

export async function schedulePush(req, res) {
  try {
    const { title, body, data, audience, scheduleAt, badge, sound, channelId, imageUrl } = req.body || {};
    if (!title || !body) return res.status(400).json({ message: 'title_and_body_required' });
    if (!audience || !audience.type) return res.status(400).json({ message: 'audience_required' });
    const when = new Date(scheduleAt);
    if (isNaN(when.getTime())) return res.status(400).json({ message: 'invalid_scheduleAt' });
    const resolvedImage = resolveImageUrl(req, imageUrl);
    const doc = await ScheduledPush.create({ title, body, data, imageUrl: resolvedImage, badge: typeof badge === 'number' ? badge : undefined, sound: sound || undefined, audience: channelId ? { ...audience, channelId } : audience, scheduleAt: when, createdBy: req.user?._id });
    return res.json({ ok: true, scheduled: doc });
  } catch (e) {
    console.error('[mobilePush][schedule] error', e);
    return res.status(500).json({ message: 'schedule_failed' });
  }
}

export async function listScheduled(req, res) {
  try {
    const docs = await ScheduledPush.find({ status: 'scheduled' }).sort({ scheduleAt: 1 }).lean();
    return res.json({ ok: true, rows: docs });
  } catch (e) {
    return res.status(500).json({ message: 'list_failed' });
  }
}

export async function cancelScheduled(req, res) {
  try {
    const { id } = req.params;
    const doc = await ScheduledPush.findById(id);
    if (!doc) return res.status(404).json({ message: 'not_found' });
    if (doc.status !== 'scheduled') return res.status(400).json({ message: 'not_scheduled' });
    doc.status = 'cancelled';
    await doc.save();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: 'cancel_failed' });
  }
}

export async function listHistory(req, res) {
  try {
    const { q = '', page = 1, limit = 20, from, to } = req.query || {};
    const lim = Math.min(100, Math.max(1, Number(limit)));
    const skip = (Math.max(1, Number(page)) - 1) * lim;
    const match = {};
    if (from || to) {
      match.sentAt = {};
      if (from) match.sentAt.$gte = new Date(from);
      if (to) match.sentAt.$lte = new Date(to);
    }
    const pipeline = [];
    if (Object.keys(match).length) pipeline.push({ $match: match });
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      pipeline.push({ $match: { $or: [ { title: rx }, { body: rx }, { 'audience.type': rx }, { nid: rx } ] } });
    }
    pipeline.push({ $sort: { sentAt: -1 } });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: lim });
    pipeline.push({ $project: { _id: 1, title: 1, body: 1, data: 1, imageUrl: 1, audience: 1, tokensCount: 1, nid: 1, sentAt: 1, createdBy: 1 } });
    const [rows, total] = await Promise.all([
      PushLog.aggregate(pipeline),
      PushLog.countDocuments(match)
    ]);
    return res.json({ page: Number(page), limit: lim, total, rows });
  } catch (e) {
    console.error('[mobilePush][history] error', e);
    return res.status(500).json({ message: 'history_failed' });
  }
}

// Return current unread badge count for authenticated user (without +1 increment)
export async function getMyBadge(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: 'auth_required' });
    const unread = await computeUnreadBadgeForUser(userId.toString());
    return res.json({ ok: true, unread });
  } catch (e) {
    console.error('[mobilePush][getMyBadge] error', e);
    return res.status(500).json({ message: 'badge_failed' });
  }
}

export async function getAnalytics(req, res) {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
    const now = new Date();
    const since = new Date(now.getTime() - days*24*60*60*1000);
    const fmt = '%Y-%m-%d';
    const sentByDay = await PushLog.aggregate([
      { $match: { sentAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$sentAt' } }, sent: { $sum: { $ifNull: ['$tokensCount', 0] } } } },
      { $project: { d: '$_id', sent: 1, _id: 0 } }
    ]);
    const opensByDay = await PushOpen.aggregate([
      { $match: { openedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$openedAt' } }, opens: { $sum: 1 } } },
      { $project: { d: '$_id', opens: 1, _id: 0 } }
    ]);
    const activeByDay = await MobilePushToken.aggregate([
      { $match: { lastSeenAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$lastSeenAt' } }, active: { $sum: 1 } } },
      { $project: { d: '$_id', active: 1, _id: 0 } }
    ]);
    // Build continuous series
    const series = [];
    const byD = (arr, key) => arr.reduce((m, r) => (m[r.d] = r[key], m), {});
    const sMap = byD(sentByDay, 'sent');
    const oMap = byD(opensByDay, 'opens');
    const aMap = byD(activeByDay, 'active');
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i*24*60*60*1000);
      const key = d.toISOString().slice(0,10);
      const sent = Number(sMap[key] || 0);
      const opens = Number(oMap[key] || 0);
      const active = Number(aMap[key] || 0);
      series.push({ date: key, sent, opens, openRate: sent ? +(Math.min(1, opens/sent)).toFixed(4) : 0, active });
    }
    return res.json({ days, series });
  } catch (e) {
    console.error('[mobilePush][analytics] error', e);
    return res.status(500).json({ message: 'analytics_failed' });
  }
}
