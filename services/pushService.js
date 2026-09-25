import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';
import User from '../models/User.js';

export async function sendPushToUser(userId, payload) {
  const subs = await PushSubscription.find({ userId });
  return sendToSubs(subs, payload);
}

export async function sendPushToAll(payload) {
  const subs = await PushSubscription.find();
  return sendToSubs(subs, payload);
}

// Send push notifications to all admin users only.
// If no admin subscriptions exist, we do nothing (caller can decide fallback behavior)
// Payload can be object or pre-stringified.
export async function sendPushToAdmins(payload) {
  // Find all admin user ids first to avoid large $in with role filter on subscriptions collection (subscriptions store userId ref)
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  if (!admins.length) return { sent: 0, removed: 0, note: 'no-admin-users' };
  const adminIds = admins.map(a => a._id);
  const subs = await PushSubscription.find({ userId: { $in: adminIds } });
  if (!subs.length) return { sent: 0, removed: 0, note: 'no-admin-subscriptions' };
  return sendToSubs(subs, payload);
}

async function sendToSubs(subs, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const results = await Promise.allSettled(subs.map(s => webpush.sendNotification(s, body)));
  const toDelete = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) toDelete.push(subs[i].endpoint);
    }
  });
  if (toDelete.length) await PushSubscription.deleteMany({ endpoint: { $in: toDelete } });
  return { sent: subs.length - toDelete.length, removed: toDelete.length };
}
