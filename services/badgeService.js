// badgeService.js
// Computes unread push notification count (to use as iOS badge) per user.
// Strategy: Count PushLog entries relevant to the user whose nid has not been recorded in PushOpen by that user.
// Audience types considered: 'all' and user-specific { type: 'user', userId }.
// (Admins broadcasts and other audience types can be added later.)

import PushLog from '../models/PushLog.js';
import PushOpen from '../models/PushOpen.js';
import mongoose from 'mongoose';

// Cache basic counts briefly in-memory to avoid repeated heavy queries during large broadcasts.
// Keyed by userId string. Simple TTL strategy.
const _cache = new Map(); // userId -> { count, expires }
const TTL_MS = 15 * 1000; // 15s acceptable for badge freshness

export async function computeUnreadBadgeForUser(userId) {
  if (!userId) return 0;
  const key = String(userId);
  const cached = _cache.get(key);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.count;

  try {
    const uid = new mongoose.Types.ObjectId(userId);
    // Find all relevant push logs (limit time window to last 90 days to cap work)
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const logs = await PushLog.find({
      sentAt: { $gte: since },
      'audience.type': { $in: ['all', 'user'] },
      $or: [
        { 'audience.type': 'all' },
        { 'audience.type': 'user', 'audience.userId': userId }
      ]
    }).select('nid audience').lean();
    if (!logs.length) {
      _cache.set(key, { count: 0, expires: now + TTL_MS });
      return 0;
    }
    const nids = logs.map(l => l.nid).filter(Boolean);
    const opened = await PushOpen.find({ nid: { $in: nids }, user: uid }).select('nid').lean();
    const openedSet = new Set(opened.map(o => o.nid));
    const unread = nids.filter(n => n && !openedSet.has(n)).length;
    _cache.set(key, { count: unread, expires: now + TTL_MS });
    return unread;
  } catch (e) {
    return 0; // fail-safe: never block sending due to badge calc
  }
}

// Bulk helper: returns map token->badge when provided array of { expoPushToken, user }
export async function computeBadgesForTokens(tokenDocs) {
  const uniqueUsers = [...new Set(tokenDocs.map(d => d.user?.toString()).filter(Boolean))];
  const badgeMap = new Map();
  const userBadges = await Promise.all(uniqueUsers.map(u => computeUnreadBadgeForUser(u).then(c => [u, c])));
  const lookup = new Map(userBadges);
  for (const doc of tokenDocs) {
    const uid = doc.user?.toString();
    const count = uid ? (lookup.get(uid) || 0) : 0;
    // Simple increment heuristic: new notification increases unread by 1
    badgeMap.set(doc.expoPushToken, count + 1);
  }
  return badgeMap; // Map(expoPushToken -> badgeNumber)
}
